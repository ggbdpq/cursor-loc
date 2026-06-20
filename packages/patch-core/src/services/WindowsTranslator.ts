import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Replacement } from '../types.js';
import { CursorTranslator } from './CursorTranslator.js';
import { getAppRoot } from './pathResolver.js';

interface PackageJson {
  main?: string;
  main_original?: string;
  [key: string]: unknown;
}

/**
 * 读取打包进 dist 的静态资源文件。
 *
 * @param name `src/assets/` 下的文件名。
 * @returns 文件 UTF-8 文本内容。
 */
function loadAsset(name: string): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const assetPath = path.join(dir, '..', 'assets', name);
  return fs.readFileSync(assetPath, 'utf-8');
}

/**
 * Windows 平台 Cursor 汉化补丁安装实现。
 *
 * 不修改原始 `workbench.desktop.main.js`，而是生成 `_translated` 副本并在头部注入 DOM 翻译脚本；
 * 通过 `cursorTranslatorMain.js` 拦截协议请求重定向到翻译副本。
 */
export class WindowsTranslator extends CursorTranslator {
  private appRoot: string;
  private readTargetPath: string;
  private saveTranslatedFilePath: string;
  private saveInterceptorPath: string;
  private readPackageJsonPath: string;
  private backupPackageJsonPath: string;
  private injectScript: string;

  /**
   * @param cursorInstallPath Cursor 安装根目录。
   * @param interceptorFileContent 协议拦截器脚本内容。
   */
  constructor(cursorInstallPath: string, interceptorFileContent: string) {
    super(cursorInstallPath, interceptorFileContent);
    this.appRoot = getAppRoot(cursorInstallPath);
    this.readTargetPath = path.join(this.appRoot, 'out/vs/workbench/workbench.desktop.main.js');
    this.saveTranslatedFilePath = path.join(this.appRoot, 'out/vs/workbench/workbench.desktop.main_translated.js');
    this.saveInterceptorPath = path.join(this.appRoot, 'out/cursorTranslatorMain.js');
    this.readPackageJsonPath = path.join(this.appRoot, 'package.json');
    this.backupPackageJsonPath = path.join(this.appRoot, 'package.json.backup');
    this.injectScript = loadAsset('cursor.inject.js');
  }

  /**
   * @param platform 仅支持 `win32`。
   * @returns 平台受支持时返回 true。
   */
  isSupported(platform: string): boolean {
    return platform === 'win32';
  }

  /**
   * 检查翻译副本、拦截器与 package.json 是否处于补丁状态。
   *
   * @returns 各子项存在/已修改布尔值。
   */
  getStatus() {
    let packageJsonPatched = false;
    if (fs.existsSync(this.readPackageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(this.readPackageJsonPath, 'utf-8')) as PackageJson;
        packageJsonPatched = pkg.main === './out/cursorTranslatorMain.js';
      } catch {
        packageJsonPatched = false;
      }
    }

    return {
      translatedFileExists: fs.existsSync(this.saveTranslatedFilePath),
      interceptorExists: fs.existsSync(this.saveInterceptorPath),
      packageJsonPatched,
    };
  }

  /**
   * 应用汉化补丁。
   *
   * 1. 复制 workbench 并在头部注入带词典的 `cursor.inject.js`
   * 2. 写入 `cursorTranslatorMain.js` 拦截器
   * 3. 备份并修改 `package.json` 的 main 入口
   *
   * @param replacements 运行时替换词典。
   * @throws 目标 workbench 不存在或目录不可写。
   */
  install(replacements: readonly Replacement[]): void {
    if (!fs.existsSync(this.readTargetPath)) {
      throw new Error(`目标文件不存在: ${this.readTargetPath}`);
    }

    const source = fs.readFileSync(this.readTargetPath, 'utf-8');
    const injectWithData = this.injectScript.replace(
      "'${replacementsArray}'",
      JSON.stringify(replacements),
    );
    const output = `${injectWithData};\n${source}`;

    const parsedPath = path.parse(this.readTargetPath);
    fs.accessSync(parsedPath.dir, fs.constants.W_OK);
    fs.writeFileSync(this.saveTranslatedFilePath, output, 'utf8');
    fs.writeFileSync(this.saveInterceptorPath, this.interceptorFileContent, 'utf8');

    if (!fs.existsSync(this.backupPackageJsonPath)) {
      fs.copyFileSync(this.readPackageJsonPath, this.backupPackageJsonPath);
    }

    const packageContent = fs.readFileSync(this.readPackageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageContent) as PackageJson;

    if (!packageJson.main_original && packageJson.main) {
      packageJson.main_original = packageJson.main;
    }

    packageJson.main = './out/cursorTranslatorMain.js';
    fs.writeFileSync(this.readPackageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');
  }

  /**
   * 移除补丁文件并恢复 package.json。
   *
   * 优先从 `.backup` 还原；若无备份则尝试恢复 `main_original` 字段。
   */
  uninstall(): void {
    if (fs.existsSync(this.saveTranslatedFilePath)) {
      fs.unlinkSync(this.saveTranslatedFilePath);
    }

    if (fs.existsSync(this.saveInterceptorPath)) {
      fs.unlinkSync(this.saveInterceptorPath);
    }

    if (fs.existsSync(this.backupPackageJsonPath)) {
      fs.copyFileSync(this.backupPackageJsonPath, this.readPackageJsonPath);
      return;
    }

    if (!fs.existsSync(this.readPackageJsonPath)) {
      return;
    }

    const packageContent = fs.readFileSync(this.readPackageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageContent) as PackageJson;

    if (packageJson.main_original) {
      packageJson.main = packageJson.main_original;
      delete packageJson.main_original;
      fs.writeFileSync(this.readPackageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');
    }
  }
}

/**
 * 按当前平台创建翻译器实例。
 *
 * @param installPath Cursor 安装根目录。
 * @param interceptorContent 协议拦截器脚本。
 * @returns 平台对应的 `CursorTranslator` 实现。
 * @throws 非 Windows 平台。
 */
export function createTranslator(
  installPath: string,
  interceptorContent: string,
): CursorTranslator {
  if (process.platform === 'win32') {
    return new WindowsTranslator(installPath, interceptorContent);
  }
  throw new Error(`当前仅支持 Windows 平台，检测到: ${process.platform}`);
}

/**
 * 加载 Electron 主进程协议拦截器脚本。
 *
 * @returns `cursorTranslatorMain.js` 源码字符串。
 */
export function loadInterceptorMain(): string {
  return loadAsset('cursorTranslatorMain.js');
}

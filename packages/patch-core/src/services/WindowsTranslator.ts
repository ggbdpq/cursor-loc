import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Replacement } from '../types.js';
import { CursorTranslator } from './CursorTranslator.js';
import type { PatchInstallMeta } from './CursorTranslator.js';
import { getAppRoot } from './pathResolver.js';

interface PackageJson {
  main?: string;
  main_original?: string;
  [key: string]: unknown;
}

interface WorkbenchTarget {
  label: string;
  sourcePath: string;
  translatedPath: string;
}

interface WorkbenchTargetStatus {
  label: string;
  sourceExists: boolean;
  translatedFileExists: boolean;
}

export type { PatchInstallMeta };

/**
 * workbench.js 启动入口：结构固定，但压缩变量名随版本变化
 * （3.16 为 t/m，3.17.21 为 esModule/baseUrl），须按结构匹配并捕获变量名。
 */
const LOADER_IMPORT_RE = /await import\(new URL\(`\$\{(\w+)\}\.js`,(\w+)\)\.href\)/;
const LOADER_IMPORT_TRANSLATED_RE =
  /await import\(new URL\(`\$\{(\w+)\}_translated\.js`,(\w+)\)\.href\)/;

/** 由捕获的变量名构造原始 import 语句。 */
function loaderImportOriginal(t: string, m: string): string {
  return `await import(new URL(\`\${${t}}.js\`,${m}).href)`;
}

/** 由捕获的变量名构造指向翻译副本的 import 语句。 */
function loaderImportTranslated(t: string, m: string): string {
  return `await import(new URL(\`\${${t}}_translated.js\`,${m}).href)`;
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
 * 生成 `_translated` 副本并注入 DOM 翻译脚本；同时改 workbench.js 的 ESM import
 * 直接加载该副本（Cursor 3.16+ 的 `import()` 不走 `registerFileProtocol`）。
 */
const LOADER_IMPORT_ORIGINAL = 'await import(new URL(`${t}.js`,m).href)';
const LOADER_IMPORT_PATCHED = 'await import(new URL(`${t}_translated.js`,m).href)';

export class WindowsTranslator extends CursorTranslator {
  private appRoot: string;
  private workbenchTargets: WorkbenchTarget[];
  private saveInterceptorPath: string;
  private readPackageJsonPath: string;
  private backupPackageJsonPath: string;
  private metaPath: string;
  private injectScript: string;
  private loaderPath: string;
  private loaderBackupPath: string;

  /**
   * @param cursorInstallPath Cursor 安装根目录。
   * @param interceptorFileContent 协议拦截器脚本内容。
   */
  constructor(cursorInstallPath: string, interceptorFileContent: string) {
    super(cursorInstallPath, interceptorFileContent);
    this.appRoot = getAppRoot(cursorInstallPath);
    this.workbenchTargets = [
      {
        label: 'desktop',
        sourcePath: path.join(this.appRoot, 'out/vs/workbench/workbench.desktop.main.js'),
        translatedPath: path.join(this.appRoot, 'out/vs/workbench/workbench.desktop.main_translated.js'),
      },
      {
        label: 'glass',
        sourcePath: path.join(this.appRoot, 'out/vs/workbench/workbench.glass.main.js'),
        translatedPath: path.join(this.appRoot, 'out/vs/workbench/workbench.glass.main_translated.js'),
      },
    ];
    this.saveInterceptorPath = path.join(this.appRoot, 'out/cursorTranslatorMain.js');
    this.readPackageJsonPath = path.join(this.appRoot, 'package.json');
    this.backupPackageJsonPath = path.join(this.appRoot, 'package.json.backup');
    this.metaPath = path.join(this.appRoot, 'out/cursor-zh-patch-meta.json');
    this.injectScript = loadAsset('cursor.inject.js');
    this.loaderPath = path.join(
      this.appRoot,
      'out/vs/code/electron-sandbox/workbench/workbench.js',
    );
    this.loaderBackupPath = `${this.loaderPath}.cursor-zh-backup`;
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

    const targetStatuses = this.workbenchTargets.map((target): WorkbenchTargetStatus => ({
      label: target.label,
      sourceExists: fs.existsSync(target.sourcePath),
      translatedFileExists: fs.existsSync(target.translatedPath),
    }));
    const translatedFileExists = targetStatuses
      .filter((target) => target.sourceExists)
      .every((target) => target.translatedFileExists);

    return {
      translatedFileExists,
      interceptorExists: fs.existsSync(this.saveInterceptorPath),
      packageJsonPatched,
      loaderPatched: this.isLoaderPatched(),
      targetStatuses,
    };
  }

  /**
   * 读取已安装补丁的元数据（0.0.7+ apply 写入）。
   *
   * @returns 元数据对象；旧版补丁无此文件时返回 null。
   */
  getInstalledMeta(): PatchInstallMeta | null {
    if (!fs.existsSync(this.metaPath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(this.metaPath, 'utf-8')) as PatchInstallMeta;
    } catch {
      return null;
    }
  }

  /**
   * 检查翻译副本头部是否包含 DOM 注入脚本特征。
   */
  translatedFileHasInjectScript(): boolean {
    const existingTargets = this.workbenchTargets.filter((target) => fs.existsSync(target.sourcePath));
    if (existingTargets.length === 0) {
      return false;
    }

    for (const target of existingTargets) {
      if (!fs.existsSync(target.translatedPath)) {
        return false;
      }

      try {
        const sample = fs.readFileSync(target.translatedPath, 'utf-8').slice(0, 65536);
        if (!sample.includes('TextTranslator')) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * 应用汉化补丁。
   *
   * 1. 复制 desktop / glass workbench 并在头部注入带词典的 `cursor.inject.js`
   * 2. 改 workbench.js 的 ESM import，直接加载 `_translated.js`（Cursor 3.16+ 的 import() 不走 registerFileProtocol）
   * 3. 写入 `cursorTranslatorMain.js` 拦截器
   * 4. 备份并修改 `package.json` 的 main 入口
   *
   * @param replacements 运行时替换词典。
   * @throws 目标 workbench 不存在或目录不可写。
   */
  install(replacements: readonly Replacement[]): void {
    const existingTargets = this.workbenchTargets.filter((target) => fs.existsSync(target.sourcePath));
    if (existingTargets.length === 0) {
      throw new Error(`目标文件不存在: ${this.workbenchTargets[0]?.sourcePath}`);
    }

    const injectWithData = this.injectScript.replace(
      "'${replacementsArray}'",
      JSON.stringify(replacements),
    );

    const parsedPath = path.parse(existingTargets[0].sourcePath);
    fs.accessSync(parsedPath.dir, fs.constants.W_OK);
    for (const target of existingTargets) {
      const source = fs.readFileSync(target.sourcePath, 'utf-8');
      const output = `${injectWithData};\n${source}`;
      fs.writeFileSync(target.translatedPath, output, 'utf8');
    }
    this.patchWorkbenchLoader();
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

    const meta: PatchInstallMeta = {
      replacementCount: replacements.length,
      appliedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  /**
   * 移除补丁文件并恢复 package.json。
   *
   * 优先从 `.backup` 还原；若无备份则尝试恢复 `main_original` 字段。
   */
  uninstall(): void {
    this.restoreWorkbenchLoader();

    for (const target of this.workbenchTargets) {
      if (fs.existsSync(target.translatedPath)) {
        fs.unlinkSync(target.translatedPath);
      }
    }

    if (fs.existsSync(this.saveInterceptorPath)) {
      fs.unlinkSync(this.saveInterceptorPath);
    }

    if (fs.existsSync(this.metaPath)) {
      fs.unlinkSync(this.metaPath);
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

  /**
   * workbench.js 是否已改为加载 `_translated.js`。
   */
  private isLoaderPatched(): boolean {
    if (!fs.existsSync(this.loaderPath)) {
      return false;
    }
    try {
      return LOADER_IMPORT_TRANSLATED_RE.test(fs.readFileSync(this.loaderPath, 'utf-8'));
    } catch {
      return false;
    }
  }

  /**
   * 备份并改写 workbench.js，使 ESM import 加载翻译副本。
   *
   * @throws 启动器不存在，或当前 Cursor 版本找不到可替换的 import 语句。
   */
  private patchWorkbenchLoader(): void {
    if (!fs.existsSync(this.loaderPath)) {
      throw new Error(`启动器不存在: ${this.loaderPath}`);
    }

    if (!fs.existsSync(this.loaderBackupPath)) {
      const current = fs.readFileSync(this.loaderPath, 'utf-8');
      if (LOADER_IMPORT_TRANSLATED_RE.test(current)) {
        const restored = current.replace(
          LOADER_IMPORT_TRANSLATED_RE,
          (_s, t, m) => loaderImportOriginal(t, m),
        );
        fs.writeFileSync(this.loaderBackupPath, restored, 'utf8');
      } else {
        fs.copyFileSync(this.loaderPath, this.loaderBackupPath);
      }
    }

    const original = fs.readFileSync(this.loaderBackupPath, 'utf-8');
    if (!LOADER_IMPORT_RE.test(original)) {
      throw new Error(
        '当前 Cursor 版本的 workbench.js 无法识别启动入口，请升级汉化补丁后再 apply。',
      );
    }

    const patched = original.replace(
      LOADER_IMPORT_RE,
      (_s, t, m) => loaderImportTranslated(t, m),
    );
    fs.writeFileSync(this.loaderPath, patched, 'utf8');
  }

  /** 从备份还原 workbench.js。 */
  private restoreWorkbenchLoader(): void {
    if (fs.existsSync(this.loaderBackupPath)) {
      fs.copyFileSync(this.loaderBackupPath, this.loaderPath);
      fs.unlinkSync(this.loaderBackupPath);
      return;
    }

    if (!fs.existsSync(this.loaderPath)) {
      return;
    }

    const current = fs.readFileSync(this.loaderPath, 'utf-8');
    if (LOADER_IMPORT_TRANSLATED_RE.test(current)) {
      fs.writeFileSync(
        this.loaderPath,
        current.replace(LOADER_IMPORT_TRANSLATED_RE, (_s, t, m) => loaderImportOriginal(t, m)),
        'utf8',
      );
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

import { createHash } from 'node:crypto';
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
  private productJsonPath: string;
  private productBackupPath: string;
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
    this.productJsonPath = path.join(this.appRoot, 'product.json');
    this.productBackupPath = path.join(this.appRoot, 'product.json.backup');
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
   * 写入顺序保证「绝对可逆」：先写全部新增文件（翻译副本、拦截器），最后才翻转
   * 启动入口（workbench.js → product.json 校验和 → package.json main），因此
   * 任何一步失败都不可能出现「入口指向缺失文件」的死机状态。
   *
   * 失败时自动回滚：调用 uninstall() 还原全部备份并删除新增文件，回滚后重新抛出
   * 原始错误。注意：若 apply 前已存在旧补丁，回滚结果为未打补丁的英文状态（而非旧
   * 补丁状态），重新 apply 即可恢复。
   *
   * @param replacements 运行时替换词典。
   * @param cursorVersion apply 时的 Cursor 版本，写入元数据供启动自愈判定。
   * @throws 目标 workbench 不存在、目录不可写或任一步骤失败（已自动回滚）。
   */
  install(replacements: readonly Replacement[], cursorVersion?: string): void {
    try {
      const existingTargets = this.workbenchTargets.filter((target) =>
        fs.existsSync(target.sourcePath),
      );
      if (existingTargets.length === 0) {
        throw new Error(`目标文件不存在: ${this.workbenchTargets[0]?.sourcePath}`);
      }

      const injectWithData = this.injectScript.replace(
        "'${replacementsArray}'",
        JSON.stringify(replacements),
      );

      const parsedPath = path.parse(existingTargets[0].sourcePath);
      fs.accessSync(parsedPath.dir, fs.constants.W_OK);

      // 1) 新增文件：翻译副本 + 拦截器（失败可直接删除，无副作用）
      for (const target of existingTargets) {
        const source = fs.readFileSync(target.sourcePath, 'utf-8');
        fs.writeFileSync(target.translatedPath, `${injectWithData};\n${source}`, 'utf8');
      }
      fs.writeFileSync(this.saveInterceptorPath, this.interceptorFileContent, 'utf8');

      // 2) 翻转启动入口：workbench.js → 校验和 → package.json main
      this.patchWorkbenchLoader();
      this.updateLoaderChecksum();

      const currentPkgRaw = fs.readFileSync(this.readPackageJsonPath);
      const currentPkg = JSON.parse(currentPkgRaw.toString('utf-8')) as PackageJson;
      const pkgPatched = currentPkg.main === './out/cursorTranslatorMain.js';
      if (!pkgPatched && this.isBackupStale(this.backupPackageJsonPath, currentPkgRaw, false)) {
        fs.copyFileSync(this.readPackageJsonPath, this.backupPackageJsonPath);
      }
      if (!currentPkg.main_original && currentPkg.main) {
        currentPkg.main_original = currentPkg.main;
      }
      currentPkg.main = './out/cursorTranslatorMain.js';
      fs.writeFileSync(this.readPackageJsonPath, JSON.stringify(currentPkg, null, 2), 'utf-8');

      // 3) 元数据
      const meta: PatchInstallMeta = {
        replacementCount: replacements.length,
        appliedAt: new Date().toISOString(),
        ...(cursorVersion ? { cursorVersion } : {}),
      };
      fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    } catch (err) {
      try {
        this.uninstall();
      } catch (rollbackErr) {
        const note = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}（自动回滚失败: ${note}，请执行「恢复英文界面」后重试）`,
        );
      }
      throw err;
    }
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

    this.restoreProductChecksums();

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
   * 改写 workbench.js，使 ESM import 加载翻译副本。
   *
   * 始终以「当前磁盘内容」为补丁基底（而非备份），避免 Cursor 升级后把旧版本
   * 启动器写进新安装目录；已指向翻译副本时直接跳过（重复 apply）。
   *
   * @throws 启动器不存在，或当前 Cursor 版本找不到可替换的 import 语句。
   */
  private patchWorkbenchLoader(): void {
    if (!fs.existsSync(this.loaderPath)) {
      throw new Error(`启动器不存在: ${this.loaderPath}`);
    }

    const currentRaw = fs.readFileSync(this.loaderPath);
    const current = currentRaw.toString('utf-8');
    if (LOADER_IMPORT_TRANSLATED_RE.test(current)) {
      return;
    }

    if (this.isBackupStale(this.loaderBackupPath, currentRaw, false)) {
      fs.writeFileSync(this.loaderBackupPath, currentRaw);
    }

    if (!LOADER_IMPORT_RE.test(current)) {
      throw new Error(
        '当前 Cursor 版本的 workbench.js 无法识别启动入口，请升级汉化补丁后再 apply。',
      );
    }

    fs.writeFileSync(
      this.loaderPath,
      current.replace(LOADER_IMPORT_RE, (_s, t, m) => loaderImportTranslated(t, m)),
      'utf8',
    );
  }

  /**
   * 备份是否为 Cursor 升级前的残留。
   *
   * Cursor 升级会覆盖原始文件但不会清理我们的备份；若当前文件未被我们修改
   * 且与备份不一致，说明备份来自旧版本，须以当前内容刷新，否则 revert 会把
   * 旧版本内容写进新安装目录。
   *
   * @param backupPath 备份文件路径。
   * @param currentRaw 当前文件原始字节。
   * @param patchedByUs 当前文件是否已被本补丁修改（是则备份即对应原始内容）。
   * @returns 备份缺失或内容不一致时为 true。
   */
  private isBackupStale(backupPath: string, currentRaw: Buffer, patchedByUs: boolean): boolean {
    if (!fs.existsSync(backupPath)) {
      return true;
    }
    return !patchedByUs && !fs.readFileSync(backupPath).equals(currentRaw);
  }

  /**
   * 同步 product.json 中启动器的校验和（未填充 base64 的 sha256，键相对 out/）。
   *
   * IntegrityService 按 checksums 判定安装是否被改动；不同步会在启动时弹
   * 「installation appears to be corrupt」提示。
   */
  private updateLoaderChecksum(): void {
    if (!fs.existsSync(this.productJsonPath)) {
      return;
    }

    const productRaw = fs.readFileSync(this.productJsonPath);
    const product = JSON.parse(productRaw.toString('utf-8')) as {
      checksums?: Record<string, string>;
    };
    const key = path
      .relative(path.join(this.appRoot, 'out'), this.loaderPath)
      .replace(/\\/g, '/');
    if (!product.checksums || !(key in product.checksums)) {
      return; // ponytail: 新版本若改键名则无法拦提示，词典已兜底翻译该提示
    }

    const loaderHash = createHash('sha256')
      .update(fs.readFileSync(this.loaderPath))
      .digest('base64')
      .replace(/=+$/, '');
    const patchedByUs = product.checksums[key] === loaderHash;
    if (this.isBackupStale(this.productBackupPath, productRaw, patchedByUs)) {
      fs.writeFileSync(this.productBackupPath, productRaw);
    }

    product.checksums[key] = loaderHash;
    fs.writeFileSync(this.productJsonPath, JSON.stringify(product, null, 2), 'utf-8');
  }

  /** 从备份还原 product.json（撤销校验和修改）。 */
  private restoreProductChecksums(): void {
    if (fs.existsSync(this.productBackupPath)) {
      fs.copyFileSync(this.productBackupPath, this.productJsonPath);
      fs.unlinkSync(this.productBackupPath);
    }
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

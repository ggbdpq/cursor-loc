/**
 * 补丁服务层：动态加载 @cursor-loc/patch-core，读取 generated/replacements.bundle.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 单次补丁操作的统一返回结构。 */
export interface PatchOperationResult {
  ok: boolean;
  lines: string[];
  error?: string;
  versionMismatch?: { tested: string; current: string };
  patchInstalled?: boolean;
}

interface Replacement {
  originalText: string;
  changeText: string;
  searchType: 'exact' | 'partial' | 'regex';
  flags?: string;
}

interface ReplacementsBundle {
  locale: string;
  meta?: { testedCursorVersion?: string; lastUpdated?: string };
  replacements: Replacement[];
}

let corePromise: Promise<{
  applyPatch: (options: {
    installRoot?: string;
    replacements: readonly Replacement[];
    meta?: { testedCursorVersion?: string };
  }) => Promise<PatchOperationResult>;
  revertPatch: (installRoot?: string) => Promise<PatchOperationResult>;
  getPatchStatus: (
    installRoot: string | undefined,
    replacementCount: number,
    testedVersion?: string,
  ) => Promise<PatchOperationResult>;
  runDoctor: (installRoot?: string) => Promise<PatchOperationResult>;
}> | undefined;

const generatedDir = path.join(__dirname, '..', 'generated');
const bundlePath = path.join(generatedDir, 'replacements.bundle.json');

/**
 * 动态加载 patch-core：打包 VSIX 时读 bundled/，开发时读 workspace 包。
 *
 * 使用 Promise 缓存，避免重复 import。
 *
 * @returns patch-core 导出的 applyPatch / revertPatch 等 API。
 */
async function loadCore() {
  if (!corePromise) {
    const bundled = path.join(__dirname, '..', 'bundled', 'patch-core', 'dist', 'index.js');
    if (fs.existsSync(bundled)) {
      corePromise = import(pathToFileURL(bundled).href);
    } else {
      corePromise = import('@cursor-loc/patch-core');
    }
  }
  return corePromise;
}

/**
 * 读取 `generated/replacements.bundle.json`。
 *
 * @throws {Error} bundle 不存在时提示先执行 build:i18n。
 */
function loadBundle(): ReplacementsBundle {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(
      '词典 bundle 未就绪。请在扩展目录执行 npm run build:i18n，或在仓库根目录 npm run build。',
    );
  }
  return JSON.parse(fs.readFileSync(bundlePath, 'utf-8')) as ReplacementsBundle;
}

/**
 * 检查 generated/replacements.bundle.json 是否已构建。
 */
export function isBundleReady(): boolean {
  return fs.existsSync(bundlePath);
}

/** @deprecated 兼容旧调用方，等价于 isBundleReady */
export function isVendorReady(): boolean {
  return isBundleReady();
}

/**
 * 规范化扩展传入的安装根路径。
 *
 * @param installRoot 用户配置或自动检测得到的目录。
 * @returns 非空路径，或 undefined 表示交给 patch-core 自动检测。
 */
function resolveInstallRoot(installRoot?: string): string | undefined {
  const trimmed = installRoot?.trim();
  return trimmed || undefined;
}

export async function isPatchInstalled(installRoot?: string): Promise<boolean> {
  const result = await runStatus(installRoot);
  return result.patchInstalled === true;
}

export async function runDoctor(installRoot?: string): Promise<PatchOperationResult> {
  const core = await loadCore();
  return core.runDoctor(resolveInstallRoot(installRoot));
}

export async function runApply(installRoot?: string): Promise<PatchOperationResult> {
  const core = await loadCore();
  const bundle = loadBundle();
  return core.applyPatch({
    installRoot: resolveInstallRoot(installRoot),
    replacements: bundle.replacements,
    meta: bundle.meta,
  });
}

export async function runRevert(installRoot?: string): Promise<PatchOperationResult> {
  const core = await loadCore();
  return core.revertPatch(resolveInstallRoot(installRoot));
}

export async function runStatus(installRoot?: string): Promise<PatchOperationResult> {
  const core = await loadCore();
  const bundle = loadBundle();
  return core.getPatchStatus(
    resolveInstallRoot(installRoot),
    bundle.replacements.length,
    bundle.meta?.testedCursorVersion,
  );
}

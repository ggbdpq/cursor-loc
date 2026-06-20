/**
 * @cursor-loc/patch-core 统一 API：apply / revert / status / doctor。
 */
import type { Replacement } from './types.js';
import { createTranslator, loadInterceptorMain } from './services/WindowsTranslator.js';
import {
  checkWriteAccess,
  getAppRoot,
  readCursorVersion,
  resolveCursorInstallPath,
} from './services/pathResolver.js';

export type { Replacement, LocaleModule, PatchStatus } from './types.js';
export { createTranslator, loadInterceptorMain } from './services/WindowsTranslator.js';
export {
  checkWriteAccess,
  getAppRoot,
  readCursorVersion,
  resolveCursorInstallPath,
} from './services/pathResolver.js';

/** 补丁操作统一返回结构。 */
export interface PatchOperationResult {
  ok: boolean;
  lines: string[];
  error?: string;
  versionMismatch?: { tested: string; current: string };
  patchInstalled?: boolean;
}

export interface ApplyPatchOptions {
  installRoot?: string;
  replacements: readonly Replacement[];
  meta?: { testedCursorVersion?: string };
}

/**
 * 解析用户传入的安装根目录；空字符串视为未指定。
 *
 * @param installRoot CLI 或扩展传入的路径。
 * @returns 去空白后的路径，或 undefined 表示走自动检测。
 */
function resolveInstallRoot(installRoot?: string): string | undefined {
  const trimmed = installRoot?.trim();
  return trimmed || undefined;
}

/**
 * 应用汉化补丁。
 */
export async function applyPatch(options: ApplyPatchOptions): Promise<PatchOperationResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      lines: [`不支持的平台: ${process.platform}`, '当前版本仅支持 Windows。'],
    };
  }

  try {
    const installPath = resolveCursorInstallPath(resolveInstallRoot(options.installRoot));
    const root = getAppRoot(installPath);
    const version = readCursorVersion(root);

    const lines: string[] = [
      `路径来源: ${resolveInstallRoot(options.installRoot) ? '当前 Cursor 实例 / 用户配置' : 'CLI 自动检测'}`,
      `检测到 Cursor: ${installPath}`,
    ];
    if (version) {
      lines.push(`版本: ${version}`);
    }
    lines.push(`词典条目: ${options.replacements.length}`);

    const writeCheck = checkWriteAccess(root);
    if (!writeCheck.writable) {
      lines.push('');
      lines.push('错误: 无法写入 Cursor 安装目录。');
      lines.push('请以管理员身份运行 Cursor，或在设置中配置 cursorZh.appRoot。');
      if (writeCheck.error) {
        lines.push(`详情: ${writeCheck.error}`);
      }
      return { ok: false, lines, error: writeCheck.error };
    }

    const translator = createTranslator(installPath, loadInterceptorMain());
    if (!translator.isSupported(process.platform)) {
      return { ok: false, lines: [`不支持的平台: ${process.platform}`] };
    }

    translator.install(options.replacements);
    lines.push('');
    lines.push('汉化补丁已应用。请完全重启 Cursor 查看效果。');
    lines.push('提示: Cursor 更新后可能需要重新应用汉化。');
    return { ok: true, lines };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, lines: [`应用失败: ${message}`], error: message };
  }
}

/**
 * 恢复英文专有界面。
 */
export async function revertPatch(installRoot?: string): Promise<PatchOperationResult> {
  try {
    const installPath = resolveCursorInstallPath(resolveInstallRoot(installRoot));
    const translator = createTranslator(installPath, loadInterceptorMain());
    translator.uninstall();
    return { ok: true, lines: ['已恢复原始界面。请完全重启 Cursor。'] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, lines: [`恢复失败: ${message}`], error: message };
  }
}

/**
 * 查看补丁安装状态。
 */
export async function getPatchStatus(
  installRoot: string | undefined,
  replacementCount: number,
  testedVersion?: string,
): Promise<PatchOperationResult> {
  try {
    const installPath = resolveCursorInstallPath(resolveInstallRoot(installRoot));
    const root = getAppRoot(installPath);
    const version = readCursorVersion(root);
    const translator = createTranslator(installPath, loadInterceptorMain());
    const patchStatus = translator.getStatus();

    const installed =
      patchStatus.translatedFileExists &&
      patchStatus.interceptorExists &&
      patchStatus.packageJsonPatched;

    const lines: string[] = [
      `安装路径: ${installPath}`,
      `Cursor 版本: ${version ?? '未知'}`,
      `词典条目: ${replacementCount}`,
      `补丁状态: ${installed ? '已安装' : '未安装'}`,
      `  - 翻译文件: ${patchStatus.translatedFileExists ? '存在' : '缺失'}`,
      `  - 拦截器: ${patchStatus.interceptorExists ? '存在' : '缺失'}`,
      `  - package.json: ${patchStatus.packageJsonPatched ? '已修改' : '未修改'}`,
    ];

    let versionMismatch: PatchOperationResult['versionMismatch'];
    if (testedVersion && version && version !== testedVersion) {
      lines.push('');
      lines.push(
        `警告: 词典针对 Cursor ${testedVersion} 测试，当前版本 ${version} 可能需要重新 apply 或补充翻译。`,
      );
      versionMismatch = { tested: testedVersion, current: version };
    }

    if (!installed && patchStatus.translatedFileExists) {
      lines.push('');
      lines.push('警告: 补丁文件不完整，建议先恢复英文再重新应用。');
    }

    return { ok: true, lines, versionMismatch, patchInstalled: installed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      lines: [`查询失败: ${message}`],
      error: message,
      patchInstalled: false,
    };
  }
}

/**
 * 环境诊断。
 */
export async function runDoctor(installRoot?: string): Promise<PatchOperationResult> {
  const lines: string[] = [`平台: ${process.platform}`, `Node.js: ${process.version}`];

  if (process.platform !== 'win32') {
    lines.push('', '当前版本仅支持 Windows。');
    return { ok: false, lines };
  }

  try {
    const installPath = resolveCursorInstallPath(resolveInstallRoot(installRoot));
    const root = getAppRoot(installPath);
    const version = readCursorVersion(root);
    const writeCheck = checkWriteAccess(root);

    lines.push('');
    lines.push(
      `路径来源: ${resolveInstallRoot(installRoot) ? '当前 Cursor 实例 / 用户配置' : 'CLI 自动检测'}`,
    );
    lines.push(`Cursor 路径: ${installPath}`);
    lines.push(`Cursor 版本: ${version ?? '未知'}`);
    lines.push(`写权限: ${writeCheck.writable ? '正常' : '不足'}`);

    if (!writeCheck.writable) {
      lines.push('');
      lines.push('建议: 以管理员身份运行 Cursor，或在设置中配置 cursorZh.appRoot。');
      if (writeCheck.error) {
        lines.push(`错误: ${writeCheck.error}`);
      }
      return { ok: false, lines };
    }

    lines.push('');
    lines.push('环境检查通过，可以应用汉化补丁。');
    return { ok: true, lines };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push('', `诊断失败: ${message}`);
    return { ok: false, lines, error: message };
  }
}

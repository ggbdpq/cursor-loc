/**
 * Cursor 专有界面汉化扩展入口。
 *
 * 负责注册命令、启动引导、应用/恢复补丁，并在卸载扩展时自动 revert 专有 UI。
 * 补丁写入逻辑委托给 {@link patchService}，路径解析见 {@link installPath}，冷重启见 {@link restartCursor}。
 */
import * as vscode from 'vscode';
import { resolveEffectiveInstallRoot } from './installPath.js';
import { getOutputChannel, logLine, logSection } from './outputChannel.js';
import {
  isPatchInstalled,
  isBundleReady,
  runApply,
  runDoctor,
  runRevert,
  runStatus,
} from './patchService.js';
import type { PatchOperationResult } from './patchService.js';
import { coldRestartCursor } from './restartCursor.js';

/** 扩展在 marketplace 中的完整 ID（publisher.name）。 */
const EXTENSION_ID = 'ggbdpq.cursor-language-pack-zh-hans';

/** 本扩展支持的平台（引擎层已覆盖 win32 / darwin）。 */
function isSupportedPlatform(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/**
 * deactivate 后判定卸载并触发冷重启的延迟毫秒数。
 * revert 本身在 deactivate 内同步完成，不依赖定时器。
 */
const POST_UNINSTALL_RESTART_DELAY_MS = 1000;

/** 扩展配置节名，对应 package.json contributes.configuration。 */
const CONFIG_SECTION = 'cursorZh';

/** 与 Cursor 设置变更后原生重启弹窗一致的提示文案。 */
const RESTART_REQUIRED_MESSAGE =
  '专有界面汉化已应用，需要重启 Cursor 才能生效。按下「重启」按钮以重新启动 Cursor 并启用汉化。';

/** 原生重启弹窗主按钮文案（对齐截图中的「重启(R)」）。 */
const RESTART_BUTTON = '重启';

/**
 * globalState 键：标记「应用/恢复后正在冷重启」。
 * 新进程启动时用于跳过二次引导弹窗。
 */
const GLOBAL_KEY_RESTARTING = 'cursorZh.restarting';

/**
 * globalState 键：用户曾通过本扩展成功应用补丁。
 * Reload Window 触发 deactivate→revert 后，activate 据此自动写回补丁。
 */
const GLOBAL_KEY_PATCH_APPLIED = 'cursorZh.patchApplied';

/**
 * globalState 键：最近一次 apply 失败时的 Cursor 版本。
 * 同一 Cursor 版本上不再自动重试或反复弹「应用并重启」引导；
 * apply 成功或 Cursor 升级到新版本后自动失效。
 */
const GLOBAL_KEY_APPLY_FAILED_VERSION = 'cursorZh.applyFailedVersion';

/**
 * 冷重启退出前设为 true，使 {@link deactivate} 跳过误触发逻辑。
 * 持久化标记见 {@link GLOBAL_KEY_RESTARTING}（deactivate 无 context，需 globalState）。
 */
let suppressDeactivateRevert = false;

/** activate 时保存，供 deactivate 读取 globalState。 */
let extensionContext: vscode.ExtensionContext | undefined;

/** {@link handleApply} 的可选行为。 */
interface ApplyOptions {
  /** 失败时不弹错误 toast（启动引导用） */
  silent?: boolean;
  /** 成功后立即冷重启，不再弹第二次「重启 Cursor」通知 */
  autoRestart?: boolean;
}

/**
 * 读取用户配置的 Cursor 安装根目录。
 *
 * @returns 非空路径，或 undefined 表示走自动检测
 */
function getConfiguredAppRoot(): string | undefined {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('appRoot', '');
  return value.trim() || undefined;
}

/**
 * 解析本扩展实际使用的 Cursor 安装根目录。
 *
 * @returns 安装根路径；无法解析时 undefined
 */
function getEffectiveInstallRoot(): string | undefined {
  return resolveEffectiveInstallRoot(getConfiguredAppRoot());
}

/**
 * 应用/恢复后的统一冷重启入口。
 *
 * 成功调度重启后保持 `suppressDeactivateRevert`，失败时回滚标志与 globalState。
 *
 * @param context 传入时可写入 {@link GLOBAL_KEY_RESTARTING}
 */
async function restartCursor(context?: vscode.ExtensionContext): Promise<void> {
  suppressDeactivateRevert = true;
  if (context) {
    await context.globalState.update(GLOBAL_KEY_RESTARTING, true);
  }

  logLine('[extension] 开始冷重启 Cursor...');
  const restarted = await coldRestartCursor(getEffectiveInstallRoot());
  if (!restarted) {
    suppressDeactivateRevert = false;
    if (context) {
      await context.globalState.update(GLOBAL_KEY_RESTARTING, false);
    }
    logLine('[extension] 冷重启未能发起，请手动完全退出并重新打开 Cursor。');
    void vscode.window.showWarningMessage(
      '自动重启未能完成，请手动完全退出并重新打开 Cursor 以使汉化生效。',
    );
  }
}

/**
 * 首次安装且未打补丁时，弹出一次「应用并重启」引导。
 *
 * @param context 扩展上下文，用于 handleApply 与 globalState
 */
async function promptApplyAndRestart(context: vscode.ExtensionContext): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    '是否要应用 Cursor 专有界面中文汉化？应用后需要重启 Cursor 才能生效。',
    { modal: true },
    '应用并重启',
  );
  if (choice === '应用并重启') {
    await handleApply(context, { silent: true, autoRestart: true });
  }
}

/** 命令：环境诊断（对齐 CLI doctor）。 */
async function handleDoctor(): Promise<void> {
  const result = await runDoctor(getEffectiveInstallRoot());
  logSection('Cursor 专有界面汉化', result.lines);

  if (result.ok) {
    void vscode.window.showInformationMessage('环境检查通过，可以应用汉化补丁。');
  } else {
    void vscode.window.showErrorMessage(result.error ?? '环境诊断未通过，详见输出面板。');
  }
}

/**
 * 命令：应用汉化补丁。
 *
 * @param context 用于重启与 globalState；命令面板调用时可传 undefined
 * @param options 静默失败 / 自动重启等行为
 * @returns 是否成功写入补丁
 */
async function handleApply(
  context: vscode.ExtensionContext | undefined,
  options: ApplyOptions = {},
): Promise<boolean> {
  const { silent = false, autoRestart = false } = options;

  if (!isBundleReady()) {
    void vscode.window.showErrorMessage(
      '词典 bundle 未就绪。请重新安装完整构建的 .vsix，或开发模式下在仓库根执行 npm run build。',
    );
    return false;
  }

  if (!isSupportedPlatform()) {
    void vscode.window.showErrorMessage('当前支持 Windows 与 macOS（beta）。');
    return false;
  }

  const result = await runApply(getEffectiveInstallRoot());
  logSection('应用汉化补丁', result.lines);

  if (result.ok) {
    if (context) {
      await context.globalState.update(GLOBAL_KEY_PATCH_APPLIED, true);
      await context.globalState.update(GLOBAL_KEY_APPLY_FAILED_VERSION, undefined);
    }
    if (autoRestart) {
      await restartCursor(context);
    } else {
      const choice = await vscode.window.showInformationMessage(
        RESTART_REQUIRED_MESSAGE,
        { modal: true },
        RESTART_BUTTON,
      );
      if (choice === RESTART_BUTTON) {
        await restartCursor(context);
      }
    }
    return true;
  }

  if (!silent) {
    void vscode.window.showErrorMessage(result.error ?? '应用失败，详见输出面板。');
  } else if (result.error) {
    logSection('应用汉化补丁失败', result.lines);
  }
  if (context) {
    // 记录失败时的 Cursor 版本：启动自愈与引导弹窗在同一版本内不再重复触发
    try {
      const status = await runStatus(getEffectiveInstallRoot());
      await context.globalState.update(
        GLOBAL_KEY_APPLY_FAILED_VERSION,
        status.currentVersion ?? 'unknown',
      );
    } catch {
      await context.globalState.update(GLOBAL_KEY_APPLY_FAILED_VERSION, 'unknown');
    }
  }
  return false;
}

/**
 * 命令：恢复专有界面为英文。
 *
 * 用户确认后 revert 并冷重启；不影响 MS 中文语言包。
 *
 * @param context 扩展上下文，用于重启流程
 */
async function handleRevert(context: vscode.ExtensionContext): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    '确定要恢复 Cursor 专有界面为英文吗？',
    { modal: true },
    '恢复',
    '取消',
  );
  if (confirm !== '恢复') {
    return;
  }

  const result = await runRevert(getEffectiveInstallRoot());
  logSection('恢复英文界面', result.lines);

  if (result.ok) {
    await context.globalState.update(GLOBAL_KEY_PATCH_APPLIED, false);
    await restartCursor(context);
  } else {
    void vscode.window.showErrorMessage(result.error ?? '恢复失败，详见输出面板。');
  }
}

/**
 * 命令：查看补丁安装状态。
 *
 * @param silent 为 true 时不弹 toast（预留内部调用）
 */
async function handleStatus(silent = false): Promise<void> {
  const result = await runStatus(getEffectiveInstallRoot());
  logSection('Cursor 专有界面汉化状态', result.lines);

  if (result.versionMismatch) {
    void vscode.window.showWarningMessage(
      `词典针对 Cursor ${result.versionMismatch.tested} 测试，当前 ${result.versionMismatch.current}，建议重新应用或补充翻译。`,
    );
  } else if (result.patchStale) {
    void vscode.window.showWarningMessage(
      '安装目录补丁已过期，Agent Window 等新词条可能未生效。请执行「Cursor 中文：应用界面汉化」或 npm run apply。',
    );
  } else if (!result.ok) {
    if (!silent) {
      void vscode.window.showErrorMessage(result.error ?? '查询失败，详见输出面板。');
    }
  } else if (!silent) {
    const state = result.patchInstalled ? '已安装' : '未安装';
    void vscode.window.showInformationMessage(`专有界面汉化补丁：${state}。详情见输出面板。`);
  }
}

/** 查询补丁状态；失败时返回 undefined（启动路径不应抛错）。 */
async function safeStatus(
  installRoot: string | undefined,
): Promise<PatchOperationResult | undefined> {
  try {
    return await runStatus(installRoot);
  } catch (err) {
    logLine(`[startup] 状态查询失败: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * 启动自愈：Cursor 升级、补丁文件丢失或词典过期时静默重新应用并冷重启。
 *
 * 仅对曾主动应用过汉化（GLOBAL_KEY_PATCH_APPLIED）的实例生效；同一 Cursor 版本上
 * apply 已失败过的跳过重试（{@link GLOBAL_KEY_APPLY_FAILED_VERSION}），避免
 * 「每次启动静默失败 → 反复弹窗」的循环。
 *
 * @param context 扩展上下文
 * @returns 启动时的补丁状态；环境不可检测时为 undefined
 */
async function ensurePatchState(
  context: vscode.ExtensionContext,
): Promise<PatchOperationResult | undefined> {
  if (!isBundleReady() || !isSupportedPlatform()) {
    return undefined;
  }

  const status = await safeStatus(getEffectiveInstallRoot());
  if (!status?.ok) {
    return status;
  }

  if (status.patchInstalled && !status.patchStale) {
    await context.globalState.update(GLOBAL_KEY_PATCH_APPLIED, true);
    return status;
  }

  const wanted = context.globalState.get<boolean>(GLOBAL_KEY_PATCH_APPLIED);
  const failedVersion = context.globalState.get<string>(GLOBAL_KEY_APPLY_FAILED_VERSION);
  if (!wanted || failedVersion === (status.currentVersion ?? 'unknown')) {
    return status;
  }

  logLine('[startup] 检测到补丁缺失或 Cursor 已升级，正在静默重新应用…');
  await handleApply(context, { silent: true, autoRestart: true });
  return status;
}

/**
 * 扩展激活后的启动引导：未打补丁且开启 autoApplyOnInstall 时弹窗。
 *
 * 已安装补丁时一律跳过引导；刚完成冷重启时也跳过，避免重复打扰；
 * 同一 Cursor 版本上 apply 已失败过的不再反复弹窗。
 *
 * @param context 扩展上下文
 * @param status 启动自愈返回的补丁状态；缺省时现查
 */
async function runStartupSetup(
  context: vscode.ExtensionContext,
  status?: PatchOperationResult,
): Promise<void> {
  try {
    if (!isBundleReady() || !isSupportedPlatform()) {
      return;
    }

    const st = status ?? (await safeStatus(getEffectiveInstallRoot()));
    if (st?.patchInstalled) {
      await context.globalState.update(GLOBAL_KEY_PATCH_APPLIED, true);
      if (context.globalState.get<boolean>(GLOBAL_KEY_RESTARTING)) {
        await context.globalState.update(GLOBAL_KEY_RESTARTING, false);
      }
      return;
    }

    if (context.globalState.get<boolean>(GLOBAL_KEY_RESTARTING)) {
      await context.globalState.update(GLOBAL_KEY_RESTARTING, false);
      return;
    }

    const failedVersion = context.globalState.get<string>(GLOBAL_KEY_APPLY_FAILED_VERSION);
    if (failedVersion && failedVersion === (st?.currentVersion ?? 'unknown')) {
      return; // 本版本 apply 已失败过，不再反复弹「应用并重启」
    }

    const autoPrompt = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>('autoApplyOnInstall', true);
    if (!autoPrompt) {
      return;
    }

    await promptApplyAndRestart(context);
  } catch (err) {
    logLine(
      `[startup] 启动引导失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 扩展激活：注册输出通道、四条命令，并异步执行启动引导。
 *
 * @param context VS Code 扩展上下文
 */
export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  context.subscriptions.push(getOutputChannel());

  if (!isBundleReady()) {
    void vscode.window.showErrorMessage(
      'Cursor 专有界面汉化：补丁资源缺失。请安装完整构建的 .vsix 包。',
    );
  }

  if (!isSupportedPlatform()) {
    void vscode.window.showWarningMessage('Cursor 专有界面汉化：当前支持 Windows 与 macOS（beta）。');
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorZh.doctor', () => void handleDoctor()),
    vscode.commands.registerCommand('cursorZh.applyPatch', () => void handleApply(context, { autoRestart: true })),
    vscode.commands.registerCommand('cursorZh.revertPatch', () => void handleRevert(context)),
    vscode.commands.registerCommand('cursorZh.showStatus', () => void handleStatus()),
  );

  void ensurePatchState(context).then((status) => runStartupSetup(context, status));
}

/**
 * 扩展卸载时 revert 安装目录补丁并冷重启。
 *
 * 不在 deactivate 中同步 revert：否则正常退出 / Reload Window 会清掉补丁，
 * 导致 Settings 仍英文且每次启动重复弹「需要重启」。
 *
 * - 冷重启：`suppressDeactivateRevert` / {@link GLOBAL_KEY_RESTARTING} 跳过。
 * - F5 调试：`ExtensionMode.Development` 下不 revert。
 * - Reload Window：延迟后扩展已 re-activate，跳过 revert。
 * - 正常退出 Cursor：进程结束，定时器通常不执行，补丁保留在磁盘。
 * - 卸载 VSIX：延迟后扩展 ID 从列表消失 → revert + 冷重启。
 */
export async function deactivate(): Promise<void> {
  if (suppressDeactivateRevert) {
    suppressDeactivateRevert = false;
    return;
  }

  if (extensionContext?.globalState.get<boolean>(GLOBAL_KEY_RESTARTING)) {
    return;
  }

  const ctx = extensionContext;
  extensionContext = undefined;

  if (!ctx || ctx.extensionMode === vscode.ExtensionMode.Development) {
    return;
  }

  const installRoot = getEffectiveInstallRoot();

  setTimeout(() => {
    void (async () => {
      try {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        if (ext?.isActive) {
          return;
        }
        if (ext) {
          // 仍注册但未激活：多为退出过程，勿误 revert（禁用扩展请用手动「恢复英文」）
          return;
        }

        const patched = await isPatchInstalled(installRoot);
        if (!patched) {
          return;
        }

        const result = await runRevert(installRoot);
        logSection('扩展已卸载，已恢复英文界面（安装目录补丁已移除）', result.lines);
        if (!result.ok) {
          return;
        }

        suppressDeactivateRevert = true;
        logLine('[deactivate] 扩展已卸载，正在自动重启 Cursor 以显示英文界面…');
        await coldRestartCursor(installRoot);
      } catch (err) {
        logLine(
          `[deactivate] revert 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }, POST_UNINSTALL_RESTART_DELAY_MS);
}

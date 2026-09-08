/**
 * Cursor 专有界面汉化扩展入口（0.0.9：增量翻译引擎 + 手动应用）。
 *
 * 0.0.8 及更早版本的「attachShadow 劫持 + body 全量 MutationObserver +
 * 每 100ms 定时全页扫描」会拖慢编辑器打字与滚动；0.0.9 将注入脚本重写为
 * 增量引擎（只翻译变更节点 + O(1) exact 词典 + 零轮询）。
 *
 * 补丁只在用户手动执行「应用界面汉化」时写入 Cursor 安装目录；
 * 启动自愈与安装引导已移除，扩展激活时不修改任何安装目录文件。
 * 其他职责：恢复英文（revert）、状态查看（status）、环境诊断（doctor）、
 * 卸载扩展时自动清理残留补丁。
 */
import * as vscode from 'vscode';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEffectiveInstallRoot } from './installPath.js';
import { getOutputChannel, logLine, logSection } from './outputChannel.js';
import {
  isBundleReady,
  isPatchInstalled,
  runApply,
  runDoctor,
  runRevert,
  runStatus,
} from './patchService.js';
import { coldRestartCursor, scheduleRestartOnQuit } from './restartCursor.js';
import { uninstallTrace } from './uninstallTrace.js';

/** 扩展在 marketplace 中的完整 ID（publisher.name）。 */
const EXTENSION_ID = 'ggbdpq.cursor-language-pack-zh-hans';

/** 本扩展支持的平台。 */
function isSupportedPlatform(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/** 扩展配置节名，对应 package.json contributes.configuration。 */
const CONFIG_SECTION = 'cursorZh';

/**
 * globalState 键：标记「恢复后正在冷重启」。
 * 冷重启后的首次激活将其清除，保证此后真正卸载扩展时清理逻辑可正常执行。
 */
const GLOBAL_KEY_RESTARTING = 'cursorZh.restarting';

/**
 * globalState 键：用户拒绝应用引导时的 Cursor 版本。
 * 同一 Cursor 版本内不再重复弹引导；升级到新版本后再弹一次。
 */
const GLOBAL_KEY_APPLY_DECLINED_VERSION = 'cursorZh.applyDeclinedVersion';

/**
 * globalState 键：本窗口已弹过引导的时间戳。
 * 主窗与 Agent 窗各自激活扩展实例；先抢到的窗口写入标记，后激活的
 * 窗口看到标记即跳过，避免同一时刻弹两个引导。
 */
const GLOBAL_KEY_PROMPT_PENDING_AT = 'cursorZh.promptPendingAt';

/**
 * 冷重启退出前设为 true，使 {@link deactivate} 跳过误触发逻辑。
 * 持久化标记见 {@link GLOBAL_KEY_RESTARTING}（deactivate 无 context，需 globalState）。
 */
let suppressDeactivateRevert = false;

/** activate 时保存，供 deactivate 读取 globalState。 */
let extensionContext: vscode.ExtensionContext | undefined;
let uninstallRunning = false;

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
 * 恢复后的统一冷重启入口。
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
      '自动重启未能完成，请手动完全退出并重新打开 Cursor 以使设置生效。',
    );
  }
}

/** 命令：环境诊断（对齐 CLI doctor）。 */
async function handleDoctor(): Promise<void> {
  const result = await runDoctor(getEffectiveInstallRoot());
  logSection('Cursor 专有界面汉化', result.lines);

  if (result.ok) {
    void vscode.window.showInformationMessage('环境检查通过。');
  } else {
    void vscode.window.showErrorMessage(result.error ?? '环境诊断未通过，详见输出面板。');
  }
}

/**
 * 命令：应用汉化补丁（仅用户手动触发）。
 *
 * 写入安装目录补丁并提示冷重启；失败时记录版本，同一 Cursor 版本内
 * 不再反复弹错。
 *
 * @param context 用于重启流程
 */
async function handleApply(context: vscode.ExtensionContext): Promise<void> {
  if (!isBundleReady()) {
    void vscode.window.showErrorMessage(
      '词典 bundle 未就绪。请重新安装完整构建的 .vsix，或开发模式下在仓库根执行 npm run build。',
    );
    return;
  }

  if (!isSupportedPlatform()) {
    void vscode.window.showErrorMessage('当前支持 Windows 与 macOS（beta）。');
    return;
  }

  const result = await runApply(getEffectiveInstallRoot());
  logSection('应用汉化补丁', result.lines);

  if (result.ok) {
    // 引导弹窗里用户已选「应用并重启」，这里不再二次确认，直接冷重启
    await restartCursor(context);
    return;
  }

  void vscode.window.showErrorMessage(result.error ?? '应用失败，详见输出面板。');
}

/**
 * 命令：清理残留补丁，恢复专有界面为英文。
 *
 * 用户确认后 revert 并冷重启；不影响 MS 中文语言包。
 *
 * @param context 扩展上下文，用于重启流程
 */
async function handleRevert(context: vscode.ExtensionContext): Promise<void> {
  // 只放一个确认按钮；「Cancel」由 VS Code 自动补，自写「取消」会出现两个等价按钮
  const confirm = await vscode.window.showWarningMessage(
    '确定要恢复 Cursor 专有界面为英文吗？恢复后需重启 Cursor。',
    { modal: true },
    '恢复英文并重启',
  );
  if (confirm !== '恢复英文并重启') {
    return;
  }

  const result = await runRevert(getEffectiveInstallRoot());
  logSection('恢复英文界面', result.lines);

  if (result.ok) {
    await restartCursor(context);
  } else {
    void vscode.window.showErrorMessage(result.error ?? '恢复失败，详见输出面板。');
  }
}

/**
 * 命令：查看残留补丁状态。
 *
 * @param silent 为 true 时不弹 toast（预留内部调用）
 */
async function handleStatus(silent = false): Promise<void> {
  const result = await runStatus(getEffectiveInstallRoot());
  logSection('Cursor 专有界面汉化状态', result.lines);

  if (result.patchStale) {
    void vscode.window.showWarningMessage(
      '检测到旧版残留补丁（含拖慢编辑器的 DOM 翻译扫描器）。请执行「Cursor 中文：恢复英文界面」清理。',
    );
  } else if (!result.ok) {
    if (!silent) {
      void vscode.window.showErrorMessage(result.error ?? '查询失败，详见输出面板。');
    }
  } else if (!silent) {
    const state = result.patchInstalled ? '检测到残留补丁' : '无残留';
    void vscode.window.showInformationMessage(`专有界面补丁状态：${state}。详情见输出面板。`);
  }
}

/**
 * 首次安装且未打补丁时，弹出一次「应用并重启」引导。
 *
 * 只询问不写入：用户点击「应用并重启」才执行补丁；拒绝后同一 Cursor
 * 版本内不再弹（升级后再弹一次）。启动自愈（静默重打补丁）已移除。
 * 主窗与 Agent 窗各自激活扩展：先抢到的窗口写入 PENDING_AT 标记，
 * 后激活的窗口看到标记即跳过，避免双弹。
 */
async function runStartupSetup(context: vscode.ExtensionContext): Promise<void> {
  try {
    if (!isBundleReady() || !isSupportedPlatform()) {
      return;
    }
    if (context.globalState.get<boolean>(GLOBAL_KEY_RESTARTING)) {
      return;
    }

    const status = await runStatus(getEffectiveInstallRoot()).catch(() => undefined);
    if (!status?.ok || status.patchInstalled) {
      return;
    }

    const version = status.currentVersion ?? 'unknown';
    if (context.globalState.get<string>(GLOBAL_KEY_APPLY_DECLINED_VERSION) === version) {
      return;
    }

    // 跨窗口去重：标记已存在（另一窗口正在弹）则本窗口跳过
    const pendingAt = context.globalState.get<number>(GLOBAL_KEY_PROMPT_PENDING_AT);
    if (pendingAt && Date.now() - pendingAt < 60_000) {
      return;
    }
    await context.globalState.update(GLOBAL_KEY_PROMPT_PENDING_AT, Date.now());

    const choice = await vscode.window.showInformationMessage(
      '是否要应用 Cursor 专有界面中文汉化？应用后需要重启 Cursor 才能生效。',
      { modal: true },
      '应用并重启',
    );
    await context.globalState.update(GLOBAL_KEY_PROMPT_PENDING_AT, undefined);
    if (choice === '应用并重启') {
      await handleApply(context);
    } else {
      await context.globalState.update(GLOBAL_KEY_APPLY_DECLINED_VERSION, version);
    }
  } catch (err) {
    logLine(`[startup] 安装引导失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 扩展激活：注册输出通道与四条命令，并异步执行一次性安装引导。
 *
 * 不再执行任何启动自愈或引导（0.0.9 起不写安装目录）；
 * 仅清除冷重启标记，保证此后卸载扩展时清理逻辑可正常执行。
 *
 * @param context VS Code 扩展上下文
 */
export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  uninstallTrace('activate', { build: '0.0.9-uninstall-watch-2', version: context.extension?.packageJSON?.version, extensionPath: context.extensionPath });
  context.subscriptions.push(getOutputChannel());

  if (!isSupportedPlatform()) {
    void vscode.window.showWarningMessage('Cursor 专有界面汉化：当前支持 Windows 与 macOS（beta）。');
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorZh.applyPatch', () => void handleApply(context)),
    vscode.commands.registerCommand('cursorZh.revertPatch', () => void handleRevert(context)),
    vscode.commands.registerCommand('cursorZh.showStatus', () => void handleStatus()),
    vscode.commands.registerCommand('cursorZh.doctor', () => void handleDoctor()),
  );

  void context.globalState.update(GLOBAL_KEY_RESTARTING, false);
  void runStartupSetup(context);
  if (context.extensionMode !== vscode.ExtensionMode.Development) {
    try {
      const watcher = fs.watch(path.join(os.homedir(), '.cursor', 'extensions'),
        { persistent: false }, () => { void cleanupAfterUninstall(); });
      watcher.on('error', (error) => uninstallTrace('watch.error', error));
      context.subscriptions.push({ dispose: () => watcher.close() });
      uninstallTrace('watch.ready');
    } catch (error) {
      uninstallTrace('watch.error', error);
    }
  }
}

/**
 * 判断本扩展是否已被卸载。
 *
 * 磁盘事实有两处（都在用户主目录 ~/.cursor/extensions/）：
 * - `extensions.json`：已安装扩展清单，VSIX 卸载后立即不含本扩展；
 * - `.obsolete`：标记待删除的扩展文件夹，卸载后写入本扩展条目。
 *
 * 两处任一表明已卸载即返回 true；两处都无法读取（首装前、路径变化）
 * 时返回 false——宁可不动，不误还原。
 *
 * @param manifestPath 注入用；默认 ~/.cursor/extensions/extensions.json
 * @param obsoletePath 注入用；默认 ~/.cursor/extensions/.obsolete
 */
export function isExtensionUninstalled(manifestPath?: string, obsoletePath?: string): boolean {
  const id = EXTENSION_ID.toLowerCase();
  const extDir = path.join(os.homedir(), '.cursor', 'extensions');
  const manifest = manifestPath ?? path.join(extDir, 'extensions.json');
  const obsolete = obsoletePath ?? path.join(extDir, '.obsolete');

  let manifestReadable = false;
  try {
    const entries = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as Array<{
      identifier?: { id?: string };
    }>;
    manifestReadable = true;
    if (!entries.some((entry) => entry.identifier?.id?.toLowerCase() === id)) {
      return true;
    }
  } catch {
    // 清单缺失或损坏，交给 .obsolete 判定
  }

  try {
    const obsoleteMap = JSON.parse(fs.readFileSync(obsolete, 'utf-8')) as Record<string, unknown>;
    if (Object.keys(obsoleteMap).some((key) => key.toLowerCase().startsWith(id))) {
      return true;
    }
  } catch {
    // 无 .obsolete 标记
  }

  return false;
}

/**
 * 扩展卸载时清理安装目录残留补丁并冷重启。
 *
 * 卸载判定走磁盘事实（{@link isExtensionUninstalled}），在 deactivate 内
 * 同步完成——不依赖延时定时器（旧实现的 1 秒 setTimeout 会在扩展宿主
 * 退出后永不执行，导致补丁残留且无提示）。
 *
 * - 冷重启：`suppressDeactivateRevert` / {@link GLOBAL_KEY_RESTARTING} 跳过。
 * - F5 调试：`ExtensionMode.Development` 下不 revert。
 * - Reload Window：清单仍含本扩展（进程退出前不重写），不 revert。
 * - 正常退出 Cursor：清单仍含本扩展，状态保持。
 * - 卸载 VSIX：清单已不含本扩展 → 立即 revert + 冷重启。
 */
export async function deactivate(): Promise<void> {
  uninstallTrace('deactivate.enter');
  await cleanupAfterUninstall();
  extensionContext = undefined;
}

async function cleanupAfterUninstall(): Promise<void> {
  if (uninstallRunning) return;
  if (suppressDeactivateRevert) {
    suppressDeactivateRevert = false;
    uninstallTrace('skip.suppressed');
    return;
  }
  if (extensionContext?.globalState.get<boolean>(GLOBAL_KEY_RESTARTING)) {
    uninstallTrace('skip.restarting');
    return;
  }
  const ctx = extensionContext;
  if (!ctx || ctx.extensionMode === vscode.ExtensionMode.Development) {
    uninstallTrace('skip.context', { mode: ctx?.extensionMode });
    return;
  }
  if (!isExtensionUninstalled()) {
    uninstallTrace('skip.installed');
    return;
  }

  uninstallRunning = true;
  try {
    const installRoot = getEffectiveInstallRoot();
    uninstallTrace('status.begin', { installRoot });
    const installed = await isPatchInstalled(installRoot);
    uninstallTrace('status.end', { installed });
    if (!installed) return;

    uninstallTrace('schedule.begin');
    let scheduled = false;
    try {
      scheduled = await scheduleRestartOnQuit(installRoot);
    } catch (error) {
      uninstallTrace('schedule.error', error);
    }
    uninstallTrace('schedule.end', { scheduled });
    uninstallTrace('revert.begin');
    const result = await runRevert(installRoot);
    uninstallTrace('revert.end', result);
    if (!result.ok || !scheduled) return;

    suppressDeactivateRevert = true;
    uninstallTrace('quit.request');
    // 宿主拆除时 RPC 可能已经关闭；看门狗回执才是外部进程启动证据。
    void vscode.commands.executeCommand('workbench.action.quit').then(
      () => uninstallTrace('quit.resolved'),
      (error: unknown) => uninstallTrace('quit.rejected', error),
    );
  } catch (error) {
    uninstallTrace('deactivate.error', error);
  } finally {
    uninstallTrace('deactivate.end');
  }
}

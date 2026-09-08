import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { logLine } from './outputChannel.js';

const execFileAsync = promisify(execFile);

/**
 * 定位 Cursor 可执行文件（Windows）。
 */
export function resolveCursorExecutable(installRoot: string): string | undefined {
  for (const name of ['Cursor.exe', 'cursor.exe']) {
    const exe = path.join(installRoot, name);
    if (fs.existsSync(exe)) {
      return exe;
    }
  }
  return undefined;
}

/**
 * 解析用于冷启动的 Cursor 可执行文件。
 * 优先当前进程 execPath（扩展宿主内最可靠），其次 installRoot。
 */
export function resolveCursorExecutableForRestart(installRoot: string | undefined): string | undefined {
  const execPath = process.execPath;
  logLine(`[restart] 当前进程 execPath: ${execPath}`);

  if (process.platform === 'darwin') {
    // macOS 可执行文件形如 /Applications/Cursor.app/Contents/MacOS/Cursor
    if (execPath && fs.existsSync(execPath) && execPath.includes('.app/Contents/MacOS/')) {
      return execPath;
    }
    if (installRoot) {
      const candidate = path.join(installRoot, 'MacOS', 'Cursor');
      if (fs.existsSync(candidate)) {
        logLine(`[restart] 从安装根目录定位到: ${candidate}`);
        return candidate;
      }
    }
    return undefined;
  }

  if (execPath && fs.existsSync(execPath) && /cursor\.exe$/i.test(execPath)) {
    return execPath;
  }

  if (installRoot) {
    const fromRoot = resolveCursorExecutable(installRoot);
    if (fromRoot) {
      logLine(`[restart] 从安装根目录定位到: ${fromRoot}`);
      return fromRoot;
    }
  }

  return undefined;
}

/** macOS：从可执行文件路径推出 .app 应用包路径。 */
function resolveMacAppBundle(exePath: string): string | undefined {
  const index = exePath.indexOf('.app/');
  return index >= 0 ? exePath.slice(0, index + '.app'.length) : undefined;
}

/**
 * 带超时执行工作台命令。
 */
function executeCommandWithTimeout(command: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (ok: boolean, detail?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      logLine(`[restart] 命令 ${command} ${ok ? '已返回' : detail ?? '未生效'}。`);
      resolve(ok);
    };
    timer = setTimeout(() => finish(false, `超时(${ms}ms)`), ms);
    vscode.commands.executeCommand(command).then(
      () => finish(true),
      (err: unknown) =>
        finish(false, `不可用或失败: ${err instanceof Error ? err.message : String(err)}`),
    );
  });
}

function formatSchtasksStartTime(minutesFromNow: number): string {
  const date = new Date(Date.now() + minutesFromNow * 60_000);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatSchtasksStartDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/** 将路径写入批处理/VBS 时的转义（双引号加倍）。 */
function escapeBatchPath(value: string): string {
  return value.replace(/"/g, '""');
}

/** 将路径写入 VBS 双引号字符串时的转义。 */
function escapeVbsPath(value: string): string {
  return value.replace(/"/g, '""');
}

/**
 * 生成看门狗批处理 + VBS 启动器，并通过 schtasks 调度（脱离 Cursor Job Object）。
 *
 * 说明：Cursor 内置「重启」走 Electron app.relaunch()，扩展无法调用；
 * workbench.action.restart 在 Cursor 中不存在，因此必须用独立进程看门狗。
 */
async function scheduleHiddenRestart(exe: string): Promise<boolean> {
  const stamp = `${Date.now()}`;
  const taskName = `CursorZhRestart_${stamp}`;
  const scriptPath = path.join(os.tmpdir(), `cursor-zh-restart-${stamp}.bat`);
  const vbsPath = path.join(os.tmpdir(), `cursor-zh-restart-${stamp}.vbs`);
  const logPath = path.join(os.tmpdir(), `cursor-zh-restart-${stamp}.log`);
  const cursorDir = path.dirname(exe);

  const batchExe = escapeBatchPath(exe);
  const batchDir = escapeBatchPath(cursorDir);
  const batchLog = escapeBatchPath(logPath);
  const batchTask = escapeBatchPath(taskName);
  const batchVbs = escapeBatchPath(vbsPath);

  const sys32 = 'C:\\Windows\\System32';
  const batchContent = [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    `set "CURSOR_EXE=${batchExe}"`,
    `set "CURSOR_DIR=${batchDir}"`,
    `set "TASK_NAME=${batchTask}"`,
    `set "VBS_PATH=${batchVbs}"`,
    '',
    'call :log "watchdog start"',
    'call :log "exe=%CURSOR_EXE%"',
    '',
    `${sys32}\\timeout.exe /t 2 /nobreak >nul 2>&1`,
    '',
    'set /a attempts=0',
    ':waitloop',
    `${sys32}\\tasklist.exe /FI "IMAGENAME eq Cursor.exe" /NH 2>nul | ${sys32}\\find.exe /i "Cursor.exe" >nul`,
    'if errorlevel 1 goto gone',
    'set /a attempts+=1',
    'if !attempts! geq 20 goto forcekill',
    `${sys32}\\timeout.exe /t 1 /nobreak >nul 2>&1`,
    'goto waitloop',
    '',
    ':forcekill',
    'call :log "timeout 20s: force kill leftover Cursor.exe"',
    `${sys32}\\taskkill.exe /F /IM Cursor.exe /T >nul 2>&1`,
    `${sys32}\\timeout.exe /t 2 /nobreak >nul 2>&1`,
    '',
    ':gone',
    'call :log "cursor exited, launching"',
    'cd /d "%CURSOR_DIR%"',
    'start "" "%CURSOR_EXE%"',
    `${sys32}\\timeout.exe /t 3 /nobreak >nul 2>&1`,
    `${sys32}\\tasklist.exe /FI "IMAGENAME eq Cursor.exe" /NH 2>nul | ${sys32}\\find.exe /i "Cursor.exe" >nul`,
    'if not errorlevel 1 goto launchok',
    'call :log "start failed, retry via PowerShell Start-Process"',
    `${sys32}\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -LiteralPath '%CURSOR_EXE%'"`,
    `${sys32}\\timeout.exe /t 3 /nobreak >nul 2>&1`,
    ':launchok',
    'call :log "launch OK"',
    '',
    `${sys32}\\schtasks.exe /delete /tn "%TASK_NAME%" /f >nul 2>&1`,
    'del "%VBS_PATH%" >nul 2>&1',
    'del "%~f0" >nul 2>&1',
    'exit /b 0',
    '',
    ':log',
    `echo [%date% %time%] %~1 >> "${batchLog}"`,
    'exit /b 0',
  ].join('\r\n');

  const vbsContent = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run "cmd /c ""${escapeVbsPath(scriptPath)}""", 0, False`,
  ].join('\r\n');

  fs.writeFileSync(scriptPath, batchContent, 'utf8');
  fs.writeFileSync(vbsPath, vbsContent, 'utf8');
  logLine(`[restart] 已生成看门狗脚本: ${scriptPath}`);
  logLine(`[restart] 已生成 VBS 启动器: ${vbsPath}`);
  logLine(`[restart] 看门狗日志: ${logPath}`);

  const taskCommand = `wscript.exe //B "${vbsPath}"`;
  const startTime = formatSchtasksStartTime(1);
  const startDate = formatSchtasksStartDate();

  try {
    logLine(`[restart] 创建 schtasks 任务: ${taskName}`);
    logLine(`[restart] schtasks /tr: ${taskCommand}`);
    await execFileAsync(
      `${sys32}\\schtasks.exe`,
      [
        '/create',
        '/tn',
        taskName,
        '/tr',
        taskCommand,
        '/sc',
        'once',
        '/sd',
        startDate,
        '/st',
        startTime,
        '/f',
      ],
      { windowsHide: true },
    );

    logLine(`[restart] 触发 schtasks 任务: ${taskName}`);
    await execFileAsync(`${sys32}\\schtasks.exe`, ['/run', '/tn', taskName], { windowsHide: true });

    logLine('[restart] schtasks 调度成功（看门狗已独立于 Cursor 进程树运行）。');
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
    logLine(`[restart] schtasks 调度失败${code ? ` (code=${code})` : ''}: ${message}`);
    return false;
  }
}

/**
 * macOS 冷重启看门狗：等 Cursor 退出（最多 20 秒后强杀）再 `open` 拉起新实例。
 *
 * detached + unref 的 POSIX 子进程不受父进程退出影响，无需 schtasks 绕行。
 */
async function scheduleMacRestart(bundlePath: string): Promise<boolean> {
  const stamp = `${Date.now()}`;
  const scriptPath = path.join(os.tmpdir(), `cursor-zh-restart-${stamp}.sh`);
  const logPath = path.join(os.tmpdir(), `cursor-zh-restart-${stamp}.log`);
  const q = (value: string): string => value.replace(/"/g, '\\"');

  const script = [
    'sleep 2',
    'i=0',
    'while [ $i -lt 20 ]; do',
    '  pgrep -x Cursor >/dev/null 2>&1 || break',
    '  sleep 1',
    '  i=$((i+1))',
    'done',
    'if pgrep -x Cursor >/dev/null 2>&1; then',
    `  echo ` +
      `"[$(date '+%H:%M:%S')] force kill" >> "${q(logPath)}"`,
    '  pkill -f "Cursor.app/Contents/MacOS/Cursor" 2>/dev/null',
    '  sleep 2',
    'fi',
    `echo "[$(date '+%H:%M:%S')] launching" >> "${q(logPath)}"`,
    `open "${q(bundlePath)}"`,
    'sleep 3',
    `pgrep -x Cursor >/dev/null 2>&1 && echo "[$(date '+%H:%M:%S')] launch OK" >> "${q(logPath)}" || echo "[$(date '+%H:%M:%S')] launch FAILED" >> "${q(logPath)}"`,
    `rm -f "${q(scriptPath)}"`,
  ].join('\n');

  fs.writeFileSync(scriptPath, script, 'utf8');
  logLine(`[restart] 已生成 macOS 看门狗脚本: ${scriptPath}`);
  logLine(`[restart] 看门狗日志: ${logPath}`);

  try {
    const child = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' });
    child.unref();
    logLine('[restart] macOS 看门狗已独立于 Cursor 进程树运行。');
    return true;
  } catch (err: unknown) {
    logLine(`[restart] 看门狗启动失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * 卸载路径专用看门狗：经 explorer.exe 转发启动，spawn 即返回、零 await。
 *
 * 卸载扩展后扩展宿主约 1 秒内被回收，deactivate 里 await schtasks
 * （/create + /run 约 1-2 秒）大概率被截断——实测「还原完成了、重启调度
 * 没了」。explorer.exe 把命令转发给常驻 shell（不在 Cursor 的 Job Object
 * 内）后立即返回，看门狗从此与扩展宿主生死无关。
 *
 * BAT 内不含 schtasks：转发本身已脱离进程树，无需任务计划中转。
 */
export function scheduleDetachedRestartOnQuit(exe: string): boolean {
  const stamp = `${Date.now()}`;
  const scriptPath = path.join(os.tmpdir(), `cursor-zh-quitwatch-${stamp}.bat`);
  const vbsPath = path.join(os.tmpdir(), `cursor-zh-quitwatch-${stamp}.vbs`);
  const logPath = path.join(os.tmpdir(), `cursor-zh-quitwatch-${stamp}.log`);
  const cursorDir = path.dirname(exe);

  const sys32 = 'C:\\Windows\\System32';
  const batchContent = [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    `set "CURSOR_EXE=${escapeBatchPath(exe)}"`,
    `set "CURSOR_DIR=${escapeBatchPath(cursorDir)}"`,
    '',
    'call :log "quit watchdog start"',
    `${sys32}\\timeout.exe /t 2 /nobreak >nul 2>&1`,
    '',
    'set /a attempts=0',
    ':waitloop',
    `${sys32}\\tasklist.exe /FI "IMAGENAME eq Cursor.exe" /NH 2>nul | ${sys32}\\find.exe /i "Cursor.exe" >nul`,
    'if errorlevel 1 goto gone',
    'set /a attempts+=1',
    'if !attempts! geq 20 goto forcekill',
    `${sys32}\\timeout.exe /t 1 /nobreak >nul 2>&1`,
    'goto waitloop',
    '',
    ':forcekill',
    'call :log "timeout 20s: force kill leftover Cursor.exe"',
    `${sys32}\\taskkill.exe /F /IM Cursor.exe /T >nul 2>&1`,
    `${sys32}\\timeout.exe /t 2 /nobreak >nul 2>&1`,
    '',
    ':gone',
    'call :log "cursor exited, launching"',
    'cd /d "%CURSOR_DIR%"',
    'start "" "%CURSOR_EXE%"',
    'call :log "relaunch issued"',
    `del "${escapeBatchPath(vbsPath)}" >nul 2>&1`,
    'del "%~f0" >nul 2>&1',
    'exit /b 0',
    '',
    ':log',
    `echo [%date% %time%] %~1 >> "${escapeBatchPath(logPath)}"`,
    'exit /b 0',
  ].join('\r\n');

  const vbsContent = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run "cmd /c ""${escapeVbsPath(scriptPath)}""", 0, False`,
  ].join('\r\n');

  fs.writeFileSync(scriptPath, batchContent, 'utf8');
  fs.writeFileSync(vbsPath, vbsContent, 'utf8');
  logLine(`[restart] 已生成卸载看门狗脚本: ${scriptPath}`);
  logLine(`[restart] 看门狗日志: ${logPath}`);

  try {
    // explorer 转发给常驻 shell 后立即退出；转发出的 cmd 不在 Cursor Job Object 内
    spawn('explorer.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref();
    logLine('[restart] 卸载看门狗已经 explorer 转发启动（独立于 Cursor 进程树）。');
    return true;
  } catch (err: unknown) {
    logLine(`[restart] 卸载看门狗启动失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * 卸载路径的调度入口：只负责把看门狗安排出去（不触发 quit），保证
 * deactivate 在宿主被回收前把「重启」这件事先送出进程树。
 *
 * Windows 走 explorer 转发；macOS 复用 detached 脚本（本就不受 Job 限制）。
 */
export async function scheduleRestartOnQuit(installRoot: string | undefined): Promise<boolean> {
  if (process.platform === 'darwin') {
    const exe = resolveCursorExecutableForRestart(installRoot);
    const bundle = exe ? resolveMacAppBundle(exe) : undefined;
    if (!bundle) {
      logLine('[restart] 无法定位 Cursor.app，卸载后将需手动重启。');
      return false;
    }
    return scheduleMacRestart(bundle);
  }

  if (process.platform !== 'win32') {
    logLine('[restart] 当前平台不支持卸载自动重启。');
    return false;
  }

  const exe = resolveCursorExecutableForRestart(installRoot);
  if (!exe) {
    logLine('[restart] 无法定位 Cursor 可执行文件，卸载后将需手动重启。');
    void vscode.window.showWarningMessage('无法定位 Cursor 可执行文件，补丁已还原；请手动重启 Cursor 以回到英文界面。');
    return false;
  }
  return scheduleDetachedRestartOnQuit(exe);
}

/**
 * 冷启动 Cursor：schtasks 看门狗负责「关旧开新」，扩展侧仅尽力触发 quit。
 *
 * Cursor 自带重启 ≠ workbench 命令，而是 Electron 内部 relaunch；扩展无权调用。
 * quit 在 Cursor 中常超时/no-op 属预期，看门狗会在 20 秒后 taskkill 并拉起新实例。
 */
export async function coldRestartCursor(installRoot: string | undefined): Promise<boolean> {
  if (process.platform === 'darwin') {
    const exe = resolveCursorExecutableForRestart(installRoot);
    const bundle = exe ? resolveMacAppBundle(exe) : undefined;
    if (!bundle) {
      logLine('[restart] 无法定位 Cursor.app，请手动完全退出后重新打开 Cursor。');
      void vscode.window.showWarningMessage(
        '无法定位 Cursor.app，请手动完全退出后重新打开 Cursor。',
      );
      return false;
    }
    logLine(`[restart] 将使用应用包: ${bundle}`);
    const scheduled = await scheduleMacRestart(bundle);
    if (!scheduled) {
      void vscode.window.showInformationMessage(
        '自动重启调度失败。请手动完全退出 Cursor 后重新打开以使汉化生效。',
      );
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    logLine('[restart] 尝试 workbench.action.quit（Cursor 无内置 restart 命令，由看门狗兜底）。');
    await executeCommandWithTimeout('workbench.action.quit', 3000);
    return true;
  }

  if (process.platform !== 'win32') {
    logLine('[restart] 当前平台不支持自动重启。');
    return false;
  }

  const exe = resolveCursorExecutableForRestart(installRoot);
  if (!exe) {
    logLine('[restart] 无法定位 Cursor 可执行文件。');
    void vscode.window.showWarningMessage(
      '无法定位 Cursor 可执行文件，请手动完全退出后重新打开 Cursor。',
    );
    return false;
  }
  logLine(`[restart] 将使用可执行文件: ${exe}`);

  const scheduled = await scheduleHiddenRestart(exe);
  if (!scheduled) {
    void vscode.window.showInformationMessage(
      '自动重启调度失败（通常不是权限问题）。请手动完全退出 Cursor 后重新打开以使汉化生效。',
    );
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, 800));

  logLine('[restart] 尝试 workbench.action.quit（Cursor 无内置 restart 命令，由看门狗兜底）。');
  await executeCommandWithTimeout('workbench.action.quit', 3000);

  logLine('[restart] 若 Cursor 未立即关闭，看门狗将在最多 20 秒内强制结束并重新启动。');
  return true;
}

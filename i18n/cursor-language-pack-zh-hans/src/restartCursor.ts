import { execFile } from 'node:child_process';
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
 * 冷启动 Cursor：schtasks 看门狗负责「关旧开新」，扩展侧仅尽力触发 quit。
 *
 * Cursor 自带重启 ≠ workbench 命令，而是 Electron 内部 relaunch；扩展无权调用。
 * quit 在 Cursor 中常超时/no-op 属预期，看门狗会在 20 秒后 taskkill 并拉起新实例。
 */
export async function coldRestartCursor(installRoot: string | undefined): Promise<boolean> {
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

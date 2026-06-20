/**
 * 进程检测辅助（Windows）。
 *
 * 用于 apply 前风险提示：Cursor 主进程运行时写入安装目录可能需管理员权限。
 */
import { execSync } from 'node:child_process';

/**
 * 检测 Cursor 主进程是否正在运行。
 *
 * 在 Cursor 扩展宿主内执行 apply 时通常为 true，仅作风险提示，不阻断操作。
 *
 * @returns Windows 上 tasklist 能匹配到 Cursor.exe 时为 true
 */
export function isCursorRunning(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    const output = execSync('tasklist /FI "IMAGENAME eq Cursor.exe" /NH', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // /NH 无表头；无进程时输出 "INFO: No tasks are running..."
    return /cursor\.exe/i.test(output);
  } catch {
    return false;
  }
}

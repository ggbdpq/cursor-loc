import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 卸载阶段不依赖可能已释放的工作台 RPC；日志失败不阻断清理。 */
export function uninstallTrace(event: string, detail?: unknown): void {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'cursor-zh-deactivate-trace.log'),
      `${JSON.stringify({ time: new Date().toISOString(), pid: process.pid, event,
        detail: detail instanceof Error ? detail.stack : detail })}\n`, 'utf8');
  } catch {
    // 临时目录可能不可写，仍继续还原。
  }
}

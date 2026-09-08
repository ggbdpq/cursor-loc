/**
 * 卸载路径看门狗测试（scheduleRestartOnQuit）。
 *
 * 缺陷背景：卸载扩展后扩展宿主约 1 秒内被回收，deactivate 里
 * await schtasks（/create + /run，约 1-2 秒）大概率被截断——实测
 * 「还原完成了、重启调度没了」。explorer.exe 会把命令转发给常驻
 * shell（不在 Cursor 的 Job Object 内）后立即返回，spawn 即返回、
 * 零 await，看门狗与扩展宿主生死无关。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpawn = vi.fn().mockReturnValue({ unref: vi.fn() });
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFile: vi.fn(),
}));
vi.mock('node:fs', () => ({
  default: {
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));
vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  commands: { executeCommand: vi.fn() },
}));
vi.mock('../outputChannel.js', () => ({
  getOutputChannel: vi.fn(),
  logLine: vi.fn(),
  logSection: vi.fn(),
}));

import { scheduleRestartOnQuit } from '../restartCursor.js';

describe('scheduleRestartOnQuit（卸载路径，explorer 转发看门狗）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockReturnValue({ unref: vi.fn() });
    mockExistsSync.mockReturnValue(true);
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'execPath', {
      value: 'D:\\DevTools\\AI\\SpaceX\\Cursor\\Cursor.exe',
      configurable: true,
      writable: true,
    });
  });

  it('win32：写入隐藏启动 VBS 并经 explorer.exe 转发（spawn 即返回）', async () => {
    const result = await scheduleRestartOnQuit('D:\\DevTools\\AI\\SpaceX\\Cursor');

    expect(result).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('explorer.exe');
    expect(String(args[0])).toMatch(/cursor-zh-quitwatch-.*\.vbs$/);
    // VBS 与 BAT 都已写入
    const writes = mockWriteFileSync.mock.calls.map((c) => String(c[0]));
    expect(writes.some((p) => p.endsWith('.vbs'))).toBe(true);
    expect(writes.some((p) => p.endsWith('.bat'))).toBe(true);
  });

  it('BAT 内容不含 schtasks（转发路径无需任务计划）且含轮询与强杀兜底', () => {
    scheduleRestartOnQuit('D:\\DevTools\\AI\\SpaceX\\Cursor');
    const batWrite = mockWriteFileSync.mock.calls.find((c) => String(c[0]).endsWith('.bat'));
    const content = String(batWrite?.[1]);
    expect(content).toContain('taskkill.exe /F /IM Cursor.exe');
    expect(content).toContain(':waitloop');
    expect(content).toContain('start ""');
    expect(content.includes('schtasks')).toBe(false);
  });

  it('exe 不可定位 → 返回 false 且不 spawn', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await scheduleRestartOnQuit('D:\\DevTools\\AI\\SpaceX\\Cursor');
    expect(result).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

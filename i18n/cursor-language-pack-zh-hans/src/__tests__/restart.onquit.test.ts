import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

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
    mockSpawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    mockExistsSync.mockReturnValue(true);
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'execPath', {
      value: 'D:\\DevTools\\AI\\SpaceX\\Cursor\\Cursor.exe',
      configurable: true,
      writable: true,
    });
  });

  it('win32：写入隐藏启动 VBS 并经 explorer.exe 转发（等待进程创建事件）', async () => {
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

  it('异步进程创建失败返回 false，而不是报告重启已调度', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    mockSpawn.mockReturnValue(child);
    const pending = scheduleRestartOnQuit('D:\\Cursor');
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    expect(await pending).toBe(false);
  });
});

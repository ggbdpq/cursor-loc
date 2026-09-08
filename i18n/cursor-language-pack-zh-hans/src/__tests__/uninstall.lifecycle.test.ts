import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';

const state = vi.hoisted(() => ({
  disposed: false,
  manifest: '[]',
  quit: vi.fn().mockResolvedValue(undefined),
  revert: vi.fn(),
  schedule: vi.fn(),
  changed: undefined as undefined | (() => void),
}));
vi.mock('vscode', () => ({
  ExtensionMode: { Development: 1, Production: 2 },
  workspace: { getConfiguration: () => ({ get: () => 'D:\\Cursor' }) },
  commands: { registerCommand: vi.fn(), executeCommand: state.quit },
  window: { showWarningMessage: vi.fn() },
}));
vi.mock('node:fs', () => ({ default: {
  readFileSync: () => state.manifest,
  appendFileSync: vi.fn(),
  watch: (_path: string, _options: unknown, listener: () => void) => {
    state.changed = listener;
    return { close: vi.fn(), on: vi.fn() };
  },
} }));
vi.mock('../outputChannel.js', () => ({
  getOutputChannel: vi.fn(),
  logLine: () => { if (state.disposed) throw new Error('RPC disposed'); },
  logSection: () => { if (state.disposed) throw new Error('RPC disposed'); },
}));
vi.mock('../patchService.js', () => ({
  isBundleReady: () => false,
  isPatchInstalled: async () => true,
  runRevert: state.revert,
}));
vi.mock('../restartCursor.js', () => ({ scheduleRestartOnQuit: state.schedule }));

describe('卸载清理生命周期', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.disposed = false;
    state.manifest = '[]';
    state.schedule.mockResolvedValue(true);
    state.revert.mockResolvedValue({ ok: true, lines: ['restored'] });
    state.quit.mockResolvedValue(undefined);
  });

  async function activate() {
    const extension = await import('../extension.js');
    extension.activate({ subscriptions: [], extensionMode: 2,
      globalState: { get: () => false, update: async () => undefined },
    } as unknown as ExtensionContext);
    return extension;
  }

  it('输出面板已释放时仍完成还原并尝试退出', async () => {
    const extension = await activate();
    state.disposed = true;
    await expect(extension.deactivate()).resolves.toBeUndefined();
    expect(state.revert).toHaveBeenCalledWith('D:\\Cursor');
    expect(state.quit).toHaveBeenCalledWith('workbench.action.quit');
  });

  it('卸载不触发 deactivate 时仍还原并重启，重复事件只执行一次', async () => {
    await activate();
    expect(state.changed).toBeTypeOf('function');
    state.changed!();
    state.changed!();
    await vi.waitFor(() => expect(state.quit).toHaveBeenCalled());
    expect(state.revert).toHaveBeenCalledTimes(1);
  });

  it('扩展仍安装时不还原、不调度、不退出', async () => {
    const extension = await activate();
    state.manifest = '[{"identifier":{"id":"ggbdpq.cursor-language-pack-zh-hans"}}]';
    await extension.deactivate();
    expect(state.revert).not.toHaveBeenCalled();
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it('调度失败仍还原，但不请求退出', async () => {
    const extension = await activate();
    state.schedule.mockResolvedValue(false);
    await extension.deactivate();
    expect(state.revert).toHaveBeenCalled();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it('还原失败不请求退出', async () => {
    const extension = await activate();
    state.revert.mockResolvedValue({ ok: false, lines: ['denied'] });
    await extension.deactivate();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it('写看门狗脚本抛错仍还原补丁', async () => {
    const extension = await activate();
    state.schedule.mockRejectedValue(new Error('EACCES'));
    await extension.deactivate();
    expect(state.revert).toHaveBeenCalled();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it('退出 RPC 拒绝不会产生未处理 rejection', async () => {
    const extension = await activate();
    state.quit.mockRejectedValue(new Error('RPC disposed'));
    await expect(extension.deactivate()).resolves.toBeUndefined();
  });
});

/**
 * Bug Condition Exploration Test
 *
 * **Validates: Requirements 1.1, 1.4, 2.1, 2.4**
 *
 * This test encodes the EXPECTED (fixed) behavior for `scheduleHiddenRestart` and
 * `coldRestartCursor`. When run against UNFIXED code, these tests MUST FAIL —
 * failure confirms the bug exists:
 *
 * 1. `scheduleHiddenRestart` uses `spawn('cmd.exe', ...)` instead of `schtasks`
 * 2. `coldRestartCursor` always returns `true` even when scheduling may fail
 * 3. No fallback/degradation message is shown when scheduling fails
 *
 * Property 1: Bug Condition — spawn 派生看门狗进程受 Job Object 约束且
 * coldRestartCursor 返回值不可靠
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock child_process
const mockSpawn = vi.fn().mockReturnValue({ unref: vi.fn() });
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock fs
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockWriteFileSync = vi.fn();
vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

// Mock os
vi.mock('node:os', () => ({
  default: {
    tmpdir: () => 'C:\\Users\\test\\AppData\\Local\\Temp',
  },
  tmpdir: () => 'C:\\Users\\test\\AppData\\Local\\Temp',
}));

// Mock path (use real path.join for Windows)
vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return {
    default: actual,
    ...actual,
  };
});

// Mock vscode
const mockShowWarningMessage = vi.fn().mockResolvedValue(undefined);
const mockShowInformationMessage = vi.fn().mockResolvedValue(undefined);
const mockExecuteCommand = vi.fn().mockResolvedValue(undefined);
vi.mock('vscode', () => ({
  window: {
    showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
  },
  commands: {
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
  },
}));

// Mock outputChannel
vi.mock('../outputChannel.js', () => ({
  logLine: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Arbitrary for generating valid Windows exe paths.
 */
const windowsExePathArb = fc.record({
  drive: fc.constantFrom('C', 'D', 'E'),
  segments: fc.array(
    fc.string({ minLength: 1, maxLength: 12, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')) }),
    { minLength: 1, maxLength: 3 },
  ),
}).map(({ drive, segments }) => `${drive}:\\${segments.join('\\')}\\Cursor.exe`);

/**
 * Arbitrary for generating valid install root paths.
 */
const installRootArb = fc.record({
  drive: fc.constantFrom('C', 'D'),
  segments: fc.array(
    fc.string({ minLength: 1, maxLength: 10, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
    { minLength: 1, maxLength: 3 },
  ),
}).map(({ drive, segments }) => `${drive}:\\${segments.join('\\')}`);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Bug Condition Exploration: spawn 派生看门狗进程受 Job Object 约束', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalExecPath = process.execPath;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'execPath', {
      value: 'C:\\Program Files\\Cursor\\Cursor.exe',
      configurable: true,
    });
    mockExistsSync.mockReturnValue(true);
    mockSpawn.mockReturnValue({ unref: vi.fn() });
    mockExecuteCommand.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    Object.defineProperty(process, 'execPath', {
      value: originalExecPath,
      configurable: true,
      writable: true,
    });
  });

  /**
   * Property 1.1: scheduleHiddenRestart SHALL call schtasks (not spawn cmd.exe)
   *
   * **Validates: Requirements 2.1**
   *
   * EXPECTED: The fixed code calls execFile('schtasks.exe', ...) or
   * execFile('schtasks', ...) to create an independent scheduled task.
   *
   * UNFIXED CODE: Calls spawn('cmd.exe', ['/c', 'call', ...]) — this test
   * will FAIL, proving the bug exists.
   */
  it('Property 1.1: scheduleHiddenRestart SHALL use schtasks for task scheduling', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(true);
        mockSpawn.mockReturnValue({ unref: vi.fn() });
        mockExecuteCommand.mockResolvedValue(undefined);

        // Mock execFile to simulate schtasks success
        mockExecFile.mockImplementation(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb?: (err: Error | null, stdout: string, stderr: string) => void,
          ) => {
            if (cb) cb(null, 'SUCCESS', '');
            return { unref: vi.fn() };
          },
        );

        const { coldRestartCursor } = await import('../restartCursor.js');
        await coldRestartCursor(installRoot);

        // EXPECTED behavior: schtasks should be called (via execFile)
        const schtasksCalled = mockExecFile.mock.calls.some(
          (call: unknown[]) =>
            typeof call[0] === 'string' && /schtasks/i.test(call[0]),
        );

        // EXPECTED behavior: spawn('cmd.exe', ...) should NOT be called for scheduling
        const spawnCmdCalled = mockSpawn.mock.calls.some(
          (call: unknown[]) =>
            typeof call[0] === 'string' && /cmd\.exe/i.test(call[0]),
        );

        // The fix should use schtasks and NOT use spawn cmd.exe
        expect(schtasksCalled).toBe(true);
        expect(spawnCmdCalled).toBe(false);
      }),
      { numRuns: 5 },
    );
  });

  /**
   * Property 1.2: coldRestartCursor SHALL return false when scheduling fails
   *
   * **Validates: Requirements 1.4, 2.4**
   *
   * EXPECTED: When the scheduling mechanism (schtasks) fails, coldRestartCursor
   * returns false to accurately reflect that restart was not successfully scheduled.
   *
   * UNFIXED CODE: Always returns true after scheduleHiddenRestart (void function),
   * regardless of whether the watchdog will survive — this test will FAIL.
   */
  it('Property 1.2: coldRestartCursor SHALL return false when scheduling fails', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(true);
        mockExecuteCommand.mockResolvedValue(undefined);

        // Simulate scheduling failure: schtasks returns non-zero exit code
        mockExecFile.mockImplementation(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb?: (err: Error | null, stdout: string, stderr: string) => void,
          ) => {
            if (cb) {
              const err = new Error('Access denied') as Error & { code?: number };
              err.code = 1;
              cb(err, '', 'Access denied');
            }
            return { unref: vi.fn() };
          },
        );

        // Also make spawn fail (simulating job object killing the process)
        mockSpawn.mockImplementation(() => {
          const child = { unref: vi.fn(), pid: 1234 };
          return child;
        });

        const { coldRestartCursor } = await import('../restartCursor.js');
        const result = await coldRestartCursor(installRoot);

        // EXPECTED: when scheduling fails, return false
        expect(result).toBe(false);
      }),
      { numRuns: 5 },
    );
  });

  /**
   * Property 1.3: When scheduling fails, a degradation message SHALL be shown
   *
   * **Validates: Requirements 2.4**
   *
   * EXPECTED: When schtasks scheduling fails, the user is shown a message
   * indicating they need to manually restart.
   *
   * UNFIXED CODE: No such message is ever shown after scheduleHiddenRestart
   * (it's void and fire-and-forget) — this test will FAIL.
   */
  it('Property 1.3: degradation message SHALL be shown when scheduling fails', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(true);
        mockExecuteCommand.mockResolvedValue(undefined);

        // Simulate scheduling failure
        mockExecFile.mockImplementation(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb?: (err: Error | null, stdout: string, stderr: string) => void,
          ) => {
            if (cb) {
              const err = new Error('schtasks failed') as Error & { code?: number };
              err.code = 1;
              cb(err, '', 'Access is denied');
            }
            return { unref: vi.fn() };
          },
        );

        mockSpawn.mockReturnValue({ unref: vi.fn() });

        const { coldRestartCursor } = await import('../restartCursor.js');
        await coldRestartCursor(installRoot);

        // EXPECTED: a degradation/fallback message should be shown to the user
        const warningShown = mockShowWarningMessage.mock.calls.length > 0;
        const infoShown = mockShowInformationMessage.mock.calls.length > 0;
        const fallbackMessageShown = warningShown || infoShown;

        // Check that at least one message contains restart-related guidance
        const allMessages = [
          ...mockShowWarningMessage.mock.calls.map((c: unknown[]) => c[0]),
          ...mockShowInformationMessage.mock.calls.map((c: unknown[]) => c[0]),
        ];

        const hasRestartGuidance = allMessages.some(
          (msg: unknown) =>
            typeof msg === 'string' &&
            (msg.includes('手动') || msg.includes('重启') || msg.includes('失败')),
        );

        // EXPECTED: a fallback/degradation message about manual restart is shown
        expect(fallbackMessageShown).toBe(true);
        expect(hasRestartGuidance).toBe(true);
      }),
      { numRuns: 5 },
    );
  });
});

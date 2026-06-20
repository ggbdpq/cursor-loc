/**
 * Preservation Property Tests
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * These tests encode the CURRENT behavior of non-restart-scheduling paths.
 * They MUST PASS on the UNFIXED code to establish a baseline, and continue
 * to pass AFTER the fix to confirm no regressions.
 *
 * Property 2: Preservation — 非重启调度路径行为不变
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

/** 模拟 schtasks 调度成功（create + run）。 */
function mockSchtasksSuccess(): void {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (cb) {
        cb(null, 'SUCCESS', '');
      }
    },
  );
}

// Mock fs
const mockExistsSync = vi.fn().mockReturnValue(false);
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

// Mock path (use win32 path for correct join behavior)
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
const mockLogLine = vi.fn();
vi.mock('../outputChannel.js', () => ({
  logLine: (...args: unknown[]) => mockLogLine(...args),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Arbitrary for non-Windows platform values. */
const nonWindowsPlatformArb = fc.constantFrom('linux', 'darwin', 'freebsd', 'openbsd', 'sunos', 'aix');

/** Arbitrary for generating valid Windows install root paths. */
const installRootArb = fc.record({
  drive: fc.constantFrom('C', 'D', 'E'),
  segments: fc.array(
    fc.string({
      minLength: 1,
      maxLength: 10,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
    }),
    { minLength: 1, maxLength: 3 },
  ),
}).map(({ drive, segments }) => `${drive}:\\${segments.join('\\')}`);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Preservation Property: 非重启调度路径行为不变', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalExecPath = process.execPath;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockReturnValue({ unref: vi.fn() });
    mockSchtasksSuccess();
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

  // ─── Property 2.1: Non-Windows platform returns false ───────────────────

  /**
   * Property 2.1: For all non-Windows platform values, coldRestartCursor returns false
   * and logs "不支持".
   *
   * **Validates: Requirements 3.1**
   */
  it('Property 2.1: non-Windows platforms always return false and log "不支持"', async () => {
    await fc.assert(
      fc.asyncProperty(nonWindowsPlatformArb, installRootArb, async (platform, installRoot) => {
        vi.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: platform, configurable: true });

        const { coldRestartCursor } = await import('../restartCursor.js');
        const result = await coldRestartCursor(installRoot);

        expect(result).toBe(false);
        // Should log the "不支持" message
        const logCalls = mockLogLine.mock.calls.map((c: unknown[]) => c[0]);
        const hasUnsupportedLog = logCalls.some(
          (msg: unknown) => typeof msg === 'string' && msg.includes('不支持'),
        );
        expect(hasUnsupportedLog).toBe(true);
        // Should NOT show warning or spawn anything
        expect(mockShowWarningMessage).not.toHaveBeenCalled();
        expect(mockSpawn).not.toHaveBeenCalled();
      }),
      { numRuns: 10 },
    );
  });

  // ─── Property 2.2: Unresolvable exe path returns false with warning ─────

  /**
   * Property 2.2: For all installRoot values where exe is not resolvable,
   * coldRestartCursor returns false and shows warning message.
   *
   * **Validates: Requirements 3.2**
   */
  it('Property 2.2: unresolvable exe path returns false and shows warning', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        // Set execPath to something that is NOT a cursor exe
        Object.defineProperty(process, 'execPath', {
          value: 'C:\\Program Files\\node\\node.exe',
          configurable: true,
        });
        // All existsSync calls return false (no exe found)
        mockExistsSync.mockReturnValue(false);

        const { coldRestartCursor } = await import('../restartCursor.js');
        const result = await coldRestartCursor(installRoot);

        expect(result).toBe(false);
        // Should show warning about being unable to locate exe
        expect(mockShowWarningMessage).toHaveBeenCalled();
        const warningMsg = mockShowWarningMessage.mock.calls[0][0];
        expect(warningMsg).toContain('无法定位');
        // Should NOT spawn anything
        expect(mockSpawn).not.toHaveBeenCalled();
      }),
      { numRuns: 10 },
    );
  });

  // ─── Property 2.3: resolveCursorExecutable resolves correctly ───────────

  /**
   * Property 2.3: For all valid installRoot values, resolveCursorExecutable
   * correctly resolves Cursor.exe or cursor.exe when file exists.
   *
   * **Validates: Requirements 3.3**
   */
  it('Property 2.3: resolveCursorExecutable resolves correct exe path when file exists', async () => {
    const path = await import('node:path');

    await fc.assert(
      fc.asyncProperty(
        installRootArb,
        fc.constantFrom('Cursor.exe', 'cursor.exe'),
        async (installRoot, exeName) => {
          vi.clearAllMocks();
          // Only the specified exe file exists
          const expectedPath = path.join(installRoot, exeName);
          mockExistsSync.mockImplementation((p: unknown) => p === expectedPath);

          const { resolveCursorExecutable } = await import('../restartCursor.js');
          const result = resolveCursorExecutable(installRoot);

          expect(result).toBe(expectedPath);
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * Property 2.3b: resolveCursorExecutable returns undefined when no exe exists.
   *
   * **Validates: Requirements 3.3**
   */
  it('Property 2.3b: resolveCursorExecutable returns undefined when no exe exists', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(false);

        const { resolveCursorExecutable } = await import('../restartCursor.js');
        const result = resolveCursorExecutable(installRoot);

        expect(result).toBeUndefined();
      }),
      { numRuns: 10 },
    );
  });

  // ─── Property 2.4: resolveCursorExecutableForRestart priority ───────────

  /**
   * Property 2.4: resolveCursorExecutableForRestart prefers process.execPath
   * over installRoot when execPath is a valid cursor exe.
   *
   * **Validates: Requirements 3.4**
   */
  it('Property 2.4: resolveCursorExecutableForRestart prefers execPath over installRoot', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        const execPathValue = 'C:\\Program Files\\Cursor\\Cursor.exe';
        Object.defineProperty(process, 'execPath', {
          value: execPathValue,
          configurable: true,
        });
        // execPath exists, installRoot exe also exists
        mockExistsSync.mockReturnValue(true);

        const { resolveCursorExecutableForRestart } = await import('../restartCursor.js');
        const result = resolveCursorExecutableForRestart(installRoot);

        // Should prefer execPath
        expect(result).toBe(execPathValue);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 2.4b: resolveCursorExecutableForRestart falls back to installRoot
   * when execPath is not a cursor exe.
   *
   * **Validates: Requirements 3.4**
   */
  it('Property 2.4b: resolveCursorExecutableForRestart falls back to installRoot when execPath is not cursor', async () => {
    const path = await import('node:path');

    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        // execPath is NOT a cursor exe
        Object.defineProperty(process, 'execPath', {
          value: 'C:\\Program Files\\node\\node.exe',
          configurable: true,
        });
        // installRoot has Cursor.exe
        const expectedExe = path.join(installRoot, 'Cursor.exe');
        mockExistsSync.mockImplementation((p: unknown) => p === expectedExe);

        const { resolveCursorExecutableForRestart } = await import('../restartCursor.js');
        const result = resolveCursorExecutableForRestart(installRoot);

        expect(result).toBe(expectedExe);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 2.4c: resolveCursorExecutableForRestart returns undefined
   * when neither execPath nor installRoot resolve.
   *
   * **Validates: Requirements 3.4**
   */
  it('Property 2.4c: resolveCursorExecutableForRestart returns undefined when nothing resolves', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        Object.defineProperty(process, 'execPath', {
          value: 'C:\\Program Files\\node\\node.exe',
          configurable: true,
        });
        mockExistsSync.mockReturnValue(false);

        const { resolveCursorExecutableForRestart } = await import('../restartCursor.js');
        const result = resolveCursorExecutableForRestart(installRoot);

        expect(result).toBeUndefined();
      }),
      { numRuns: 10 },
    );
  });

  // ─── Property 2.5: executeCommandWithTimeout behavior ───────────────────

  /**
   * Property 2.5: executeCommandWithTimeout returns false when command exceeds
   * timeout. We test this indirectly through coldRestartCursor since
   * executeCommandWithTimeout is not exported.
   *
   * When vscode.commands.executeCommand hangs (never resolves), the timeout
   * mechanism kicks in and the function still proceeds.
   *
   * **Validates: Requirements 3.5**
   */
  it('Property 2.5: executeCommandWithTimeout handles timeout correctly (tested via coldRestartCursor)', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'execPath', {
          value: 'C:\\Program Files\\Cursor\\Cursor.exe',
          configurable: true,
        });
        mockExistsSync.mockReturnValue(true);
        mockSpawn.mockReturnValue({ unref: vi.fn() });

        // Make executeCommand hang forever (never resolves) to trigger timeout
        mockExecuteCommand.mockImplementation(
          () => new Promise(() => { /* never resolves */ }),
        );

        const { coldRestartCursor } = await import('../restartCursor.js');
        const promise = coldRestartCursor(installRoot);

        // Advance past the 800ms delay + 3000ms quit timeout + 2000ms closeWindow timeout
        await vi.advanceTimersByTimeAsync(10000);

        const result = await promise;

        // Even with timeout, coldRestartCursor returns true in unfixed code
        expect(result).toBe(true);
        // Log should contain timeout-related messages
        const logCalls = mockLogLine.mock.calls.map((c: unknown[]) => c[0]);
        const hasTimeoutLog = logCalls.some(
          (msg: unknown) => typeof msg === 'string' && msg.includes('超时'),
        );
        expect(hasTimeoutLog).toBe(true);

        vi.useRealTimers();
      }),
      { numRuns: 5 },
    );
  });

  /**
   * Property 2.5b: executeCommandWithTimeout returns true on success.
   * Tested indirectly: when commands resolve immediately, coldRestartCursor
   * proceeds normally.
   *
   * **Validates: Requirements 3.5**
   */
  it('Property 2.5b: executeCommandWithTimeout resolves true on command success (tested via coldRestartCursor)', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'execPath', {
          value: 'C:\\Program Files\\Cursor\\Cursor.exe',
          configurable: true,
        });
        mockExistsSync.mockReturnValue(true);
        mockSpawn.mockReturnValue({ unref: vi.fn() });
        // Commands resolve immediately
        mockExecuteCommand.mockResolvedValue(undefined);

        const { coldRestartCursor } = await import('../restartCursor.js');
        const promise = coldRestartCursor(installRoot);

        // Advance past the 800ms delay
        await vi.advanceTimersByTimeAsync(10000);

        const result = await promise;

        // Current unfixed code always returns true when exe is found
        expect(result).toBe(true);
        // Log should contain "已返回" (command returned successfully)
        const logCalls = mockLogLine.mock.calls.map((c: unknown[]) => c[0]);
        const hasReturnedLog = logCalls.some(
          (msg: unknown) => typeof msg === 'string' && msg.includes('已返回'),
        );
        expect(hasReturnedLog).toBe(true);

        vi.useRealTimers();
      }),
      { numRuns: 5 },
    );
  });

  // ─── Property 2.6: Batch script content generation ──────────────────────

  /**
   * Property 2.6: Batch script content generation produces valid batch syntax
   * containing polling (轮询), taskkill, and explorer retry logic.
   * Tested indirectly through coldRestartCursor which calls scheduleHiddenRestart
   * and writes the batch script via fs.writeFileSync.
   *
   * **Validates: Requirements 3.5**
   */
  it('Property 2.6: batch script contains valid structure (轮询、taskkill、explorer 重试逻辑)', async () => {
    await fc.assert(
      fc.asyncProperty(installRootArb, async (installRoot) => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'execPath', {
          value: 'C:\\Program Files\\Cursor\\Cursor.exe',
          configurable: true,
        });
        mockExistsSync.mockReturnValue(true);
        mockSchtasksSuccess();
        mockExecuteCommand.mockResolvedValue(undefined);

        const { coldRestartCursor } = await import('../restartCursor.js');
        const promise = coldRestartCursor(installRoot);

        // Advance past all timers
        await vi.advanceTimersByTimeAsync(10000);

        await promise;

        // Verify writeFileSync was called (batch + vbs scripts written)
        expect(mockWriteFileSync).toHaveBeenCalled();
        const batchCall = mockWriteFileSync.mock.calls.find(
          (call: unknown[]) => typeof call[0] === 'string' && String(call[0]).endsWith('.bat'),
        );
        expect(batchCall).toBeDefined();
        const [scriptPath, batchContent] = batchCall as [string, string];

        // Script path should be a .bat file in temp dir
        expect(scriptPath).toMatch(/\.bat$/);
        expect(scriptPath).toContain('cursor-zh-restart-');

        // Validate batch script structure
        const content = batchContent as string;
        // Must start with @echo off
        expect(content).toContain('@echo off');
        // Must have delayed expansion
        expect(content).toContain('setlocal EnableDelayedExpansion');
        // Must have polling loop (轮询)
        expect(content).toContain(':waitloop');
        expect(content).toContain('tasklist.exe');
        // Must have taskkill (强制终止)
        expect(content).toContain('taskkill.exe /F /IM Cursor.exe');
        // Must have PowerShell fallback launch
        expect(content).toContain('Start-Process');
        // Must have start command to launch
        expect(content).toContain('start ""');
        // Must clean up schtasks task with full path
        expect(content).toContain('schtasks.exe /delete');
        // Must have self-cleanup
        expect(content).toContain('del "%~f0"');
        // Must have log function
        expect(content).toContain(':log');
        // Must have force kill label
        expect(content).toContain(':forcekill');
        // Must have gone label
        expect(content).toContain(':gone');

        vi.useRealTimers();
      }),
      { numRuns: 5 },
    );
  });
});

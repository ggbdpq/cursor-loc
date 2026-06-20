import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Windows 上常见的 Cursor 安装目录候选路径。 */
const COMMON_WINDOWS_PATHS = [
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'cursor'),
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Cursor'),
  'C:\\Program Files\\cursor',
  'C:\\Program Files\\Cursor',
  'D:\\Program Files\\cursor',
  'D:\\Program Files\\Cursor',
];

/**
 * 判断目录是否为有效的 Cursor 安装根目录。
 *
 * 通过检测 `resources/app/out/vs/workbench/workbench.desktop.main.js` 是否存在来确认。
 *
 * @param installPath 待检查的目录。
 * @returns 存在 workbench 主文件时返回 true。
 */
function isValidCursorRoot(installPath: string): boolean {
  const appRoot = join(installPath, 'resources', 'app');
  const workbench = join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  return existsSync(workbench);
}

/**
 * 从 Cursor 可执行文件路径反推安装根目录。
 *
 * @param exePath `where cursor` 或用户提供的 exe 路径。
 * @returns 有效的安装根目录；无法推断时返回 null。
 */
function resolveFromCursorExe(exePath: string): string | null {
  const normalized = resolve(exePath.replace(/"/g, ''));
  let current = dirname(normalized);

  // 从 cursor(.cmd/.exe) 所在目录向上逐级查找，兼容
  // InstallRoot/Cursor.exe 与 InstallRoot/resources/app/bin/cursor 等布局。
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (isValidCursorRoot(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

/**
 * 通过 Windows `where cursor` 命令查找 Cursor 安装路径。
 *
 * @returns 首个有效安装根目录；命令失败或未找到时返回 null。
 */
function findViaWhereCommand(): string | null {
  try {
    const output = execSync('where cursor', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const root = resolveFromCursorExe(line);
      if (root) {
        return root;
      }
    }
  } catch {
    // where not found or cursor not in PATH
  }
  return null;
}

/**
 * 解析 Cursor 安装根目录。
 *
 * 优先使用 `--app-root`；否则尝试 `where cursor` 与常见安装路径。
 *
 * @param explicitPath CLI 传入的安装根目录，可选。
 * @returns Cursor 安装根目录（含 `resources/app` 的上级目录）。
 * @throws 路径无效且自动探测失败时抛出错误。
 */
export function resolveCursorInstallPath(explicitPath?: string): string {
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    if (!isValidCursorRoot(resolved)) {
      throw new Error(`无效的 Cursor 安装路径: ${resolved}\n未找到 workbench.desktop.main.js`);
    }
    return resolved;
  }

  const fromWhere = findViaWhereCommand();
  if (fromWhere) {
    return fromWhere;
  }

  for (const candidate of COMMON_WINDOWS_PATHS) {
    if (candidate && isValidCursorRoot(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    '无法自动检测 Cursor 安装路径。请使用 --app-root 指定，例如:\n' +
      '  cursor-zh apply --app-root "D:\\Program Files\\cursor"',
  );
}

/**
 * 由安装根目录得到 Electron `resources/app` 路径。
 *
 * @param installPath Cursor 安装根目录。
 * @returns `resources/app` 绝对路径。
 */
export function getAppRoot(installPath: string): string {
  return join(installPath, 'resources', 'app');
}

/**
 * 读取 Cursor 应用版本号。
 *
 * @param appRoot `resources/app` 目录。
 * @returns `package.json` 中的 version 字段；读取失败时返回 undefined。
 */
export function readCursorVersion(appRoot: string): string | undefined {
  const packageJsonPath = join(appRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

/**
 * 检测对 Cursor 安装目录是否具备写权限。
 *
 * 在 workbench 目录写入临时探针文件后立即删除。
 *
 * @param appRoot `resources/app` 目录。
 * @returns 可写时 `{ writable: true }`；否则包含错误信息。
 */
export function checkWriteAccess(appRoot: string): { writable: boolean; error?: string } {
  const workbenchDir = join(appRoot, 'out', 'vs', 'workbench');
  const testFile = join(workbenchDir, '.cursor-zh-write-test');

  try {
    writeFileSync(testFile, 'test', 'utf-8');
    unlinkSync(testFile);
    return { writable: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      writable: false,
      error: message,
    };
  }
}

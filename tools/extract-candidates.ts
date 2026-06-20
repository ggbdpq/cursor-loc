/**
 * 从 Cursor workbench 打包产物中提取 UI 候选英文字符串。
 *
 * 维护者用此脚本对照 `translations/` 词典，找出尚未收录的界面文案。
 * 输出：`tools/output/candidates.json`（按字母序排序的去重列表）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

/** workbench 内常见 UI 文案字段的正则模式。 */
const UI_PATTERNS = [
  /label:"([^"\\]{3,120})"/g,
  /description:"([^"\\]{3,200})"/g,
  /title:"([^"\\]{3,120})"/g,
  /placeholder:"([^"\\]{3,120})"/g,
  /settingsLabel:"([^"\\]{3,120})"/g,
  /settingsDescription:"([^"\\]{3,200})"/g,
  /commandTitle:"([^"\\]{3,120})"/g,
];

/**
 * 定位本地 Cursor 的 workbench.desktop.main.js 路径。
 *
 * 依次尝试：CLI 传入的 `--app-root` → `where cursor` → 常见默认安装路径。
 *
 * @param {string | undefined} explicit 用户指定的 Cursor 安装根目录。
 * @returns {string} workbench.desktop.main.js 的绝对路径。
 * @throws {Error} 所有候选路径均不可读时抛出。
 */
function findWorkbenchPath(explicit?: string): string {
  if (explicit) {
    const p = join(resolve(explicit), 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
    readFileSync(p, 'utf-8');
    return p;
  }

  try {
    const where = execSync('where cursor', { encoding: 'utf-8' }).split(/\r?\n/)[0]?.trim();
    if (where) {
      const root = resolve(where, '..', '..', '..');
      const p = join(root, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
      readFileSync(p, 'utf-8');
      return p;
    }
  } catch {
    // where cursor 失败时继续尝试默认路径
  }

  const defaults = [
    'D:\\Program Files\\cursor\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js',
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'cursor', 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
  ];

  for (const p of defaults) {
    try {
      readFileSync(p, 'utf-8');
      return p;
    } catch {
      // 尝试下一个默认路径
    }
  }

  throw new Error('无法定位 workbench.desktop.main.js，请使用 --app-root');
}

/**
 * 判断提取到的字符串是否像用户可见 UI 文案。
 *
 * 过滤纯数字、URL、模板占位符、camelCase 内部标识符等噪声。
 *
 * @param {string} value 候选英文字符串。
 * @returns {boolean} 是否应纳入候选列表。
 */
function isLikelyUiString(value: string): boolean {
  if (!/[a-zA-Z]/.test(value)) return false;
  if (/^[\d\s./\\:_-]+$/.test(value)) return false;
  if (value.startsWith('http')) return false;
  if (value.includes('${')) return false;
  if (/^[a-z]+([A-Z][a-zA-Z0-9]*)+$/.test(value) && !value.includes(' ')) return false;
  if (value.length < 3 || value.length > 200) return false;
  return true;
}

/** CLI 入口：扫描 workbench 并写入 candidates.json。 */
function main() {
  const appRootArg = process.argv.find((a) => a.startsWith('--app-root='))?.split('=')[1];
  const workbenchPath = findWorkbenchPath(appRootArg);
  const content = readFileSync(workbenchPath, 'utf-8');

  const candidates = new Set<string>();
  for (const pattern of UI_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const text = match[1];
      if (isLikelyUiString(text)) {
        candidates.add(text);
      }
    }
  }

  const sorted = [...candidates].sort((a, b) => a.localeCompare(b));
  const outPath = join(process.cwd(), 'tools', 'output', 'candidates.json');
  writeFileSync(outPath, JSON.stringify(sorted, null, 2), 'utf-8');
  console.log(`已提取 ${sorted.length} 条候选词 → ${outPath}`);
  console.log(`来源: ${workbenchPath}`);
}

main();

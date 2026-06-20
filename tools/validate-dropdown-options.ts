/**
 * 校验 dropdown-options.ts 格式，并扫描其他模块中的选项冲突。
 *
 * 运行：`npm run validate:dropdown`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(root, 'locales', 'zh-cn');

/**
 * 递归收集目录下全部 `.ts` 文件路径。
 *
 * @param dir 起始目录。
 * @returns 文件绝对路径列表。
 */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const optPattern = /opt\(\s*'((?:\\'|[^'])*)'\s*,\s*'((?:\\'|[^'])*)'\s*\)/g;
const dropdownFile = path.join(localesDir, 'settings', 'dropdown-options.ts');
const dropdownContent = fs.readFileSync(dropdownFile, 'utf8');

const dropdownKeys = new Set<string>();
let badOpt = 0;
let m: RegExpExecArray | null;
while ((m = optPattern.exec(dropdownContent))) {
  const en = m[1];
  const zh = m[2];
  const expected = `${zh}(${en})`;
  dropdownKeys.add(`exact:${en}:`);
  if (!dropdownContent.includes(`changeText: \`${expected}\``) && !dropdownContent.includes(`changeText: '${expected}'`)) {
    // opt() helper builds dynamically — OK
  }
}

// Collect exact entries from non-dropdown files
const conflicts: { file: string; orig: string; change: string }[] = [];
for (const file of walkTs(localesDir)) {
  if (file.replace(/\\/g, '/').endsWith('settings/dropdown-options.ts')) continue;
  const content = fs.readFileSync(file, 'utf8');
  const entryRe = /originalText:\s*'((?:\\'|[^'])*)',\s*changeText:\s*'((?:\\'|[^'])*)'/g;
  while ((m = entryRe.exec(content))) {
    const orig = m[1];
    const change = m[2];
    if (!dropdownKeys.has(`exact:${orig}:`)) continue;
    if (change === `${change.replace(/\([^)]*\)$/, '')}(${orig})` || change.endsWith(`(${orig})`)) continue;
    if (!change.includes(`(${orig})`)) {
      conflicts.push({ file: path.relative(root, file), orig, change });
    }
  }
}

console.log(`dropdown-options.ts: ${dropdownKeys.size} opt() entries`);
if (conflicts.length === 0) {
  console.log('No option conflicts found.');
} else {
  console.error(`Found ${conflicts.length} option conflict(s) — move to dropdown-options.ts or remove:`);
  for (const c of conflicts) {
    console.error(`  ${c.orig} -> "${c.change}" in ${c.file}`);
  }
  process.exit(1);
}

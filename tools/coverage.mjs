#!/usr/bin/env node
/**
 * 覆盖率流水线：Cursor 每次更新后运行，产出漏翻清单与覆盖率数字。
 *
 *   npm run coverage            # 自动检测本机 Cursor
 *   node tools/coverage.mjs --app-root "D:\\path\\to\\cursor"
 *
 * 产物：
 *   tools/output/coverage.json  机器可读汇总（总候选 / 已覆盖 / 覆盖率）
 *   tools/output/pending.md     漏翻清单（人类核对、社区认领）
 *
 * ponytail 局限：① 从压缩产物正则提取，含少量非 UI 噪声与 VS Code 底座字符串
 * （底座由 MS 语言包负责，核对时跳过即可）；② partial/regex 词条无法按原文精确
 * 对账，只计入词典统计，不参与覆盖率分子。页面级归属用 extract:settings 深挖。
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bundlePath = join(
  repoRoot,
  'i18n',
  'cursor-language-pack-zh-hans',
  'generated',
  'replacements.bundle.json',
);
const outDir = join(repoRoot, 'tools', 'output');
const pendingDir = join(outDir, 'pending');

/** 与 tools/extract-candidates.ts 一致的 UI 文案提取模式。 */
const UI_PATTERNS = [
  /label:"((?:\\.|[^"\\]){3,200})"/g,
  /description:"((?:\\.|[^"\\]){3,200})"/g,
  /title:"((?:\\.|[^"\\]){3,200})"/g,
  /placeholder:"((?:\\.|[^"\\]){3,200})"/g,
  /settingsLabel:"((?:\\.|[^"\\]){3,200})"/g,
  /settingsDescription:"((?:\\.|[^"\\]){3,200})"/g,
  /commandTitle:"((?:\\.|[^"\\]){3,200})"/g,
];

function findWorkbench(explicit) {
  const rel = join('resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  if (explicit) {
    const p = join(resolve(explicit), rel);
    if (!existsSync(p)) throw new Error(`未找到 workbench: ${p}`);
    return p;
  }
  try {
    const cli = execSync(process.platform === 'win32' ? 'where cursor' : 'which cursor', {
      encoding: 'utf-8',
    })
      .split(/\r?\n/)[0]
      ?.trim();
    if (cli) {
      // 命令结果位于 <安装根>/resources/app/bin/ 下，向上取安装根
      let dir = dirname(cli);
      for (let i = 0; i < 8; i++) {
        const p = join(dir, rel);
        if (existsSync(p)) return p;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  } catch {
    // 命令不可用时走默认路径
  }
  const defaults =
    process.platform === 'darwin'
      ? ['/Applications/Cursor.app/Contents', join(homedir(), 'Applications', 'Cursor.app', 'Contents')]
      : [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'cursor'), 'D:\\Program Files\\cursor'];
  for (const base of defaults) {
    const p = join(base, rel);
    if (existsSync(p)) return p;
  }
  throw new Error('无法定位 Cursor，请用 --app-root 指定安装根目录');
}

function extractCandidates(workbenchPath) {
  const content = readFileSync(workbenchPath, 'utf-8');
  const found = new Set();
  for (const pattern of UI_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const raw = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\'/g, "'").trim();
      if (raw.length < 3) continue;
      if (/[\u4e00-\u9fff]/.test(raw)) continue; // 已含中文
      if (/\$\{|\$\(|\)\s*\{|\b=>\b|\|\||&&|\bvoid\b|\btypeof\b/.test(raw)) continue; // 代码片段
      if (/^[.)}\]#*/]|^@/.test(raw)) continue; // 标点开头的噪声
      if (/[:/\\]\s*$/.test(raw) && !raw.includes(' ')) continue; // 路径/协议噪声
      found.add(raw);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, 'en'));
}

const args = process.argv.slice(2);
const appRootIdx = args.indexOf('--app-root');
const workbenchPath = findWorkbench(appRootIdx >= 0 ? args[appRootIdx + 1] : undefined);

const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8'));
const exact = new Set(
  bundle.replacements.filter((r) => r.searchType === 'exact').map((r) => r.originalText),
);
const partialOrRegex = bundle.replacements.filter((r) => r.searchType !== 'exact');

const candidates = extractCandidates(workbenchPath);
const covered = candidates.filter((c) => exact.has(c));
const pending = candidates.filter((c) => !exact.has(c));
// NLS 参数化串（渲染时 {0} 被替换）需 regex 词条，单独分组
const parameterized = pending.filter((c) => /\{\d+\}/.test(c));
const plain = pending.filter((c) => !/\{\d+\}/.test(c));

mkdirSync(pendingDir, { recursive: true });
const coveragePct = candidates.length > 0 ? ((covered.length / candidates.length) * 100).toFixed(1) : '0.0';

writeFileSync(
  join(outDir, 'coverage.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      workbench: workbenchPath,
      totalCandidates: candidates.length,
      coveredExact: covered.length,
      coveragePct: Number(coveragePct),
      dictionary: {
        exact: exact.size,
        partial: partialOrRegex.filter((r) => r.searchType === 'partial').length,
        regex: partialOrRegex.filter((r) => r.searchType === 'regex').length,
      },
      pending: { total: pending.length, parameterized: parameterized.length },
    },
    null,
    2,
  ),
);

const md = [
  `# 漏翻清单（自动生成，勿手改）`,
  '',
  `- 来源：\`${workbenchPath}\``,
  `- 生成时间：${new Date().toISOString()}`,
  `- 覆盖率（exact 词条 / 提取候选）：**${covered.length} / ${candidates.length}（${coveragePct}%）**`,
  '- 说明：清单含少量 VS Code 底座字符串（MS 语言包负责，可跳过）；认领后把词条加进对应 `translations/**/*.i18n.json` 并跑 `npm run validate:i18n`。',
  '',
  `## 待翻译（${plain.length} 条）`,
  '',
  ...plain.map((c) => `- [ ] \`${c.replace(/`/g, "'")}\``),
  '',
  `## 参数化文案（${parameterized.length} 条，渲染时 {0} 等被替换，需 regex 词条）`,
  '',
  ...parameterized.map((c) => `- [ ] \`${c.replace(/`/g, "'")}\``),
  '',
].join('\n');
writeFileSync(join(pendingDir, 'index.md'), md);

console.log(`覆盖率: ${covered.length}/${candidates.length}（${coveragePct}%）`);
console.log(`漏翻: ${plain.length} 条 → tools/output/pending/index.md（另参数化 ${parameterized.length} 条）`);

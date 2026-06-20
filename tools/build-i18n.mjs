#!/usr/bin/env node
/**
 * 将 translations 下各 .i18n.json 合并为 generated/replacements.bundle.json。
 *
 * 合并优先级与旧 locales/zh-cn/index.ts 一致：先出现的模块优先保留。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const packRoot = path.join(repoRoot, 'i18n', 'cursor-language-pack-zh-hans');
const translationsDir = path.join(packRoot, 'translations');
const generatedDir = path.join(packRoot, 'generated');

/** 与旧 index.ts 导入顺序一致（先导入 = 高优先级）。 */
const MERGE_ORDER = [
  'settings/dropdown-options.i18n.json',
  'dialogs.i18n.json',
  'common.i18n.json',
  'settings/sidebar.i18n.json',
  'settings/general.i18n.json',
  'settings/plan-usage.i18n.json',
  'settings/agents.i18n.json',
  'settings/tab.i18n.json',
  'settings/models.i18n.json',
  'settings/cloud-agents.i18n.json',
  'settings/plugins.i18n.json',
  'settings/skills-catalog.i18n.json',
  'settings/rules.i18n.json',
  'settings/mcp.i18n.json',
  'settings/hooks.i18n.json',
  'settings/indexing.i18n.json',
  'settings/network.i18n.json',
  'settings/beta.i18n.json',
  'settings/vscode-cursor.i18n.json',
  'agent/modes.i18n.json',
  'agent/toolcalls.i18n.json',
  'agent/composer.i18n.json',
  'review/pr-review.i18n.json',
];

/**
 * 递归收集 translations 目录下所有 .i18n.json 相对路径。
 *
 * @param {string} dir 当前扫描目录。
 * @param {string} [base=''] 相对 translations 的前缀。
 * @returns {string[]} 如 `settings/general.i18n.json`。
 */
function collectI18nFiles(dir, base = '') {
  const results = [];
  if (!fs.existsSync(dir)) {
    return results;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectI18nFiles(full, rel));
    } else if (entry.name.endsWith('.i18n.json')) {
      results.push(rel.replace(/\\/g, '/'));
    }
  }
  return results;
}

/**
 * 按 originalText + searchType 去重，保留 MERGE_ORDER 中先出现的条目。
 *
 * @param {Array<{originalText: string, changeText: string, searchType: string, flags?: string}>} replacements
 * @returns {typeof replacements} 去重后的词典数组。
 */
function dedupeReplacements(replacements) {
  const seen = new Set();
  const result = [];
  for (const item of replacements) {
    const key = `${item.searchType}:${item.originalText}:${item.flags ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** 读取 translations/meta.json，缺失时返回默认 locale。 */
function loadMeta() {
  const metaPath = path.join(translationsDir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }
  return { locale: 'zh-cn' };
}

/**
 * 加载单个 i18n 模块的 replacements 数组。
 *
 * @param {string} relPath 相对 translations 的路径。
 * @returns {Array} 该文件的 replacements，文件不存在时返回 []。
 */
function loadModule(relPath) {
  const full = path.join(translationsDir, relPath);
  if (!fs.existsSync(full)) {
    return [];
  }
  const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
  return data.replacements ?? [];
}

/** CLI 入口：合并 translations → generated/replacements.bundle.json。 */
function main() {
  if (!fs.existsSync(translationsDir)) {
    console.error(`错误: 未找到 ${translationsDir}`);
    console.error('请先运行 node tools/migrate-locales-ts-to-json.mjs');
    process.exit(1);
  }

  const meta = loadMeta();
  const ordered = [...MERGE_ORDER];
  const allFiles = collectI18nFiles(translationsDir);
  for (const file of allFiles) {
    if (!ordered.includes(file)) {
      ordered.push(file);
    }
  }

  const merged = [];
  for (const file of ordered) {
    merged.push(...loadModule(file));
  }

  const replacements = dedupeReplacements(merged);
  fs.mkdirSync(generatedDir, { recursive: true });

  const bundle = {
    locale: meta.locale ?? 'zh-cn',
    meta: {
      testedCursorVersion: meta.testedCursorVersion,
      lastUpdated: meta.lastUpdated,
    },
    replacements,
  };

  const bundlePath = path.join(generatedDir, 'replacements.bundle.json');
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf-8');
  fs.writeFileSync(path.join(generatedDir, 'meta.json'), JSON.stringify(bundle.meta, null, 2), 'utf-8');

  console.log(`已生成 ${bundlePath}`);
  console.log(`  条目数: ${replacements.length}`);
  console.log(`  模块数: ${ordered.filter((f) => fs.existsSync(path.join(translationsDir, f))).length}`);
}

main();

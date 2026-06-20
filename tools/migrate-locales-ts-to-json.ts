#!/usr/bin/env node
/**
 * 一次性迁移：locales/zh-cn/*.ts → translations/ 下各 .i18n.json
 *
 * 用法：npx tsx tools/migrate-locales-ts-to-json.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface Replacement {
  originalText: string;
  changeText: string;
  searchType: 'exact' | 'partial' | 'regex';
  flags?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const localesRoot = path.join(repoRoot, 'locales', 'zh-cn');
const translationsDir = path.join(repoRoot, 'i18n', 'cursor-language-pack-zh-hans', 'translations');

const MODULE_MAP: Array<[string, string]> = [
  ['settings/dropdown-options.js', 'settings/dropdown-options.i18n.json'],
  ['dialogs.js', 'dialogs.i18n.json'],
  ['common.js', 'common.i18n.json'],
  ['settings/sidebar.js', 'settings/sidebar.i18n.json'],
  ['settings/general.js', 'settings/general.i18n.json'],
  ['settings/plan-usage.js', 'settings/plan-usage.i18n.json'],
  ['settings/agents.js', 'settings/agents.i18n.json'],
  ['settings/tab.js', 'settings/tab.i18n.json'],
  ['settings/models.js', 'settings/models.i18n.json'],
  ['settings/cloud-agents.js', 'settings/cloud-agents.i18n.json'],
  ['settings/plugins.js', 'settings/plugins.i18n.json'],
  ['settings/skills-catalog.js', 'settings/skills-catalog.i18n.json'],
  ['settings/rules.js', 'settings/rules.i18n.json'],
  ['settings/mcp.js', 'settings/mcp.i18n.json'],
  ['settings/hooks.js', 'settings/hooks.i18n.json'],
  ['settings/indexing.js', 'settings/indexing.i18n.json'],
  ['settings/network.js', 'settings/network.i18n.json'],
  ['settings/beta.js', 'settings/beta.i18n.json'],
  ['settings/vscode-cursor.js', 'settings/vscode-cursor.i18n.json'],
  ['agent/modes.js', 'agent/modes.i18n.json'],
  ['agent/toolcalls.js', 'agent/toolcalls.i18n.json'],
  ['agent/composer.js', 'agent/composer.i18n.json'],
  ['review/pr-review.js', 'review/pr-review.i18n.json'],
];

async function loadFromTs(tsRelPath: string): Promise<Replacement[]> {
  const tsPath = path.join(localesRoot, tsRelPath.replace(/\.js$/, '.ts'));
  const mod = await import(pathToFileURL(tsPath).href);
  return (mod.default ?? []) as Replacement[];
}

async function main() {
  if (!fs.existsSync(localesRoot)) {
    console.error(`错误: 未找到 ${localesRoot}`);
    process.exit(1);
  }

  fs.mkdirSync(translationsDir, { recursive: true });

  const meta = {
    locale: 'zh-cn',
    testedCursorVersion: '3.7.42',
    lastUpdated: '2026-06-20',
  };
  fs.writeFileSync(path.join(translationsDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  for (const [src, dest] of MODULE_MAP) {
    const tsPath = path.join(localesRoot, src.replace(/\.js$/, '.ts'));
    if (!fs.existsSync(tsPath)) {
      console.warn(`跳过缺失: ${tsPath}`);
      continue;
    }

    const replacements = await loadFromTs(src);
    const moduleName = dest.replace(/\.i18n\.json$/, '');

    const out = {
      version: '1.0.0',
      locale: 'zh-cn',
      meta: { module: moduleName },
      replacements,
    };

    const outPath = path.join(translationsDir, dest);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
    console.log(`  ${dest} (${replacements.length} 条)`);
  }

  console.log(`\n已迁移至 ${translationsDir}`);
  console.log('下一步: node tools/build-i18n.mjs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * 校验 translations 下各 .i18n.json：去重冲突、必填字段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const translationsDir = path.join(repoRoot, 'i18n', 'cursor-language-pack-zh-hans', 'translations');

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
      results.push({ rel: rel.replace(/\\/g, '/'), full });
    }
  }
  return results;
}

function validateReplacement(item, file, index) {
  const errors = [];
  if (!item.originalText || typeof item.originalText !== 'string') {
    errors.push(`${file}[${index}]: 缺少 originalText`);
  }
  if (!item.changeText || typeof item.changeText !== 'string') {
    errors.push(`${file}[${index}]: 缺少 changeText`);
  }
  if (!['exact', 'partial', 'regex'].includes(item.searchType)) {
    errors.push(`${file}[${index}]: 无效 searchType "${item.searchType}"`);
  }
  return errors;
}

function main() {
  const files = collectI18nFiles(translationsDir);
  if (files.length === 0) {
    console.error(`错误: ${translationsDir} 下无 .i18n.json 文件`);
    process.exit(1);
  }

  const globalKeys = new Map();
  const errors = [];
  let total = 0;

  for (const { rel, full } of files) {
    const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
    const replacements = data.replacements ?? [];
    const localKeys = new Set();

    for (let i = 0; i < replacements.length; i++) {
      const item = replacements[i];
      total++;
      errors.push(...validateReplacement(item, rel, i));

      const key = `${item.searchType}:${item.originalText}:${item.flags ?? ''}`;
      if (localKeys.has(key)) {
        errors.push(`${rel}[${i}]: 文件内重复键 ${key}`);
      }
      localKeys.add(key);

      if (globalKeys.has(key)) {
        const prev = globalKeys.get(key);
        if (prev.changeText !== item.changeText) {
          errors.push(
            `${rel}[${i}]: 与 ${prev.file} 译文冲突 (${key}) — 「${prev.changeText}」vs「${item.changeText}」`,
          );
        }
      } else {
        globalKeys.set(key, { file: rel, changeText: item.changeText });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`校验失败 (${errors.length} 项):`);
    for (const e of errors.slice(0, 50)) {
      console.error(`  - ${e}`);
    }
    if (errors.length > 50) {
      console.error(`  ... 还有 ${errors.length - 50} 项`);
    }
    process.exit(1);
  }

  console.log(`校验通过: ${files.length} 个模块, ${total} 条替换规则, ${globalKeys.size} 个唯一键`);
}

main();

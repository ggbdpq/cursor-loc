#!/usr/bin/env node
/**
 * cursor-loc CLI 入口：apply / revert / status / doctor。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import {
  applyPatch,
  getPatchStatus,
  revertPatch,
  runDoctor,
} from '@cursor-loc/patch-core';
import type { Replacement } from '@cursor-loc/patch-core';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ReplacementsBundle {
  locale: string;
  meta?: { testedCursorVersion?: string; lastUpdated?: string };
  replacements: Replacement[];
}

/**
 * 读取扩展 build:i18n 生成的词典 bundle。
 *
 * CLI 与扩展共用同一份 `generated/replacements.bundle.json`，
 * 保证 apply/status 使用的词条与 VSIX 内一致。
 *
 * @returns {ReplacementsBundle} 解析后的词典 bundle。
 */
function loadBundle(): ReplacementsBundle {
  const bundlePath = join(__dirname, '..', '..', '..', 'i18n', 'cursor-language-pack-zh-hans', 'generated', 'replacements.bundle.json');
  const raw = readFileSync(bundlePath, 'utf-8');
  return JSON.parse(raw) as ReplacementsBundle;
}

const program = new Command();

program
  .name('cursor-zh')
  .description('Cursor IDE 专有界面简体中文汉化补丁')
  .version('0.1.0');

program
  .command('apply')
  .description('应用简体中文汉化补丁（请先完全关闭 Cursor）')
  .option('--app-root <path>', 'Cursor 安装根目录，例如 "D:\\Program Files\\cursor"')
  .action(async (opts: { appRoot?: string }) => {
    const bundle = loadBundle();
    const result = await applyPatch({
      installRoot: opts.appRoot,
      replacements: bundle.replacements,
      meta: bundle.meta,
    });
    for (const line of result.lines) {
      console.log(line);
    }
    if (!result.ok) {
      process.exit(1);
    }
  });

program
  .command('revert')
  .description('恢复 Cursor 原始英文界面')
  .option('--app-root <path>', 'Cursor 安装根目录')
  .action(async (opts: { appRoot?: string }) => {
    const result = await revertPatch(opts.appRoot);
    for (const line of result.lines) {
      console.log(line);
    }
    if (!result.ok) {
      process.exit(1);
    }
  });

program
  .command('status')
  .description('查看补丁状态')
  .option('--app-root <path>', 'Cursor 安装根目录')
  .action(async (opts: { appRoot?: string }) => {
    const bundle = loadBundle();
    const result = await getPatchStatus(
      opts.appRoot,
      bundle.replacements.length,
      bundle.meta?.testedCursorVersion,
    );
    console.log('Cursor 汉化补丁状态');
    console.log('-------------------');
    for (const line of result.lines) {
      console.log(line);
    }
    if (!result.ok) {
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('检查环境与写权限')
  .option('--app-root <path>', 'Cursor 安装根目录')
  .action(async (opts: { appRoot?: string }) => {
    console.log('Cursor 汉化补丁诊断');
    console.log('-------------------');
    const result = await runDoctor(opts.appRoot);
    for (const line of result.lines) {
      console.log(line);
    }
    if (!result.ok) {
      process.exit(1);
    }
  });

program.parse();

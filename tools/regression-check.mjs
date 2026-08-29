#!/usr/bin/env node
/**
 * apply/revert 回归检查（发版前必跑）。
 *
 * 在真实 Cursor 安装目录上执行四步断言：
 *   1. apply  → 补丁四件套齐全、checksums 与磁盘一致、meta 记录词条数与版本
 *   2. revert → 全部产物清除、workbench.js / package.json / product.json 字节级还原
 *
 * 用法：npm run regression [-- --app-root "D:\\path\\to\\cursor"]
 * 若当前已打补丁，先 revert 再取基线。脚本结束时保持未打补丁状态。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPatch,
  revertPatch,
  getPatchStatus,
  resolveCursorInstallPath,
  getAppRoot,
} from '../packages/patch-core/dist/index.js';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const appRootIdx = args.indexOf('--app-root');
const explicit = appRootIdx >= 0 ? args[appRootIdx + 1] : undefined;

const installPath = resolveCursorInstallPath(explicit);
const appRoot = getAppRoot(installPath);
const workbench = join(appRoot, 'out/vs/code/electron-sandbox/workbench/workbench.js');
const pkgJson = join(appRoot, 'package.json');
const productJson = join(appRoot, 'product.json');
const translatedFiles = [
  join(appRoot, 'out/vs/workbench/workbench.desktop.main_translated.js'),
  join(appRoot, 'out/vs/workbench/workbench.glass.main_translated.js'),
].filter((p) => existsSync(p.replace('_translated.js', '.js')));
const interceptor = join(appRoot, 'out/cursorTranslatorMain.js');
const meta = join(appRoot, 'out/cursor-zh-patch-meta.json');

const bundle = JSON.parse(
  readFileSync(
    join(repoRoot, 'i18n', 'cursor-language-pack-zh-hans', 'generated', 'replacements.bundle.json'),
    'utf-8',
  ),
);
const replacements = bundle.replacements;
let passCount = 0;
const failures = [];

/** @param {boolean} ok @param {string} name */
function check(ok, name) {
  if (ok) {
    passCount++;
  } else {
    failures.push(name);
  }
}

/** @param {string} file 文件路径 @param {Buffer} snapshot 基线 */
function bytesEqual(file, snapshot) {
  return existsSync(file) && Buffer.compare(readFileSync(file), snapshot) === 0;
}

console.log(`回归目标: ${installPath}（词典 ${replacements.length} 条）\n`);

// ── 基线：若已打补丁，先还原 ──
const before = await getPatchStatus(installPath, replacements.length);
if (before.patchInstalled) {
  console.log('当前已打补丁，先 revert 取基线…');
  const r = await revertPatch(installPath);
  if (!r.ok) {
    console.error('revert 失败，中止:', r.error);
    process.exit(1);
  }
}

/** 原始文件基线（Buffer）。 */
const baseline = {
  workbench: readFileSync(workbench),
  pkg: readFileSync(pkgJson),
  product: existsSync(productJson) ? readFileSync(productJson) : null,
};

// ── 第 1 步：apply ──
console.log('步骤 1/2: apply');
const applied = await applyPatch({ installRoot: installPath, replacements, meta: bundle.meta });
check(applied.ok, `apply 成功（${applied.error ?? ''}）`);

const status = await getPatchStatus(installPath, replacements.length);
check(status.patchInstalled === true, 'status 判定已安装');
check(!status.patchStale, `补丁未过期（patchStale=${status.patchStale}）`);
check(!!status.currentVersion, 'status 返回 Cursor 版本');

check(existsSync(interceptor), '拦截器已写入');
check(existsSync(meta), 'meta 已写入');
for (const tf of translatedFiles) {
  check(existsSync(tf), `翻译副本存在: ${tf.split(/[\\/]/).pop()}`);
  check(
    existsSync(tf) && readFileSync(tf, 'utf-8').slice(0, 65536).includes('TextTranslator'),
    `翻译副本含注入脚本: ${tf.split(/[\\/]/).pop()}`,
  );
}
check(
  readFileSync(workbench, 'utf-8').includes('_translated.js'),
  '启动器已指向翻译副本',
);
check(
  JSON.parse(readFileSync(pkgJson, 'utf-8')).main === './out/cursorTranslatorMain.js',
  'package.json main 已指向拦截器',
);
if (baseline.product) {
  const { createHash } = await import('node:crypto');
  const sums = JSON.parse(readFileSync(productJson, 'utf-8')).checksums ?? {};
  let sumsOk = Object.keys(sums).length > 0;
  for (const [key, stored] of Object.entries(sums)) {
    const f = join(appRoot, 'out', key);
    if (!existsSync(f)) {
      sumsOk = false;
      break;
    }
    const actual = createHash('sha256').update(readFileSync(f)).digest('base64').replace(/=+$/, '');
    if (actual !== stored) {
      sumsOk = false;
      break;
    }
  }
  check(sumsOk, 'product.json checksums 与磁盘一致');
}
const metaJson = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf-8')) : {};
check(metaJson.replacementCount === replacements.length, 'meta 记录词条数一致');
check(typeof metaJson.cursorVersion === 'string' && metaJson.cursorVersion.length > 0, 'meta 记录 Cursor 版本');
if (baseline.product) {
  // 版本一致性：备份过期（Cursor 升级后残留）会把旧版本号写回 package.json
  const prodVersion = JSON.parse(readFileSync(productJson, 'utf-8')).version;
  check(
    JSON.parse(readFileSync(pkgJson, 'utf-8')).version === prodVersion,
    `apply 后 package.json 版本与 product.json 一致（${prodVersion}）`,
  );
  check(metaJson.cursorVersion === prodVersion, 'meta 版本与 product.json 一致');
}

// ── 第 2 步：revert ──
console.log('步骤 2/2: revert');
const reverted = await revertPatch(installPath);
check(reverted.ok, `revert 成功（${reverted.error ?? ''}）`);

const after = await getPatchStatus(installPath, replacements.length);
check(after.patchInstalled === false, 'status 判定未安装');
for (const tf of translatedFiles) {
  check(!existsSync(tf), `翻译副本已删除: ${tf.split(/[\\/]/).pop()}`);
}
check(!existsSync(interceptor), '拦截器已删除');
check(!existsSync(meta), 'meta 已删除');
check(bytesEqual(workbench, baseline.workbench), 'workbench.js 字节级还原');
check(bytesEqual(pkgJson, baseline.pkg), 'package.json 字节级还原');
if (baseline.product) {
  check(bytesEqual(productJson, baseline.product), 'product.json 字节级还原');
  const prodVersion = JSON.parse(readFileSync(productJson, 'utf-8')).version;
  check(
    JSON.parse(readFileSync(pkgJson, 'utf-8')).version === prodVersion,
    'revert 后 package.json 版本与 product.json 一致',
  );
}

// ── 结果 ──
console.log(`\n通过 ${passCount} 项${failures.length > 0 ? `，失败 ${failures.length} 项:` : '，全部通过 ✅'}`);
for (const f of failures) {
  console.error(`  ✗ ${f}`);
}
process.exit(failures.length > 0 ? 1 : 0);

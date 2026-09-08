/**
 * revert 恢复入口契约测试（临时文件副本，不触碰真实 Cursor 安装目录）。
 *
 * 锁定任务验收条款：
 * 1. 已打补丁 → 恢复原入口；
 * 2. 再次恢复 → 无额外变化（幂等，明确返回无须恢复）；
 * 3. 备份缺失 → 用确定性反向替换还原启动器；无法还原的部分（校验和）必须报告，禁止猜测；
 * 4. 干净目录 → 明确返回无须恢复，文件不动。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// patch-core dist 为 ESM 而本扩展编译为 CJS，须动态 import（tsc TS1479）
let revertPatch: (installRoot?: string) => Promise<{ ok: boolean; lines: string[] }>;

beforeAll(async () => {
  ({ revertPatch } = await import('../../../../packages/patch-core/dist/index.js'));
});

const ORIGINAL_LOADER = 'await import(new URL(`${t}.js`,m).href)';
const TRANSLATED_LOADER = 'await import(new URL(`${t}_translated.js`,m).href)';
const ORIGINAL_MAIN = './out/main.js';
const CHECKSUM_KEY = 'vs/code/electron-sandbox/workbench/workbench.js';

/** 原始（未打补丁）的安装目录内容。 */
function originalFiles() {
  return new Map<string, string>([
    ['package.json', JSON.stringify({ name: 'cursor', version: '3.0.0', main: ORIGINAL_MAIN })],
    ['out/vs/workbench/workbench.desktop.main.js', 'WB;'],
    ['out/vs/code/electron-sandbox/workbench/workbench.js', ORIGINAL_LOADER],
    ['product.json', JSON.stringify({ checksums: { [CHECKSUM_KEY]: 'orig' } })],
  ]);
}

/** 在临时目录构造一份「已被旧版 apply 打过补丁」的安装结构。 */
function makePatchedFixture(options: { withBackups: boolean }): string {
  const installRoot = mkdtempSync(join(tmpdir(), 'cursor-zh-revert-test-'));
  const appRoot = join(installRoot, 'resources', 'app');
  for (const dir of [
    'out/vs/workbench',
    'out/vs/code/electron-sandbox/workbench',
  ]) {
    mkdirSync(join(appRoot, dir), { recursive: true });
  }

  for (const [rel, content] of originalFiles()) {
    writeFileSync(join(appRoot, rel), content, 'utf-8');
  }

  // 模拟旧版 apply 的全部产物
  writeFileSync(join(appRoot, 'out/vs/workbench/workbench.desktop.main_translated.js'), 'TextTranslator();WB;', 'utf-8');
  writeFileSync(join(appRoot, 'out/cursorTranslatorMain.js'), 'INTERCEPTOR;', 'utf-8');
  writeFileSync(
    join(appRoot, 'out/cursor-zh-patch-meta.json'),
    JSON.stringify({ replacementCount: 1508, appliedAt: '2026-01-01T00:00:00.000Z', cursorVersion: '3.0.0' }),
    'utf-8',
  );
  writeFileSync(
    join(appRoot, 'package.json'),
    JSON.stringify({ name: 'cursor', version: '3.0.0', main: './out/cursorTranslatorMain.js', main_original: ORIGINAL_MAIN }),
    'utf-8',
  );
  writeFileSync(
    join(appRoot, 'out/vs/code/electron-sandbox/workbench/workbench.js'),
    TRANSLATED_LOADER,
    'utf-8',
  );
  writeFileSync(
    join(appRoot, 'product.json'),
    JSON.stringify({ checksums: { [CHECKSUM_KEY]: 'patched' } }),
    'utf-8',
  );

  if (options.withBackups) {
    for (const [rel, content] of originalFiles()) {
      if (rel === 'package.json') {
        writeFileSync(join(appRoot, 'package.json.backup'), content, 'utf-8');
      } else if (rel === 'out/vs/code/electron-sandbox/workbench/workbench.js') {
        writeFileSync(join(appRoot, `${rel}.cursor-zh-backup`), content, 'utf-8');
      } else if (rel === 'product.json') {
        writeFileSync(join(appRoot, 'product.json.backup'), content, 'utf-8');
      }
    }
  }

  return installRoot;
}

/** 在临时目录构造一份干净的（从未打补丁）安装结构。 */
function makeCleanFixture(): string {
  const installRoot = mkdtempSync(join(tmpdir(), 'cursor-zh-clean-test-'));
  const appRoot = join(installRoot, 'resources', 'app');
  mkdirSync(join(appRoot, 'out/vs/code/electron-sandbox/workbench'), { recursive: true });
  for (const [rel, content] of originalFiles()) {
    mkdirSync(join(appRoot, rel, '..'), { recursive: true });
    writeFileSync(join(appRoot, rel), content, 'utf-8');
  }
  return installRoot;
}

/** 递归快照目录内容（相对路径 → 文本内容），用于对比两次 revert 之间是否无变化。 */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const p = join(current, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else {
        out.set(p.slice(dir.length + 1), readFileSync(p, 'utf-8'));
      }
    }
  };
  walk(dir);
  return out;
}

describe('revert 恢复入口契约（临时目录副本）', () => {
  it('已打补丁 → 恢复原入口并删除全部补丁文件', async () => {
    const root = makePatchedFixture({ withBackups: true });
    try {
      const result = await revertPatch(root);
      expect(result.ok).toBe(true);

      const appRoot = join(root, 'resources', 'app');
      const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8'));
      expect(pkg.main).toBe(ORIGINAL_MAIN);
      expect(pkg.main_original).toBeUndefined();
      expect(readFileSync(join(appRoot, 'out/vs/code/electron-sandbox/workbench/workbench.js'), 'utf-8')).toBe(ORIGINAL_LOADER);
      expect(JSON.parse(readFileSync(join(appRoot, 'product.json'), 'utf-8')).checksums[CHECKSUM_KEY]).toBe('orig');

      expect(existsSync(join(appRoot, 'out/vs/workbench/workbench.desktop.main_translated.js'))).toBe(false);
      expect(existsSync(join(appRoot, 'out/cursorTranslatorMain.js'))).toBe(false);
      expect(existsSync(join(appRoot, 'out/cursor-zh-patch-meta.json'))).toBe(false);
      expect(existsSync(join(appRoot, 'package.json.backup'))).toBe(false);
      expect(existsSync(join(appRoot, 'product.json.backup'))).toBe(false);
      expect(existsSync(join(appRoot, 'out/vs/code/electron-sandbox/workbench/workbench.js.cursor-zh-backup'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('再次恢复 → 成功返回且目录内容无额外变化', async () => {
    const root = makePatchedFixture({ withBackups: true });
    try {
      await revertPatch(root);
      const afterFirst = snapshot(root);

      const second = await revertPatch(root);
      expect(second.ok).toBe(true);
      expect(second.lines.join('\n')).toContain('无须');

      expect(snapshot(root)).toEqual(afterFirst);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('备份缺失 → 启动器按确定性反向替换还原；无法还原的校验和必须报告而非猜测', async () => {
    const root = makePatchedFixture({ withBackups: false });
    try {
      const result = await revertPatch(root);
      expect(result.ok).toBe(true);

      const appRoot = join(root, 'resources', 'app');
      expect(readFileSync(join(appRoot, 'out/vs/code/electron-sandbox/workbench/workbench.js'), 'utf-8')).toBe(ORIGINAL_LOADER);
      const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8'));
      expect(pkg.main).toBe(ORIGINAL_MAIN);

      const lines = result.lines.join('\n');
      expect(lines).toContain('校验和');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('干净目录 → 明确返回无须恢复，且文件保持不动', async () => {
    const root = makeCleanFixture();
    try {
      const before = snapshot(root);
      const result = await revertPatch(root);

      expect(result.ok).toBe(true);
      expect(result.lines.join('\n')).toContain('无须');
      expect(snapshot(root)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

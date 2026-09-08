/**
 * 卸载判定单元测试。
 *
 * 缺陷背景：isExtensionUninstalled 曾用 process.execPath（Cursor.exe 所在
 * 的安装目录）往上推导 extensions.json，实际清单在用户主目录
 * ~/.cursor/extensions/extensions.json——错误路径导致「无法判定」恒成立，
 * 卸载后的自动还原从不执行（用户实测：点卸载无任何反应）。
 *
 * 锁定行为：
 * 1. 清单不含本扩展 → 已卸载；
 * 2. 清单含本扩展且未标记删除 → 仍安装；
 * 3. 清单含本扩展但 .obsolete 已标记 → 已卸载（VS Code 卸载后两处异步收口）；
 * 4. 文件缺失/损坏 → 无法判定（宁可不动）。
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  commands: { registerCommand: vi.fn(), executeCommand: vi.fn() },
  ExtensionMode: { Development: 1, Production: 2, Test: 3 },
}));
vi.mock('../outputChannel.js', () => ({
  getOutputChannel: vi.fn(),
  logLine: vi.fn(),
  logSection: vi.fn(),
}));

import { isExtensionUninstalled } from '../extension.js';

const ID = 'ggbdpq.cursor-language-pack-zh-hans';

function writeManifest(dir: string, ids: string[]): string {
  const manifestPath = path.join(dir, 'extensions.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(ids.map((id) => ({ identifier: { id } }))),
    'utf-8',
  );
  return manifestPath;
}

describe('isExtensionUninstalled（读 ~/.cursor/extensions/extensions.json）', () => {
  it('清单不含本扩展 → 已卸载', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-zh-detect-'));
    const manifestPath = writeManifest(dir, ['ms-ceintl.vscode-language-pack-zh-hans']);
    expect(isExtensionUninstalled(manifestPath, path.join(dir, '.obsolete'))).toBe(true);
  });

  it('清单含本扩展且未标记删除 → 仍安装', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-zh-detect-'));
    const manifestPath = writeManifest(dir, [ID, 'dracula-theme.theme-dracula']);
    expect(isExtensionUninstalled(manifestPath, path.join(dir, '.obsolete'))).toBe(false);
  });

  it('清单含本扩展但 .obsolete 已标记 → 已卸载', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-zh-detect-'));
    const manifestPath = writeManifest(dir, [ID]);
    fs.writeFileSync(
      path.join(dir, '.obsolete'),
      JSON.stringify({ [`${ID}-0.0.9`]: true }),
      'utf-8',
    );
    expect(isExtensionUninstalled(manifestPath, path.join(dir, '.obsolete'))).toBe(true);
  });

  it('清单与标记都缺失 → 无法判定（不动作）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-zh-detect-'));
    expect(isExtensionUninstalled(path.join(dir, 'extensions.json'), path.join(dir, '.obsolete'))).toBe(false);
  });
});

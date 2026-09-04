/**
 * 工作区内容禁区契约测试（issue #2）。
 *
 * 词典含单词级 exact 词条（cloud/text/a 等），而注入脚本默认扫描整个
 * document.body，Monaco 按 token 切分 text node，代码 token 与文件名会
 * 被 exact 词条撞中。修复方式是在 TreeWalker 过滤器里加禁区（closest），
 * 本测试锁定「禁区选择器存在且在文本节点过滤器中生效」这一契约——
 * 真实渲染行为的验收由 tools/e2e-coverage.mjs（CDP 实机采样）覆盖。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 扩展编译为 CommonJS（tsc 禁用 import.meta），vitest 的 cwd 即本扩展根目录
const assetPath = join(
  process.cwd(),
  '..',
  '..',
  'packages',
  'patch-core',
  'src',
  'assets',
  'cursor.inject.js',
);

describe('cursor.inject.js 工作区禁区', () => {
  const source = readFileSync(assetPath, 'utf-8');

  it('声明禁区选择器，覆盖编辑器代码与文件树', () => {
    expect(source).toContain("'.view-lines'");
    expect(source).toContain("'.explorer-folders-view'");
    expect(source).toContain("'.xterm-rows'");
  });

  it('文本节点过滤器在放行前先做禁区检查', () => {
    // closest 检查必须位于 FILTER_ACCEPT 之前的同函数内，防止后续改动把禁区判断挪丢
    const filterIdx = source.indexOf('acceptNode');
    const closestIdx = source.indexOf('parent.closest(NO_TRANSLATE_SELECTOR)');
    const acceptIdx = source.indexOf('NodeFilter.FILTER_ACCEPT', closestIdx);
    expect(closestIdx).toBeGreaterThan(filterIdx);
    expect(acceptIdx).toBeGreaterThan(closestIdx);
  });
});

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

  it('聊天代码块与 diff 卡片在禁区（0.0.8）', () => {
    // Streamdown markdown 代码块：只排除 code 内容，保留 header 按钮（Apply/Copy）可翻
    expect(source).toContain('[data-streamdown="code-block"] code');
    // UI 代码块（StyleX）：只排除内容区，保留 header
    expect(source).toContain("'.ui-code-block-content'");
    // 聊天里的 diff 卡片（settings.json 卡片等）
    expect(source).toContain("'[data-ui-code-block-diff]'");
  });

  it('文本节点过滤器在放行前先做禁区检查', () => {
    // closest 检查必须位于 FILTER_ACCEPT 之前的同函数内，防止后续改动把禁区判断挪丢
    const filterIdx = source.indexOf('acceptNode');
    const closestIdx = source.indexOf('parent.closest(NO_TRANSLATE_SELECTOR)');
    const acceptIdx = source.indexOf('NodeFilter.FILTER_ACCEPT', closestIdx);
    expect(closestIdx).toBeGreaterThan(filterIdx);
    expect(acceptIdx).toBeGreaterThan(closestIdx);
  });

  it('所有 mutation 入口统一先过禁区（0.0.11 shouldSkipNode）', () => {
    // 0.0.9 的 characterData/addedNodes 直调 translateTextNode 绕开了过滤器禁区，
    // Monaco .view-lines 打字产生的每次字符变更都进入完整匹配流程（卡顿根因之一）
    expect(source).toContain('function shouldSkipNode(');

    // processMutations 内不得直接调用翻译——必须经 enqueueNode 统一禁区判断
    const pmIdx = source.indexOf('function processMutations(');
    const pmEnd = source.indexOf('function ', pmIdx + 10);
    const pmBody = source.slice(pmIdx, pmEnd);
    expect(pmBody).not.toContain('translateTextNode(');
    expect(pmBody).not.toContain('translateElement(');
    expect(pmBody).toContain('enqueueNode');

    // enqueueNode 入口与 translateElement 根节点入口都做禁区短路
    const enqIdx = source.indexOf('function enqueueNode(');
    expect(source.slice(enqIdx, source.indexOf('}', enqIdx))).toContain('shouldSkipNode');
    const teIdx = source.indexOf('translateElement(rootNode)');
    const teBody = source.slice(teIdx, source.indexOf('createTreeWalker', teIdx));
    expect(teBody).toContain('NO_TRANSLATE_SELECTOR');
  });
});

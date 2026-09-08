/**
 * 性能契约测试（0.0.9 增量引擎）。
 *
 * 0.0.8 及更早版本的注入脚本是打字/滚动卡顿的根源：attachShadow 原型劫持、
 * document.body 全量 MutationObserver（每次变更 rAF 全页 TreeWalker 重扫）、
 * setTimeout(task, 100) 每秒 10 次全页扫描。
 *
 * 本测试锁定增量引擎的实现契约——这些机制不得回流：
 * 1. 禁止定时轮询（setTimeout/setInterval 周期扫描）；
 * 2. 禁止 attachShadow 原型劫持（closed shadow 不翻译是可接受取舍）；
 * 3. 禁止每次变更触发全页扫描：初始 pass 只跑一次，变更走增量路径；
 * 4. exact 词条必须走 Map（O(1)），不得对每个节点线性遍历词典。
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

describe('cursor.inject.js 增量引擎性能契约', () => {
  const source = readFileSync(assetPath, 'utf-8');

  it('禁止定时轮询：不得出现 setTimeout/setInterval 周期扫描', () => {
    expect(source.includes('setTimeout')).toBe(false);
    expect(source.includes('setInterval')).toBe(false);
  });

  it('禁止 attachShadow 原型劫持', () => {
    // 注释里允许提及历史；代码层面不得出现原型替换
    expect(source.includes('Element.prototype.attachShadow')).toBe(false);
  });

  it('初始全页 pass 只跑一次，变更走增量路径', () => {
    // 初始 pass 函数存在且只被 task() 调用一次
    expect(source).toContain('function runInitialPass()');
    expect(source.match(/runInitialPass\(\);/g)?.length).toBe(1);
    // 增量处理函数存在，observer 回调经 rAF 合帧
    expect(source).toContain('function processMutations(');
    expect(source).toContain('requestAnimationFrame');
    // observer 只做门铃：回调内不得直接调用全页翻译
    const cbIdx = source.indexOf('new MutationObserver');
    const rafIdx = source.indexOf('requestAnimationFrame', cbIdx);
    expect(rafIdx).toBeGreaterThan(cbIdx);
    expect(source.slice(cbIdx, rafIdx)).not.toContain('translateElement(');
  });

  it('exact 词条走 O(1) Map，不做逐节点线性遍历', () => {
    expect(source).toContain('exactMap = new Map()');
    expect(source).toContain('exactMap.get(');
    // translateTextNode 内不得按词典顺序 for 循环全量比对 exact
    const fnIdx = source.indexOf('translateTextNode(textNode)');
    const fnEnd = source.indexOf('createTextNodeFilter', fnIdx);
    const body = source.slice(fnIdx, fnEnd);
    expect(body).toContain('exactMap');
    expect(body.includes('this.mappings')).toBe(false);
  });

  it('mode 标记为 incremental（自检可观测）', () => {
    expect(source).toContain("mode: 'incremental'");
  });
});

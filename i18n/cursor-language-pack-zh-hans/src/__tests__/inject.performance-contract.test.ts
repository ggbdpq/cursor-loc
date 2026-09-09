/**
 * 性能契约测试（0.0.11 热路径止血版）。
 *
 * 0.0.9 增量引擎消除了旧引擎的定时轮询与全页重扫，但实测滚动/输入仍有卡顿，
 * 0.0.11 针对四个残余根因加固，本测试锁定这些机制不得回流：
 * 1. 禁止定时轮询（setTimeout/setInterval 周期扫描）；idle 降级走 MessageChannel
 *    宏任务，同样不引入定时器；
 * 2. 禁止 rAF 翻译调度——rAF 在绘制前同步执行，与 Monaco layout / React render
 *    抢帧预算；翻译必须走 requestIdleCallback 低优先级分片，单批 ≤3ms；
 * 3. L0 门铃（document.body）禁止监听 characterData——Monaco 打字的 mutation
 *    记录必须从源头消失，而不是进入回调后再过滤；
 * 4. 增量处理只入队、不直接翻译，childList 不重扫变更父容器 m.target；
 * 5. exact 词条必须走 Map（O(1)），不得对每个节点线性遍历词典。
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

  it('禁止 rAF 翻译调度：必须 requestIdleCallback 低优先级分片', () => {
    expect(source.includes('requestAnimationFrame')).toBe(false);
    expect(source).toContain('requestIdleCallback');

    // 单批 JS 执行预算 ≤3ms（60 FPS 一帧约 16.7ms，不得与渲染抢帧）
    const budget = Number(source.match(/BATCH_BUDGET_MS = (\d+)/)?.[1]);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(3);
  });

  it('L0 门铃不监听 characterData：打字记录从源头消失', () => {
    // body 上的根 observer 选项块中不得出现 characterData
    const observeIdx = source.indexOf('rootObserver.observe(document.body');
    expect(observeIdx).toBeGreaterThan(-1);
    const opts = source.slice(observeIdx, source.indexOf('});', observeIdx));
    expect(opts).toContain('childList: true');
    expect(opts).not.toContain('characterData');

    // characterData 监听只存在于 L1 汉化区域容器上
    expect(source).toContain('zoneObserver.observe');
  });

  it('初始全页 pass 只跑一次，变更走增量路径', () => {
    // 初始 pass 函数存在且只被 task() 调用一次
    expect(source).toContain('function runInitialPass()');
    expect(source.match(/runInitialPass\(\);/g)?.length).toBe(1);
    expect(source).toContain('function processMutations(');
  });

  it('observer 回调只入队，翻译统一在 idle 分片消费', () => {
    // 第一个 observer（L1）回调里只有 processMutations，不得直接翻译
    const zoneObsIdx = source.indexOf('new MutationObserver');
    const cbEnd = source.indexOf('});', zoneObsIdx);
    const cbBody = source.slice(zoneObsIdx, cbEnd);
    expect(cbBody).toContain('processMutations');
    expect(cbBody).not.toContain('translateElement(');
    expect(cbBody).not.toContain('translateTextNode(');

    // idle 分片消费点 processQueue 存在
    expect(source).toContain('function processQueue(');
  });

  it('childList 只处理 addedNodes，不重扫变更父容器', () => {
    const pmIdx = source.indexOf('function processMutations(');
    const pmEnd = source.indexOf('function ', pmIdx + 10);
    const pmBody = source.slice(pmIdx, pmEnd);

    expect(pmBody).toContain('addedNodes');
    // 0.0.9 的 seenElements 父容器重扫机制不得回流
    expect(pmBody.includes('seenElements')).toBe(false);
    expect(pmBody.includes('m.target.nodeType')).toBe(false);
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

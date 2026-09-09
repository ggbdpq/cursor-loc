/**
 * 热路径行为契约测试（0.0.11）。
 *
 * 静态契约（inject.performance-contract）锁定实现形态；本文件在 stub DOM
 * 全局环境里真实执行注入脚本（占位符替换后写临时模块并 require 加载），
 * 用行为锁定 0.0.11 的性能目标：
 * - Monaco 编辑器连续 1000 次 characterData（打字）→ 翻译函数零调用、零调度；
 * - Monaco 虚拟滚动新增 5000 节点 → 零 TreeWalker、零翻译调度；
 * - 汉化区域内（Composer）文本变更仍被增量翻译——汉化能力保留；
 * - L0 门铃发现新汉化区域并注册 L1 监听（缩圈不漏区）；
 * - 队列超 3ms 预算必须让出，让出后在后续空闲片继续消费（禁止 Long Task）；
 * - requestIdleCallback 不可用时 MessageChannel 宏任务降级仍消费队列。
 *
 * 实机输入/滚动的 Long Task 验收由 DevTools Performance 录制与
 * tools/e2e-coverage.mjs 覆盖，本文件是可在 CI 运行的行为下界。
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const rawSource = readFileSync(
  join(process.cwd(), '..', '..', 'packages', 'patch-core', 'src', 'assets', 'cursor.inject.js'),
  'utf-8',
);

const nodeRequire = createRequire(join(process.cwd(), 'package.json'));
const tmpDir = mkdtempSync(join(tmpdir(), 'cursor-inject-test-'));
const instrumentedPath = join(tmpDir, 'cursor.inject.instrumented.cjs');

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** stub closest 的类别键：脚本只会传这两类选择器，用特征子串区分。 */
const NO_TRANSLATE_KEY = 'nolang';
const ZONE_KEY = 'zone';

interface StubNode {
  nodeType: number;
  parentElement: StubNode | null;
  isConnected: boolean;
  labels: Set<string>;
  text: string;
  reads: number;
  writes: string[];
  registeredTexts: StubNode[];
  closest(sel: string): StubNode | null;
  matches(sel: string): boolean;
  querySelectorAll(_sel: string): StubNode[];
  hasAttribute(_name: string): boolean;
  getAttribute(_name: string): null;
  setAttribute(_name: string, _value: string): void;
}

function labelKey(sel: string): string {
  return sel.includes('.view-lines') ? NO_TRANSLATE_KEY : ZONE_KEY;
}

function makeNode(nodeType: number, parent: StubNode | null, labels: string[]): StubNode {
  const node: StubNode = {
    nodeType,
    parentElement: parent,
    isConnected: true,
    labels: new Set(labels),
    text: '',
    reads: 0,
    writes: [],
    registeredTexts: [],
    closest(sel: string) {
      // 与 DOM 规范一致：从元素自身开始沿祖先链匹配
      const key = labelKey(sel);
      let cur: StubNode | null = this;
      while (cur) {
        if (cur.labels.has(key)) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    },
    matches(sel: string) {
      return this.labels.has(labelKey(sel));
    },
    querySelectorAll() {
      return [];
    },
    hasAttribute(_name: string) {
      return false;
    },
    getAttribute(_name: string): null {
      return null;
    },
    setAttribute(_name: string, _value: string) {},
  };
  Object.defineProperties(node, {
    textContent: {
      get() {
        node.reads++;
        return node.text;
      },
      set(value: string) {
        node.writes.push(value);
        node.text = value;
      },
    },
  });
  return node;
}

const makeText = (text: string, parent: StubNode | null, labels: string[] = []): StubNode => {
  const n = makeNode(3, parent, labels);
  n.text = text;
  return n;
};
const makeElement = (parent: StubNode | null, labels: string[] = []): StubNode =>
  makeNode(1, parent, labels);

interface FakeDeadline {
  timeRemaining: () => number;
}

interface FakeMO {
  cb: (muts: Array<Record<string, unknown>>) => void;
  observeCalls: Array<{ target: unknown; options: Record<string, unknown> }>;
  observe(target: unknown, options: Record<string, unknown>): void;
}

interface Env {
  state: { treeWalkers: number; idleRequests: number };
  setClock: (fn: () => number) => void;
  idleCbs: Array<(d: FakeDeadline) => void>;
  body: StubNode;
  zoneObserver: FakeMO;
  rootObserver: FakeMO;
  flushIdle: (deadline?: FakeDeadline) => void;
}

describe('cursor.inject.js 热路径行为契约（0.0.11）', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const savedDescs = new Map<string, PropertyDescriptor | undefined>();

  function stubGlobal(key: string, value: unknown) {
    if (!savedDescs.has(key)) {
      savedDescs.set(key, Object.getOwnPropertyDescriptor(g, key));
    }
    g[key] = value;
  }

  afterEach(() => {
    for (const [key, desc] of savedDescs) {
      if (desc) {
        Object.defineProperty(g, key, desc);
      } else {
        delete g[key];
      }
    }
    savedDescs.clear();
  });

  /**
   * 搭建 stub 全局并加载注入脚本（词典替换为真实词条 Apply→应用）。
   *
   * @param opts.withIdle false 时不提供 requestIdleCallback，驱动 MessageChannel 降级路径。
   * @param opts.extraSandbox 额外全局（如 MessageChannel stub）。
   */
  function setup(
    opts: { withIdle?: boolean; extraGlobals?: Record<string, unknown> } = {},
  ): Env {
    const state = { treeWalkers: 0, idleRequests: 0, clock: (): number => 0 };
    const idleCbs: Array<(d: FakeDeadline) => void> = [];
    const moInstances: FakeMO[] = [];
    const body = makeElement(null);

    class FakeMO implements FakeMO {
      cb: (muts: Array<Record<string, unknown>>) => void;
      observeCalls: Array<{ target: unknown; options: Record<string, unknown> }> = [];
      constructor(cb: (muts: Array<Record<string, unknown>>) => void) {
        this.cb = cb;
        moInstances.push(this);
      }
      observe(target: unknown, options: Record<string, unknown>) {
        this.observeCalls.push({ target, options });
      }
    }

    stubGlobal('MutationObserver', FakeMO);
    stubGlobal('Node', { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 });
    stubGlobal('NodeFilter', { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 });
    stubGlobal('window', globalThis);
    stubGlobal('performance', { now: () => state.clock() });
    if (opts.withIdle !== false) {
      stubGlobal('requestIdleCallback', (cb: (d: FakeDeadline) => void) => {
        state.idleRequests++;
        idleCbs.push(cb);
        return idleCbs.length;
      });
    }

    stubGlobal('document', {
      readyState: 'complete',
      body,
      addEventListener() {},
      querySelectorAll() {
        return [];
      },
      createTreeWalker(root: StubNode) {
        state.treeWalkers++;
        const list = root.registeredTexts;
        let i = 0;
        return {
          nextNode: () => (i < list.length ? list[i++] : null),
        };
      },
    });

    const extra = opts.extraGlobals ?? {};
    for (const [key, value] of Object.entries(extra)) {
      stubGlobal(key, value);
    }

    // 占位符替换后写临时模块，按标准模块机制加载执行
    const source = rawSource.replace(
      "'${replacementsArray}'",
      () => JSON.stringify([{ originalText: 'Apply', changeText: '应用', searchType: 'exact' }]),
    );
    writeFileSync(instrumentedPath, source, 'utf-8');
    delete nodeRequire.cache[nodeRequire.resolve(instrumentedPath)];
    nodeRequire(instrumentedPath);

    // sanity：初始 pass 与两级 observer 都已就位，防止 task() 静默吞错造成假绿
    const patch = (globalThis as { __cursorZhPatch?: { active: boolean } }).__cursorZhPatch;
    expect(patch?.active).toBe(true);
    expect(moInstances.length).toBe(2);

    return {
      state,
      setClock: (fn: () => number) => {
        state.clock = fn;
      },
      idleCbs,
      body,
      zoneObserver: moInstances[0],
      rootObserver: moInstances[1],
      flushIdle: (deadline: FakeDeadline = { timeRemaining: () => 1000 }) => {
        for (const cb of idleCbs.splice(0)) {
          cb(deadline);
        }
      },
    };
  }

  it('L0 门铃只监听 childList：characterData 记录从源头消失', () => {
    const { rootObserver, zoneObserver } = setup();

    expect(rootObserver.observeCalls.length).toBe(1);
    const rootOpts = rootObserver.observeCalls[0].options;
    expect(rootOpts.childList).toBe(true);
    expect(rootOpts.characterData).toBeUndefined();

    // L1 才监听 characterData，且初始没有区域时不注册任何容器
    expect(zoneObserver.observeCalls.length).toBe(0);
  });

  it('Monaco 连续输入 1000 次 characterData：translateTextNode 调用次数 = 0', () => {
    const { state, idleCbs, zoneObserver } = setup();
    const monacoRoot = makeElement(null, [NO_TRANSLATE_KEY]);
    const texts = Array.from({ length: 1000 }, () =>
      makeText('const value = compute();', monacoRoot),
    );

    zoneObserver.cb(texts.map((t) => ({ type: 'characterData', target: t })));

    // 禁区节点连队列都没进：翻译器从未读取文本，也未触发任何 idle 调度
    expect(texts.every((t) => t.reads === 0)).toBe(true);
    expect(idleCbs.length).toBe(0);
    expect(state.idleRequests).toBe(0);
  });

  it('Monaco 虚拟滚动新增 5000 节点：translateElement 调用次数 = 0', () => {
    const { state, idleCbs, body, rootObserver } = setup();
    const monacoRoot = makeElement(body, [NO_TRANSLATE_KEY]);
    const rows = Array.from({ length: 5000 }, () => makeElement(monacoRoot));

    rootObserver.cb([{ type: 'childList', target: body, addedNodes: rows }]);

    expect(state.treeWalkers).toBe(0);
    expect(idleCbs.length).toBe(0);
    expect(state.idleRequests).toBe(0);
  });

  it('汉化区域内文本仍被增量翻译：Composer 文本 Apply → 应用', () => {
    const { zoneObserver, flushIdle } = setup();
    const composer = makeElement(null, [ZONE_KEY]);
    const text = makeText('Apply', composer);

    zoneObserver.cb([{ type: 'characterData', target: text }]);
    expect(text.reads).toBe(0); // 入队时未消费

    flushIdle();

    expect(text.reads).toBe(1);
    expect(text.writes).toEqual(expect.arrayContaining(['应用']));
  });

  it('L0 发现新汉化区域：注册 L1 监听并把存量内容入队翻译', () => {
    const { state, rootObserver, zoneObserver, flushIdle } = setup();
    const dialogText = makeText('Apply', null);
    const dialog = makeElement(null, [ZONE_KEY]);
    dialog.registeredTexts = [dialogText];

    rootObserver.cb([{ type: 'childList', target: null, addedNodes: [dialog] }]);

    // L1 收到新容器注册，存量内容已入队
    expect(zoneObserver.observeCalls.length).toBe(1);
    expect(zoneObserver.observeCalls[0].target).toBe(dialog);

    flushIdle();
    expect(state.treeWalkers).toBe(1);
    expect(dialogText.writes).toEqual(expect.arrayContaining(['应用']));
  });

  it('汉化区域内新增元素子树被翻译', () => {
    const { zoneObserver, flushIdle } = setup();
    const composer = makeElement(null, [ZONE_KEY]);
    const innerText = makeText('Apply', null);
    const addedDiv = makeElement(composer);
    addedDiv.registeredTexts = [innerText];

    zoneObserver.cb([{ type: 'childList', target: composer, addedNodes: [addedDiv] }]);
    flushIdle();

    expect(innerText.writes).toEqual(expect.arrayContaining(['应用']));
  });

  it('队列超 3ms 预算让出主线程，后续空闲片继续消费', () => {
    const { setClock, idleCbs, zoneObserver, flushIdle } = setup();
    const composer = makeElement(null, [ZONE_KEY]);
    const texts = Array.from({ length: 200 }, (_, i) => makeText(`Item ${i}`, composer));

    zoneObserver.cb(texts.map((t) => ({ type: 'characterData', target: t })));

    // 步进时钟：每次读 performance.now 前进 0.6ms（start 读 0，此后循环头逐次递增）
    let ticks = 0;
    setClock(() => {
      ticks += 0.6;
      return ticks;
    });

    const processed = () => texts.reduce((acc, t) => acc + (t.reads > 0 ? 1 : 0), 0);

    // 首批：只消费少量节点就到达 3ms 预算，让出并重新排队
    flushIdle();
    const firstBatch = processed();
    expect(firstBatch).toBeGreaterThan(0);
    expect(firstBatch).toBeLessThanOrEqual(5);
    expect(idleCbs.length).toBeGreaterThanOrEqual(1);

    // 反复 flush 直到全部消费完：无任何一批超过预算对应的节点数
    let guard = 0;
    let prev = firstBatch;
    let maxBatch = firstBatch;
    while (processed() < texts.length && guard++ < 200) {
      ticks = 0; // 每个空闲片时钟重置
      flushIdle();
      const total = processed();
      maxBatch = Math.max(maxBatch, total - prev);
      prev = total;
    }
    expect(processed()).toBe(texts.length);
    expect(maxBatch).toBeLessThanOrEqual(5);
  });

  it('requestIdleCallback 不可用时 MessageChannel 宏任务降级仍消费队列', async () => {
    const deliveries: Array<() => void> = [];
    class FakeChannel {
      port1: { onmessage: null | (() => void) } = { onmessage: null };
      port2 = {
        postMessage: () => {
          deliveries.push(() => this.port1.onmessage?.());
        },
      };
    }

    const env = setup({
      withIdle: false,
      extraGlobals: { MessageChannel: FakeChannel },
    });
    const composer = makeElement(null, [ZONE_KEY]);
    const text = makeText('Apply', composer);

    env.zoneObserver.cb([{ type: 'characterData', target: text }]);
    expect(text.reads).toBe(0); // 尚未消费

    for (const deliver of deliveries.splice(0)) {
      deliver();
    }

    expect(text.writes).toEqual(expect.arrayContaining(['应用']));
  });
});

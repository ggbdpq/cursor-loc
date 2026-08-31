#!/usr/bin/env node
/**
 * CDP 渲染层验收：启动隔离的 Cursor 实例，读取真实渲染的 DOM 文本，
 * 产出「渲染层覆盖率」与残留英文清单。比 OCR / 静态正则精确，零噪声。
 *
 * 用法（需 Node ≥ 22，内置 WebSocket）：
 *   node tools/e2e-coverage.mjs                 # 手动模式：在弹出的窗口里走遍界面，Ctrl+C 结束
 *   node tools/e2e-coverage.mjs --seconds 40    # 自动模式：定时采样（尽力自动打开设置页）后结束
 *
 * 对所有 page 型 target 并发采样（启动引导页与真正 workbench 是不同 target）。
 * 产物（不入库）：
 *   tools/output/e2e-report.json   汇总（可见文本数、中文数、残留英文数）
 *   tools/output/e2e-pending.md    残留英文清单（人类核对后补词典）
 *
 * ponytail 局限：只采样可见文本（含 open Shadow DOM）；base VS Code 的英文会
 * 出现在清单里（MS 语言包负责），人工核对时跳过。
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCursorInstallPath } from '../packages/patch-core/dist/index.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, 'tools', 'output');
const PORT = 9223;
const PROFILE = join(tmpdir(), 'cursor-zh-e2e-profile');
const POLL_MS = 1500;

if (typeof WebSocket === 'undefined') {
  console.error('需要 Node ≥ 22（内置 WebSocket）。fnm 用户：PATH 前置 fnm 的 node-versions/v22 目录。');
  process.exit(1);
}

const args = process.argv.slice(2);
const secIdx = args.indexOf('--seconds');
const autoSeconds = secIdx >= 0 ? Number(args[secIdx + 1]) : undefined;

// ── 定位可执行文件 ──
const installRoot = resolveCursorInstallPath(
  args.includes('--app-root') ? args[args.indexOf('--app-root') + 1] : undefined,
);
const exe =
  process.platform === 'darwin'
    ? join(installRoot, 'MacOS', 'Cursor')
    : join(installRoot, 'Cursor.exe');
if (!existsSync(exe)) {
  console.error(`未找到 Cursor 可执行文件: ${exe}`);
  process.exit(1);
}

// ── 词典与归一化（与 cursor.inject.js 一致）──
const bundle = JSON.parse(
  readFileSync(
    join(ROOT, 'i18n', 'cursor-language-pack-zh-hans', 'generated', 'replacements.bundle.json'),
    'utf-8',
  ),
);
const exactSet = new Set(
  bundle.replacements.filter((r) => r.searchType === 'exact').map((r) => r.originalText),
);
const normalize = (t) =>
  t.replace(/\u00a0/g, ' ').replace(/[\u2019\u2018]/g, "'").replace(/[\u201c\u201d]/g, '"').trim();

// ── 启动隔离实例 ──
// 先清理上次运行可能残留的孤儿实例（同 profile，避免端口/单例冲突）
try {
  const wmic =
    process.platform === 'win32'
      ? execSync(
          `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='Cursor.exe'\\" | Where-Object { $_.CommandLine -like '*cursor-zh-e2e-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
          { stdio: 'ignore' },
        )
      : execSync(`pkill -f "cursor-zh-e2e-profile"`, { stdio: 'ignore' });
} catch { /* 无残留 */ }
console.log(`启动隔离 Cursor 实例（profile: ${PROFILE}）…`);
const child = spawn(
  exe,
  [
    '--user-data-dir=' + PROFILE,
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    '--no-first-run',
  ],
  { stdio: 'ignore' },
);

const seen = new Set();
let polls = 0;
let finished = false;
let patchActive; // window.__cursorZhPatch 探针结果
const conns = new Map(); // targetUrl -> { ws, send, evaluate }

function isSkippable(t) {
  if (t.length < 2 || t.length > 200) return true;
  if (!/[A-Za-z]/.test(t)) return true;
  if (/[\u4e00-\u9fff]/.test(t)) return false; // 含中文 = 已翻译
  if (/\$\{|\$\(|\)\s*\{|\b=>\b|\|\||&&/.test(t)) return true; // 代码片段
  if (/^--[\w-]+\s*:|[{};]/.test(t)) return true; // CSS 文本
  if (/^[0-9\s\p{P}]+$/u.test(t)) return true;
  if (/^(https?:|file:|vscode|monaco|mailto:)/i.test(t)) return true;
  return false;
}

function finish() {
  if (finished) return;
  finished = true;
  for (const { ws } of conns.values()) {
    try { ws.close(); } catch { /* 忽略 */ }
  }
  writeReport();
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch { /* 实例可能已退出 */ }
  process.exit(0);
}

function writeReport() {
  mkdirSync(OUT_DIR, { recursive: true });
  const texts = [...seen];
  const withChinese = texts.filter((t) => /[\u4e00-\u9fff]/.test(t));
  const english = texts.filter((t) => !isSkippable(t) && !/[\u4e00-\u9fff]/.test(t));
  const dictHits = texts.filter((t) => exactSet.has(normalize(t)));
  if (patchActive === undefined) patchActive = false;
  // 补丁生效自检：见到的英文里若大量命中词典原文，说明注入未生效
  const patchLikelyInactive = english.length > 0 && dictHits.length >= 5 && withChinese.length <= 1;

  writeFileSync(
    join(OUT_DIR, 'e2e-report.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        durationPolls: polls,
        exe,
        seenTotal: texts.length,
        withChinese: withChinese.length,
        dictionaryExactHitsOnSeen: dictHits.length,
        leftoverEnglish: english.length,
        patchLikelyInactive,
        patchActive: typeof patchActive === 'boolean' ? patchActive : null,
      },
      null,
      2,
    ),
  );
  const md = [
    '# 渲染层残留英文（自动生成，勿手改）',
    '',
    `- 采样轮数：${polls}；可见文本 ${texts.length} 条（含中文 ${withChinese.length} 条）`,
    '- 说明：含 VS Code 底座英文（MS 语言包负责，跳过）；核对后补进 translations/ 对应模块并跑 npm run validate:i18n',
    '',
    `## 残留英文（${english.length} 条，按长度排序）`,
    '',
    ...english.sort((a, b) => a.length - b.length).map((t) => `- [ ] \`${t.replace(/`/g, "'")}\``),
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'e2e-pending.md'), md);
  console.log('\n报告已写入 tools/output/e2e-report.json 与 e2e-pending.md');
  console.log(`可见文本 ${texts.length} | 含中文 ${withChinese.length} | 词典命中 ${dictHits.length} | 残留英文 ${english.length}`);
}

// ── CDP：对所有 page target 并发采样 ──
const EVAL_TEXTS = `(() => {
  const out = new Set();
  const skip = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);
  const walk = (root, depth) => {
    if (depth > 12) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const tag = n.parentElement && n.parentElement.tagName;
      if (tag && skip.has(tag)) continue;
      const t = (n.textContent || '').trim();
      if (t) out.add(t);
    }
    const scope = root.body || root;
    if (scope.querySelectorAll) {
      for (const e of scope.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot, depth + 1);
    }
    if (root.body && root.body.shadowRoot) walk(root.body.shadowRoot, depth + 1);
  };
  if (document.body) walk(document, 0);
  return JSON.stringify([...out]);
})()`;

function keyCombo(conn, code, keyCode, ctrl) {
  const base = { modifiers: ctrl ? 2 : 0, key: code, code, windowsVirtualKeyCode: keyCode };
  conn.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  conn.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  // 连接挂起保护：CDP WS 若 5 秒未建立，视为无效 target
  await new Promise((res, rej) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* 忽略 */ }
      rej(new Error('websocket connect timeout'));
    }, 5000);
    ws.onopen = () => { clearTimeout(timer); res(); };
    ws.onerror = () => { clearTimeout(timer); rej(new Error('websocket error')); };
  });
  const waiters = {};
  const localId = { n: 1 };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && waiters[msg.id]) {
      waiters[msg.id](msg);
      delete waiters[msg.id];
    }
  };
  const send = (method, params) => ws.send(JSON.stringify({ id: localId.n++, method, params }));
  const evaluate = (expression) =>
    new Promise((res) => {
      const myId = localId.n++;
      // 应答超时保护：防止个别 target 挂起导致整轮采样卡死
      const timer = setTimeout(() => {
        delete waiters[myId];
        res([]);
      }, 5000);
      waiters[myId] = (msg) => {
        clearTimeout(timer);
        try {
          res(JSON.parse(msg.result?.result?.value ?? '[]'));
        } catch {
          res([]);
        }
      };
      // 用注册时的 myId 发送（不能经由 send 再自增，否则应答 id 错位）
      ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  const conn = { ws, send, evaluate };
  conns.set(target.url, conn);
  console.log(`已连接: ${target.url.split('/').pop()}`);
  return conn;
}

async function refreshTargets() {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    for (const target of list.filter((t) => t.type === 'page')) {
      if (!conns.has(target.url)) {
        try {
          await connect(target);
        } catch { /* target 可能瞬时不可用 */ }
      }
    }
  } catch { /* 端口未就绪 */ }
}

async function main() {
  for (let i = 0; i < 30; i++) {
    await refreshTargets();
    if (conns.size > 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (conns.size === 0) throw new Error('CDP 未发现任何 page target');

  if (autoSeconds !== undefined) {
    // 自动模式尽力而为：先 Esc 关欢迎页，再补发 Ctrl+, 打开设置页
    setTimeout(async () => {
      await refreshTargets();
      for (const conn of conns.values()) keyCombo(conn, 'Escape', 27, false);
    }, 5000);
    setTimeout(async () => {
      for (const conn of conns.values()) keyCombo(conn, 'Comma', 188, true);
    }, 9000);
    setTimeout(async () => {
      await refreshTargets();
      for (const conn of conns.values()) keyCombo(conn, 'Comma', 188, true);
    }, 16000);
    console.log(`自动采样 ${autoSeconds}s（尽力自动打开设置页；手动在窗口里走界面采得更全）…`);
  } else {
    console.log('手动模式：在窗口里走遍界面（Settings/Agent/Composer…），走完按 Ctrl+C 结束');
  }

  const poll = async () => {
    polls++;
    await refreshTargets();
    for (const conn of conns.values()) {
      const texts = await conn.evaluate(EVAL_TEXTS);
      for (const t of texts) seen.add(t);
      if (patchActive !== true) {
        try {
          // evaluate 的 wrapper 会对返回值 JSON.parse：页面内先 stringify，外层拿回字符串再解析
          const probe = await conn.evaluate('JSON.stringify(window.__cursorZhPatch ?? null)');
          const parsed = typeof probe === 'string' ? JSON.parse(probe) : probe;
          if (parsed && typeof parsed === 'object' && parsed.active) patchActive = true;
        } catch { /* 页面未就绪，下轮再试 */ }
      }
    }
    console.log(`轮 ${polls}: 累计可见文本 ${seen.size}（${conns.size} 个页面）`);
  };

  await poll();
  const timer = setInterval(poll, POLL_MS);
  if (autoSeconds !== undefined) {
    // 采样到内容后再计满时长；workbench 冷启动渲染可能需要 10-30 秒
    const startedAt = Date.now();
    const hardDeadline = startedAt + (autoSeconds + 45) * 1000;
    const check = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const settled = seen.size > 0 && elapsedMs >= autoSeconds * 1000;
      if (settled || elapsedMs >= (autoSeconds + 45) * 1000) {
        clearInterval(check);
        clearInterval(timer);
        finish();
      }
    }, 1000);
  } else {
    process.on('SIGINT', () => { clearInterval(timer); finish(); });
  }
}

try {
  await main();
} catch (err) {
  console.error('验收失败:', err instanceof Error ? err.message : err);
  finish();
}

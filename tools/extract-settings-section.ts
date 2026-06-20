/**
 * 从 Cursor workbench.desktop.main.js 按 Settings 页面关键词提取 label/description/title
 *
 * 用法: npm run extract:settings -- mcp hooks network beta
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SECTION_KEYWORDS: Record<string, string[]> = {
  mcp: ['MCP', 'Browser automation', 'Authentication', 'Installed MCP', 'Plugin MCP'],
  hooks: ['Hooks', 'hook execution', 'sessionStart', 'beforeSubmitPrompt', 'Execution Log'],
  network: ['Network', 'HTTP/2', 'Required Domains', 'Diagnostic'],
  beta: ['Update Access', 'Early Access', 'Extension RPC', 'Beta'],
  agents: ['Auto-Run', 'Agent Review', 'Web Search', 'Run Mode', 'Subagent'],
  general: ['Window Layout', 'Conversation Density', 'System Notifications'],
  indexing: ['Codebase Indexing', 'Index New Folders', 'Add Doc'],
  plugins: ['Browse Marketplace', 'Installed', 'Suggested', 'Plugins'],
};

function findWorkbenchPath(): string {
  try {
    const where = execSync('where cursor', { encoding: 'utf-8' }).split(/\r?\n/)[0]?.trim();
    if (where) {
      const root = resolve(where, '..', '..', '..');
      const p = join(root, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
      readFileSync(p, 'utf-8');
      return p;
    }
  } catch {
    // fall through
  }
  return 'D:\\Program Files\\cursor\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';
}

function extractStrings(content: string): string[] {
  const patterns = [
    /label:"((?:\\.|[^"\\])*)"/g,
    /description:"((?:\\.|[^"\\])*)"/g,
    /title:"((?:\\.|[^"\\])*)"/g,
    /placeholder:"((?:\\.|[^"\\])*)"/g,
  ];
  const found = new Set<string>();

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const raw = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\u2019/g, '\u2019');
      if (raw.length >= 3 && raw.length <= 300 && /[a-zA-Z]/.test(raw)) {
        found.add(raw);
      }
    }
  }
  return [...found].sort();
}

function main() {
  const sections = process.argv.slice(2);
  const workbench = findWorkbenchPath();
  const content = readFileSync(workbench, 'utf-8');
  const all = extractStrings(content);
  const outDir = join(process.cwd(), 'scripts', 'output');
  mkdirSync(outDir, { recursive: true });

  const targetSections = sections.length > 0 ? sections : Object.keys(SECTION_KEYWORDS);

  for (const section of targetSections) {
    const keywords = SECTION_KEYWORDS[section];
    if (!keywords) {
      console.warn(`未知分区: ${section}`);
      continue;
    }
    const matched = all.filter((s) => keywords.some((k) => s.includes(k)));
    const outPath = join(outDir, `candidates-${section}.json`);
    writeFileSync(outPath, JSON.stringify(matched, null, 2), 'utf-8');
    console.log(`[${section}] ${matched.length} 条 -> ${outPath}`);
  }

  console.log(`\n来源: ${workbench}`);
  console.log(`总候选: ${all.length} 条`);
}

main();

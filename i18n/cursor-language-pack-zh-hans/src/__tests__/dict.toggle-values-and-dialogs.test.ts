/**
 * 词典契约测试（0.0.8）。
 *
 * 单词级 exact 词条（on/On/Off）会把聊天代码块里的配置值撞翻（"onType"→"于Type"、
 * "on"→"开"），这些值虽然已由渲染层禁区保护，但一旦以独立文本节点出现在其他
 * 未禁区的自定义组件里仍会中招——从源头删除，切换类 UI 不依赖这些词条。
 * 另锁定退出/停止确认弹窗的 5 条漏翻（用户实测截图）。
 * 依赖 generated/replacements.bundle.json 已由 npm run build:i18n 生成。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bundlePath = join(process.cwd(), 'generated', 'replacements.bundle.json');
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const entries = bundle.replacements as Array<{
  originalText: string;
  changeText: string;
  searchType: string;
}>;

describe('词典:单词级 toggle 词条', () => {
  it.each(['on', 'On', 'off', 'Off'])('不再含 exact 词条 "%s"', (word) => {
    const hit = entries.find(
      (m) => m.searchType === 'exact' && m.originalText === word,
    );
    expect(hit).toBeUndefined();
  });
});

describe('词典:退出/停止确认弹窗漏翻(0.0.8)', () => {
  it.each([
    'Agent is still working',
    'Stopping now will cancel the current task.',
    'Discarding backups is taking a bit longer...',
    'Closing the window is taking a bit longer...',
    'Close Anyway',
  ])('含词条 "%s"', (text) => {
    const hit = entries.find(
      (m) => m.originalText === text && m.searchType === 'exact',
    );
    expect(hit).toBeDefined();
  });
});

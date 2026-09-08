/**
 * 弹窗流程契约测试：一次引导，一键重启。
 *
 * 0.0.9 初版弹窗链路实测（用户截图）：引导弹窗 → 应用 → 二次「需要重启」
 * 弹窗 → 看门狗 quit → Cursor 原生 Quit 确认 → 重启。其中二次弹窗是纯冗余
 * （用户在引导弹窗里已选择「应用并重启」）；恢复弹窗同时出现「取消」与系统
 * 自动补的「Cancel」两个等价按钮。
 *
 * 锁定契约：
 * 1. 应用成功后直接冷重启，不得出现第二次重启确认弹窗；
 * 2. 恢复弹窗只保留一个确认按钮（Cancel 由系统自动补，不得自写「取消」）；
 * 3. 引导弹窗带跨窗口去重标记（主窗 + Agent 窗各激活一次扩展，不得双弹）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src', 'extension.ts'), 'utf-8');

describe('弹窗流程契约（一次引导，一键重启）', () => {
  it('apply 成功后直接冷重启，二次重启确认弹窗已删除', () => {
    expect(source.includes('RESTART_REQUIRED_MESSAGE')).toBe(false);
    expect(source.includes('RESTART_BUTTON')).toBe(false);
    // handleApply 的成功分支内直接调用冷重启
    const applyIdx = source.indexOf('async function handleApply');
    const revertIdx = source.indexOf('async function handleRevert');
    expect(applyIdx).toBeGreaterThan(-1);
    const body = source.slice(applyIdx, revertIdx);
    expect(body).toContain('await restartCursor(context)');
  });

  it('恢复确认弹窗只保留一个确认按钮，不得自写「取消」', () => {
    expect(source.includes("'恢复', '取消'")).toBe(false);
    expect(source).toContain("'恢复英文并重启'");
  });

  it('引导弹窗带跨窗口去重标记，双窗口不双弹', () => {
    expect(source).toContain('GLOBAL_KEY_PROMPT_PENDING_AT');
    // 弹窗前写入标记（update(...PENDING_AT..., Date.now())），弹窗后清除
    const markIdx = source.indexOf('GLOBAL_KEY_PROMPT_PENDING_AT, Date.now()');
    const modalIdx = source.indexOf('是否要应用 Cursor 专有界面中文汉化');
    const clearIdx = source.indexOf('GLOBAL_KEY_PROMPT_PENDING_AT, undefined');
    expect(markIdx).toBeGreaterThan(-1);
    expect(modalIdx).toBeGreaterThan(markIdx);
    expect(clearIdx).toBeGreaterThan(modalIdx);
  });
});

/**
 * 卸载还原可靠性契约测试。
 *
 * 缺陷背景（0.0.8 及更早版本即存在）：deactivate 用 setTimeout(…, 1000)
 * 兜底判定卸载，但 VSIX 卸载后扩展宿主进程会在 1 秒内退出，定时器回调
 * 大概率永不执行 → 安装目录补丁残留、用户也收不到任何提示。
 *
 * 锁定契约：deactivate 的源码中不得出现「依赖延时定时器做卸载还原」的
 * 结构；卸载判定必须走同步的磁盘事实（extensions.json）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const srcPath = join(process.cwd(), 'src', 'extension.ts');
const source = readFileSync(srcPath, 'utf-8');

describe('卸载还原可靠性（deactivate 不与进程退出赛跑）', () => {
  it('deactivate 内不得用 setTimeout 做卸载还原兜底', () => {
    const deactivateIdx = source.indexOf('export async function deactivate');
    expect(deactivateIdx).toBeGreaterThan(-1);
    const deactivateBody = source.slice(deactivateIdx);
    expect(deactivateBody.includes('setTimeout')).toBe(false);
  });

  it('卸载判定必须读磁盘上的 extensions.json（同步事实，而非内存 API）', () => {
    expect(source).toContain('extensions.json');
    // 判定函数在 deactivate 之前定义并可被同步调用
    const helperIdx = source.indexOf('function isExtensionUninstalled');
    const deactivateIdx = source.indexOf('export async function deactivate');
    expect(helperIdx).toBeGreaterThan(-1);
    expect(helperIdx).toBeLessThan(deactivateIdx);
  });
});

/**
 * 扩展输出通道封装。
 *
 * 所有 apply/revert/status/doctor 的详细日志统一写入「Cursor 专有界面汉化」面板。
 */
import * as vscode from 'vscode';

/** 输出面板标题，与扩展 displayName 一致。 */
const CHANNEL_NAME = 'Cursor 专有界面汉化';

/** 单例输出通道，由 {@link getOutputChannel} 懒创建。 */
let channel: vscode.OutputChannel | undefined;

/**
 * 获取或创建输出通道。
 *
 * @returns VS Code OutputChannel 实例
 */
export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return channel;
}

/**
 * 追加一行日志。
 *
 * @param message 日志正文
 * @param reveal 为 true 时自动展开输出面板
 */
export function logLine(message: string, reveal = false): void {
  const ch = getOutputChannel();
  ch.appendLine(message);
  if (reveal) {
    ch.show(true);
  }
}

/**
 * 清空通道并写入带分隔线的标题块（命令结果展示用）。
 *
 * @param title 区块标题
 * @param lines 正文行
 * @param reveal 默认 true，写入后展示面板
 */
export function logSection(title: string, lines: string[], reveal = true): void {
  const ch = getOutputChannel();
  ch.clear();
  ch.appendLine(title);
  ch.appendLine('-'.repeat(title.length));
  for (const line of lines) {
    ch.appendLine(line);
  }
  if (reveal) {
    ch.show(true);
  }
}

/** 释放输出通道（扩展 dispose 时可选调用）。 */
export function disposeOutputChannel(): void {
  channel?.dispose();
  channel = undefined;
}

/**
 * Cursor 安装路径解析。
 *
 * 扩展在 Cursor 内运行时通过 `vscode.env.appRoot` 反推安装根，不依赖 PATH 或硬编码路径。
 */
import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';

/** workbench 主文件相对 `resources/app` 的路径，用于校验安装根是否有效。 */
const WORKBENCH_REL = path.join('out', 'vs', 'workbench', 'workbench.desktop.main.js');

/**
 * 判断目录是否为有效的 Cursor 安装根。
 *
 * @param installRoot 待检测目录
 * @returns 存在 workbench.desktop.main.js 则为 true
 */
function isValidInstallRoot(installRoot: string): boolean {
  const workbench = path.join(installRoot, 'resources', 'app', WORKBENCH_REL);
  return fs.existsSync(workbench);
}

/**
 * 从 `vscode.env.appRoot`（通常为 `…/resources/app`）反推安装根目录。
 *
 * 依次尝试上两级、上一级、当前目录，兼容不同打包布局。
 *
 * @returns 有效安装根，无法解析时 undefined
 */
export function resolveInstallRootFromEditorAppRoot(): string | undefined {
  const editorAppRoot = vscode.env.appRoot;
  if (!editorAppRoot) {
    return undefined;
  }

  const candidates = [
    path.resolve(editorAppRoot, '..', '..'), // 常见：resources/app → 安装根
    path.resolve(editorAppRoot, '..'),
    editorAppRoot,
  ];

  for (const candidate of candidates) {
    if (isValidInstallRoot(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * 解析扩展最终使用的 Cursor 安装根目录。
 *
 * 优先级：用户配置 `cursorZh.appRoot` > 当前编辑器实例自动检测。
 * 若返回 undefined，{@link patchService} 会 fallback 到 CLI 的 pathResolver 自动检测。
 *
 * @param configuredAppRoot 设置中的 appRoot，可为空
 */
export function resolveEffectiveInstallRoot(configuredAppRoot?: string): string | undefined {
  const configured = configuredAppRoot?.trim();
  if (configured) {
    return configured;
  }
  return resolveInstallRootFromEditorAppRoot();
}

/**
 * Cursor 汉化补丁 — Electron 协议拦截器。
 *
 * 将 `vscode-file:` 协议下对 workbench 入口的请求
 * 重定向到对应的 `_translated.js` 副本。
 *
 * 必须用动态 `import('./main.js')`：本文件是 ESM（package.json `"type": "module"`），
 * 静态 import 会被提升到模块体之前执行，导致 Cursor 先注册 vscode-file，拦截失效。
 */

import { session } from 'electron';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** 原始 workbench 文件名到翻译副本文件名的映射。 */
const WORKBENCH_ENTRY_MAP = new Map([
  ['workbench.desktop.main.js', 'workbench.desktop.main_translated.js'],
  ['workbench.glass.main.js', 'workbench.glass.main_translated.js'],
]);
/** VS Code / Cursor 自定义文件协议 scheme。 */
const TARGET_SCHEME = 'vscode-file';

/**
 * 将 vscode-file URL 解析为本地文件路径。
 *
 * @param {string} url vscode-file 协议 URL。
 * @returns {string | null} 本地绝对路径；非目标协议时返回 null。
 */
function vscodeUrlToPath(url) {
  try {
    if (typeof url !== 'string') {
      return null;
    }

    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== `${TARGET_SCHEME}:`) {
      return null;
    }

    let pathname = parsedUrl.pathname;

    if (process.platform === 'win32' && pathname.startsWith('/') && pathname.length > 2 && pathname[2] === ':') {
      pathname = pathname.substring(1);
    }

    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/**
 * 判断该文件路径是否应重定向到翻译副本。
 *
 * @param {string} filePath 本地文件路径。
 * @returns {boolean} 目标为 workbench 且翻译副本存在时返回 true。
 */
function shouldRedirect(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  try {
    const fileName = basename(filePath);
    const translatedFileName = WORKBENCH_ENTRY_MAP.get(fileName);
    if (!translatedFileName) {
      return false;
    }

    const dir = dirname(filePath);
    const translatedPath = join(dir, translatedFileName);

    return existsSync(translatedPath);
  } catch {
    return false;
  }
}

/**
 * 构造指向翻译版 workbench 的 URL。
 *
 * @param {string} originalUrl 原始 vscode-file URL。
 * @returns {string} 替换 pathname 后的 URL；解析失败时返回原 URL。
 */
function createRedirectUrl(originalUrl) {
  try {
    const urlObj = new URL(originalUrl);
    const originalPath = urlObj.pathname;
    const translatedFileName = WORKBENCH_ENTRY_MAP.get(basename(originalPath));
    if (!translatedFileName) {
      return originalUrl;
    }
    const dir = dirname(originalPath);
    const newPath = join(dir, translatedFileName).replace(/\\/g, '/');

    urlObj.pathname = newPath;
    return urlObj.toString();
  } catch {
    return originalUrl;
  }
}

/**
 * 包装 registerFileProtocol 回调，在加载 workbench 时自动重定向。
 *
 * @param {Function} handler 原始协议处理器。
 * @returns {Function} 包装后的处理器。
 */
function createWrappedHandler(handler) {
  return (request, callback) => {
    const originalUrl = request.url;
    const filePath = vscodeUrlToPath(originalUrl);

    if (!filePath || !shouldRedirect(filePath)) {
      return handler(request, callback);
    }

    const redirectUrl = createRedirectUrl(originalUrl);
    const modifiedRequest = { ...request, url: redirectUrl };
    return handler(modifiedRequest, callback);
  };
}

/**
 * 劫持 `session.defaultSession.protocol.registerFileProtocol`。
 *
 * 必须在 Cursor 调用 registerFileProtocol('vscode-file', ...) 之前执行。
 */
function applyProtocolPatch() {
  try {
    const originalRegisterFileProtocol = session.defaultSession.protocol.registerFileProtocol;
    session.defaultSession.protocol.registerFileProtocol = function (scheme, handler) {
      if (scheme !== TARGET_SCHEME) {
        return originalRegisterFileProtocol.call(this, scheme, handler);
      }
      return originalRegisterFileProtocol.call(this, scheme, createWrappedHandler(handler));
    };
  } catch (error) {
    console.error('[cursor-zh] Failed to install protocol interceptor:', error?.message);
  }
}

applyProtocolPatch();

await import('./main.js');

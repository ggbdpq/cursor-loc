import type { Replacement } from '../types.js';

/** apply 时写入安装目录的补丁元数据。 */
export interface PatchInstallMeta {
  replacementCount: number;
  appliedAt: string;
  /** apply 时的 Cursor 版本；用于检测「Cursor 已升级、补丁待重打」。 */
  cursorVersion?: string;
}

/**
 * Cursor 汉化补丁安装器抽象基类。
 *
 * 负责将词典注入 workbench、安装协议拦截器，并在 uninstall 时恢复原始入口。
 */
export abstract class CursorTranslator {
  protected cursorIdeInstalledDirectory: string;
  protected interceptorFileContent: string;

  /**
   * @param cursorInstallPath Cursor 安装根目录。
   * @param interceptorFileContent Electron 主进程协议拦截脚本内容。
   */
  constructor(cursorInstallPath: string, interceptorFileContent: string) {
    this.cursorIdeInstalledDirectory = cursorInstallPath;
    this.interceptorFileContent = interceptorFileContent;
  }

  /**
   * 写入翻译版 workbench 并修改 package.json 入口。
   *
   * @param replacements 运行时 DOM 替换词典。
   * @param cursorVersion apply 时的 Cursor 版本，写入元数据。
   */
  abstract install(replacements: readonly Replacement[], cursorVersion?: string): void;

  /** 删除补丁文件并恢复 package.json。 */
  abstract uninstall(): void;

  /**
   * 当前平台是否受支持。
   *
   * @param platform `process.platform` 值。
   */
  abstract isSupported(platform: string): boolean;

  /**
   * 查询补丁文件是否齐全。
   *
   * @returns 翻译副本、拦截器、package.json 修改状态。
   */
  abstract getStatus(): {
    translatedFileExists: boolean;
    interceptorExists: boolean;
    packageJsonPatched: boolean;
    /** workbench.js 是否已改为加载 `_translated.js`。 */
    loaderPatched?: boolean;
    targetStatuses?: Array<{
      label: string;
      sourceExists: boolean;
      translatedFileExists: boolean;
    }>;
  };

  /**
   * 读取已安装补丁元数据；默认实现返回 null（旧版或未安装）。
   */
  getInstalledMeta(): PatchInstallMeta | null {
    return null;
  }

  /** 翻译副本是否包含 DOM 注入脚本。 */
  translatedFileHasInjectScript(): boolean {
    return false;
  }
}

/**
 * 单条 DOM 文本替换规则。
 *
 * 由 CLI 注入到 `cursor.inject.js`，在运行时按顺序匹配并替换界面文本。
 */
export interface Replacement {
  /** 待匹配的英文原文。 */
  originalText: string;
  /** 替换后的中文（或「中文(English)」）文案。 */
  changeText: string;
  /** 匹配方式：整句精确、子串 partial、或正则 regex。 */
  searchType: 'exact' | 'partial' | 'regex';
  /** regex 模式下的 RegExp flags，默认 `g`。 */
  flags?: string;
}

/**
 * 语言包模块结构。
 *
 * `locales/zh-cn/index.ts` 聚合各 Settings 分区词典后导出此结构。
 */
export interface LocaleModule {
  /** BCP 47 语言标识，例如 `zh-cn`。 */
  LOCALE: string;
  /** 去重后的全部替换规则。 */
  REPLACEMENTS: Replacement[];
  meta?: {
    /** 词典最后一次完整验证的 Cursor 版本。 */
    testedCursorVersion?: string;
    /** 词典最近更新日期（ISO 8601）。 */
    lastUpdated?: string;
  };
}

/**
 * `cursor-zh status` 返回的补丁安装状态摘要。
 */
export interface PatchStatus {
  /** 三项子状态均为 true 时视为已安装。 */
  installed: boolean;
  cursorVersion?: string;
  cursorPath?: string;
  replacementCount: number;
  translatedFileExists: boolean;
  interceptorExists: boolean;
  packageJsonPatched: boolean;
}

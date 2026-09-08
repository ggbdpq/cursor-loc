/**
 * 注入到 workbench 副本头部的运行时 DOM 翻译脚本（0.0.9 增量引擎）。
 *
 * 由 patch-core 在 apply 阶段写入 workbench.desktop.main_translated.js 顶部；
 * 词典 JSON 在构建时内联到本文件末尾的 REPLACEMENTS 变量。
 *
 * 与旧引擎（≤0.0.8）的性能差异——旧引擎卡顿的三个根源全部移除：
 * 1. 无 100ms 定时轮询（旧：每秒 10 次全页扫描，与用户操作无关）；
 * 2. 无 attachShadow 劫持（旧：强制 closed → open，侵入全局原型）；
 * 3. 无每次变更全页 TreeWalker（旧：document.body 级 observer，打字每字符全扫）。
 *
 * 0.0.9 设计：
 * - exact 词条（1422/1508）进 Map，O(1) 查找；partial/regex（86 条）仅对
 *   未命中 exact 且较短的节点回退，长文本节点跳过 partial（partial 词条均为短语级）；
 * - MutationObserver 只在 body 上做「变更门铃」，回调里只处理 mutations
 *   实际涉及的节点，不做全页扫描；
 * - rAF 合帧：同帧多次变更只处理一次；
 * - 归一化与禁区（工作区代码不翻译）逻辑与 0.0.8 保持一致。
 */
(function () {
  'use strict';

  var cachedMappings = null;
  var exactMap = null;        // normalizedText -> changeText
  var partialRules = [];      // 短语级 partial 规则
  var regexRules = [];        // regex 规则
  var sharedTranslator = null;
  var observerStarted = false;
  var scheduled = false;
  var pendingNodes = null;    // Set<Node>，rAF 内消费

  /** 需要扫描并翻译的 DOM 根节点选择器（与 0.0.8 一致，仅用于初始 pass）。 */
  var ROOT_SELECTORS = [
    '.monaco-dialog-box',
    '.monaco-dialog',
    '.monaco-modal-dialog',
    '[role="dialog"]',
    '.dialog-message',
    '.cursor-settings-layout-main',
    '.cursor-settings-layout-nav',
    '.cursor-settings-sidebar',
    '[class*="cursor-settings"]',
    '.settings-editor',
    '[data-component="agent-panel"]',
    '[data-component="composer"]',
    '.composer-bar',
    '.composer-input-blur-wrapper',
    '.agent-layout',
    '[class*="agents-window"]',
    '[class*="agent-window"]',
    '[data-component="agents-window"]',
    '[data-component="agent-window"]',
    '[data-component="glass-in-app-menubar"]',
    '[role="menu"]',
    '[role="menuitem"]',
    '.menubar-menu-button',
    '.menubar-menu-title',
    '.review-panel',
    '.inline-diff-review',
    '.cursor-settings-layout',
    '.full-settings-editor',
    '.workbench',
  ];

  /**
   * 工作区内容禁区：命中这些选择器的文本节点一律不翻译。
   *
   * 编辑器代码（.view-lines 覆盖主编辑器、diff、Notebook）、文件树、搜索结果、
   * 终端输出、面包屑，以及聊天面板里的代码内容——这些是用户代码与文件名，
   * 词典里的单词级 exact 词条（cloud/text/on 等）会与代码 token 撞车。
   * 聊天代码块只排除 code 内容与 diff 卡片，header 上的 Apply/Copy 按钮保持可翻。
   */
  var NO_TRANSLATE_SELECTOR = [
    '.view-lines',
    '.explorer-folders-view',
    '.search-view .results',
    '.xterm-rows',
    '.monaco-breadcrumbs',
    '[data-streamdown="code-block"] code',
    '.ui-code-block-content',
    '[data-ui-code-block-diff]',
  ].join(', ');

  /** partial 回退的文本长度上限：超过视为长文本（正文/代码片段），跳过 86 条模糊规则。 */
  var PARTIAL_MAX_LEN = 200;

  /**
   * 规范化 UI 文本，便于 exact 匹配（弯引号、不间断空格等）。
   *
   * @param {string} text 原始文本。
   * @returns {string} 规范化后的文本。
   */
  function normalizeForMatch(text) {
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/\u2019/g, "'")
      .replace(/\u2018/g, "'")
      .replace(/\u201c/g, '"')
      .replace(/\u201d/g, '"')
      .trim();
  }

  /**
   * 将词典拆分为 O(1) exact Map 与少量模糊规则表。
   *
   * @param {Array<{originalText: string, changeText: string, searchType: string, flags?: string}>} mappings 替换词典。
   */
  function buildIndexes(mappings) {
    exactMap = new Map();
    partialRules = [];
    regexRules = [];

    for (var i = 0; i < mappings.length; i++) {
      var m = mappings[i];
      if (m.searchType === 'exact') {
        exactMap.set(normalizeForMatch(m.originalText), m.changeText);
      } else if (m.searchType === 'partial') {
        partialRules.push(m);
      } else if (m.searchType === 'regex') {
        try {
          regexRules.push({ re: new RegExp(m.originalText, m.flags || 'g'), changeText: m.changeText });
        } catch (_e) {
          // 非法正则词条跳过，不影响其余翻译
        }
      }
    }
  }

  /**
   * 运行时 DOM 文本翻译器（增量模式）。
   */
  class TextTranslator {
    /** @param {Array<{originalText: string, changeText: string, searchType: string, flags?: string}>} mappings 替换词典。 */
    constructor(mappings) {
      buildIndexes(mappings);
      this.nodeCache = new WeakMap();
    }

    /**
     * 翻译单个文本节点，命中后写回 DOM。
     *
     * exact 用 Map 查找；未命中且文本较短时回退 partial/regex。
     * WeakMap 缓存已处理内容，避免重复替换。
     *
     * @param {Text} textNode DOM 文本节点。
     * @returns {boolean} 发生替换时返回 true。
     */
    translateTextNode(textNode) {
      var originalText = textNode.textContent;
      if (!originalText || !originalText.trim()) {
        return false;
      }

      var cached = this.nodeCache.get(textNode);
      if (cached === originalText) {
        return false;
      }

      var normalized = normalizeForMatch(originalText);
      var newText = exactMap.get(normalized);
      var changed = newText !== undefined;

      // partial/regex 回退：仅限未命中 exact 的短文本（86 条规则，长文本跳过）
      if (!changed && originalText.length <= PARTIAL_MAX_LEN) {
        var i, rule, replaced;
        for (i = 0; i < partialRules.length; i++) {
          rule = partialRules[i];
          if (originalText.includes(rule.originalText)) {
            replaced = originalText.split(rule.originalText).join(rule.changeText);
            if (replaced !== newText) {
              newText = replaced;
              changed = true;
            }
          }
        }
        for (i = 0; i < regexRules.length; i++) {
          rule = regexRules[i];
          rule.re.lastIndex = 0;
          if (rule.re.test(originalText)) {
            replaced = originalText.replace(rule.re, rule.changeText);
            if (replaced !== newText) {
              newText = replaced;
              changed = true;
            }
          }
        }
      }

      if (changed && newText != null && newText !== originalText) {
        textNode.textContent = newText;
        this.nodeCache.set(textNode, newText);
        return true;
      }

      this.nodeCache.set(textNode, originalText);
      return false;
    }

    /**
     * TreeWalker 节点过滤器：跳过 script/style/表单控件内文本与工作区禁区。
     *
     * @returns {Object} NodeFilter 风格的过滤器。
     */
    createTextNodeFilter() {
      return {
        acceptNode: function (node) {
          var parent = node.parentElement;
          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }
          var tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest(NO_TRANSLATE_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          return node.textContent.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      };
    }

    /**
     * 遍历 root 下所有可见文本节点并翻译。
     *
     * 仅对显式传入的 root 执行；不再递归展开全页 shadowRoot（旧引擎的
     * querySelectorAll('*') 全页遍历已移除；closed shadow 内容不翻译）。
     *
     * @param {Node} rootNode 扫描根节点（Element 或 ShadowRoot）。
     * @returns {number} 被修改的文本节点数量。
     */
    translateElement(rootNode) {
      if (!rootNode) {
        return 0;
      }

      var isConnected = rootNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ? true
        : rootNode.isConnected;
      if (!isConnected) {
        return 0;
      }

      var changedCount = 0;
      var walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT,
        this.createTextNodeFilter(),
      );

      var node;
      while ((node = walker.nextNode())) {
        if (this.translateTextNode(node)) {
          changedCount++;
        }
      }

      return changedCount;
    }

    /**
     * 翻译 root 下 input / button 等元素的 placeholder、title、aria-label 属性。
     *
     * @param {Node} rootNode 扫描根节点。
     * @returns {number} 被修改的属性数量。
     */
    translateAttributes(rootNode) {
      if (!rootNode) {
        return 0;
      }

      var isConnected = rootNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ? true
        : rootNode.isConnected;
      if (!isConnected) {
        return 0;
      }

      var changedCount = 0;
      var elementRoot = rootNode.nodeType === Node.ELEMENT_NODE
        ? rootNode
        : rootNode.host;
      if (!elementRoot || !elementRoot.querySelectorAll) {
        return 0;
      }

      var elements = elementRoot.querySelectorAll(
        'input[placeholder], textarea[placeholder], input[title], button[title], button[aria-label], [aria-label]',
      );

      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var attrs = ['placeholder', 'title', 'aria-label'];

        for (var j = 0; j < attrs.length; j++) {
          var attr = attrs[j];
          if (!el.hasAttribute(attr)) {
            continue;
          }

          var originalValue = el.getAttribute(attr);
          if (!originalValue || !originalValue.trim()) {
            continue;
          }

          var cacheKey = attr + ':' + originalValue;
          var attrCache = el.__cursorZhAttrCache || (el.__cursorZhAttrCache = {});
          if (attrCache[cacheKey]) {
            continue;
          }

          var normalized = normalizeForMatch(originalValue);
          var newValue = exactMap.has(normalized) ? exactMap.get(normalized) : originalValue;
          var changed = newValue !== originalValue;

          if (changed) {
            el.setAttribute(attr, newValue);
            attrCache[cacheKey] = true;
            changedCount++;
          }
        }
      }

      return changedCount;
    }
  }

  /**
   * 收集当前页面中需要翻译的 DOM 根节点（仅初始 pass 使用）。
   *
   * @returns {Element[]} 去重后的根元素列表。
   */
  function collectRootElements() {
    var roots = [];
    var seen = new Set();

    for (var i = 0; i < ROOT_SELECTORS.length; i++) {
      var selector = ROOT_SELECTORS[i];
      var elements = document.querySelectorAll(selector);
      for (var j = 0; j < elements.length; j++) {
        var el = elements[j];
        if (!seen.has(el)) {
          seen.add(el);
          roots.push(el);
        }
      }
    }

    return roots;
  }

  /**
   * 初始全页翻译：仅在激活时执行一次，覆盖启动时已渲染的界面。
   */
  function runInitialPass() {
    if (!sharedTranslator) {
      return;
    }

    var roots = collectRootElements();
    for (var i = 0; i < roots.length; i++) {
      sharedTranslator.translateElement(roots[i]);
      sharedTranslator.translateAttributes(roots[i]);
    }

    window.__cursorZhPatch = {
      active: true,
      count: cachedMappings.length,
      mode: 'incremental',
    };
  }

  /**
   * 处理本次 mutation 记录涉及的新增/变更节点（增量核心）。
   *
   * @param {MutationRecord[]} mutations MutationObserver 回调的记录列表。
   */
  function processMutations(mutations) {
    if (!sharedTranslator) {
      return;
    }

    var seenElements = new Set();
    var seenTexts = new Set();

    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];

      if (m.type === 'characterData' && m.target) {
        sharedTranslator.translateTextNode(m.target);
        continue;
      }

      if (m.type === 'childList') {
        if (m.target && m.target.nodeType === Node.ELEMENT_NODE && !seenElements.has(m.target)) {
          seenElements.add(m.target);
        }
        for (var j = 0; j < m.addedNodes.length; j++) {
          var added = m.addedNodes[j];
          if (!added || !added.isConnected) {
            continue;
          }
          if (added.nodeType === Node.TEXT_NODE) {
            if (!seenTexts.has(added)) {
              seenTexts.add(added);
              sharedTranslator.translateTextNode(added);
            }
          } else if (added.nodeType === Node.ELEMENT_NODE && !seenElements.has(added)) {
            seenElements.add(added);
          }
        }
      }
    }

    // 变更元素级处理：先子树翻译，再属性
    seenElements.forEach(function (el) {
      if (!el.isConnected) {
        return;
      }
      sharedTranslator.translateElement(el);
      sharedTranslator.translateAttributes(el);
    });

    window.__cursorZhPatch = {
      active: true,
      count: cachedMappings.length,
      mode: 'incremental',
    };
  }

  /**
   * 监听 DOM 变更：只做门铃 + 增量处理。
   *
   * 同帧多次变更合并进一个 pendingNodes/records 批次，rAF 内消费，
   * 打字/滚动时每帧最多处理一帧内的新增节点。
   */
  function startMutationObserver() {
    if (observerStarted || typeof MutationObserver === 'undefined' || !document.body) {
      return;
    }

    observerStarted = true;
    var records = [];

    var observer = new MutationObserver(function (muts) {
      records = records.concat(muts);
      if (scheduled) {
        return;
      }
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        var batch = records;
        records = [];
        processMutations(batch);
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /** 启动入口：加载词典 → 初始 pass → 增量 observer。无任何定时器。 */
  function task() {
    try {
      if (!cachedMappings) {
        cachedMappings = '${replacementsArray}';
        sharedTranslator = new TextTranslator(cachedMappings);
      }
      runInitialPass();
      startMutationObserver();
    } catch (_error) {
      // DOM not ready
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', task);
  } else {
    task();
  }
})();

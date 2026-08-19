/**
 * 注入到 workbench 副本头部的运行时 DOM 翻译脚本。
 *
 * 由 patch-core 在 apply 阶段写入 workbench.desktop.main_translated.js 顶部；
 * 词典 JSON 在构建时内联到本文件末尾的 REPLACEMENTS 变量。
 */
(function () {
  'use strict';

  /** 强制 Shadow DOM 为 open，否则 Agent Window 等 closed shadow 内的文本无法被扫描。 */
  try {
    var originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      var options = init || {};
      if (options.mode === 'closed') {
        options = Object.assign({}, options, { mode: 'open' });
      }
      return originalAttachShadow.call(this, options);
    };
  } catch (_shadowPatchError) {
    // 忽略
  }

  var cachedMappings = null;
  var sharedTranslator = null;
  var mutationObserverStarted = false;

  /** 需要扫描并翻译的 DOM 根节点选择器。 */
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
    '.review-panel',
    '.inline-diff-review',
    '.cursor-settings-layout',
    '.full-settings-editor',
    '.workbench',
  ];

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
   * 运行时 DOM 文本翻译器。
   *
   * 按词典顺序对文本节点与部分 HTML 属性（placeholder、title、aria-label）做替换。
   */
  class TextTranslator {
    /**
     * @param {Array<{originalText: string, changeText: string, searchType: string, flags?: string}>} mappings 替换词典。
     */
    constructor(mappings) {
      this.mappings = mappings;
      this.nodeCache = new WeakMap();
    }

    /**
     * 对单段文本应用一条替换规则。
     *
     * @param {string} text 当前文本。
     * @param {{originalText: string, changeText: string, searchType: string, flags?: string}} mapping 单条规则。
     * @returns {string} 替换后的文本；未命中时返回原文。
     */
    applyMapping(text, mapping) {
      if (mapping.searchType === 'exact') {
        if (normalizeForMatch(text) === normalizeForMatch(mapping.originalText)) {
          return mapping.changeText;
        }
        return text;
      }

      if (mapping.searchType === 'partial') {
        if (text.includes(mapping.originalText)) {
          return text.split(mapping.originalText).join(mapping.changeText);
        }
        return text;
      }

      if (mapping.searchType === 'regex') {
        var regex = new RegExp(mapping.originalText, mapping.flags || 'g');
        if (regex.test(text)) {
          return text.replace(regex, mapping.changeText);
        }
      }

      return text;
    }

    /**
     * 翻译单个文本节点，命中后写回 DOM。
     *
     * 使用 WeakMap 缓存已处理内容，避免重复替换。
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

      var newText = originalText;
      var changed = false;

      for (var i = 0; i < this.mappings.length; i++) {
        var mapping = this.mappings[i];
        var replaced = this.applyMapping(newText, mapping);
        if (replaced !== newText) {
          newText = replaced;
          changed = true;
        }
      }

      if (changed && newText !== originalText) {
        textNode.textContent = newText;
        this.nodeCache.set(textNode, newText);
        return true;
      }

      this.nodeCache.set(textNode, originalText);
      return false;
    }

    /**
     * TreeWalker 节点过滤器：跳过 script/style/表单控件内文本。
     *
     * @param {Node} node 候选文本节点。
     * @returns {number} NodeFilter 常量。
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
          return node.textContent.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      };
    }

    /**
     * 遍历 root 下所有可见文本节点并翻译（含 open Shadow DOM）。
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

      var elementRoot = rootNode.nodeType === Node.ELEMENT_NODE
        ? rootNode
        : rootNode.host;
      if (elementRoot && elementRoot.querySelectorAll) {
        var hosts = elementRoot.querySelectorAll('*');
        for (var i = 0; i < hosts.length; i++) {
          var host = hosts[i];
          if (host.shadowRoot) {
            changedCount += this.translateElement(host.shadowRoot);
          }
        }
      }

      return changedCount;
    }

    /**
     * 翻译 input / button 等元素的 placeholder、title、aria-label 属性（含 Shadow DOM）。
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

          var newValue = originalValue;
          var changed = false;

          for (var k = 0; k < this.mappings.length; k++) {
            var mapping = this.mappings[k];
            var replaced = this.applyMapping(newValue, mapping);
            if (replaced !== newValue) {
              newValue = replaced;
              changed = true;
            }
          }

          if (changed && newValue !== originalValue) {
            el.setAttribute(attr, newValue);
            attrCache[cacheKey] = true;
            changedCount++;
          }
        }

        if (el.shadowRoot) {
          changedCount += this.translateAttributes(el.shadowRoot);
        }
      }

      return changedCount;
    }
  }

  /**
   * 收集当前页面中需要翻译的 DOM 根节点。
   *
   * 始终包含 document.body，避免 Agent Window 等 UI 落在 selector 之外。
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

    if (document.body && !seen.has(document.body)) {
      roots.push(document.body);
    }

    return roots;
  }

  /**
   * 执行一轮 DOM 翻译。
   */
  function runTranslationPass() {
    if (!cachedMappings) {
      return;
    }

    if (!sharedTranslator) {
      sharedTranslator = new TextTranslator(cachedMappings);
    }

    var roots = collectRootElements();
    for (var i = 0; i < roots.length; i++) {
      sharedTranslator.translateElement(roots[i]);
      sharedTranslator.translateAttributes(roots[i]);
    }

    window.__cursorZhPatch = {
      active: true,
      count: cachedMappings.length,
    };
  }

  /**
   * 监听 DOM 变更，React 重渲染后立即补译。
   */
  function startMutationObserver() {
    if (mutationObserverStarted || typeof MutationObserver === 'undefined' || !document.body) {
      return;
    }

    mutationObserverStarted = true;
    var scheduled = false;
    var observer = new MutationObserver(function () {
      if (scheduled) {
        return;
      }
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        runTranslationPass();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /**
   * 定时扫描并翻译界面文本。
   *
   * 每 100ms 执行一次，以覆盖 Settings、Agent Window 等动态渲染内容。
   */
  function task() {
    try {
      if (!cachedMappings) {
        cachedMappings = '${replacementsArray}';
      }
      runTranslationPass();
      startMutationObserver();
    } catch (_error) {
      // DOM not ready
    }

    setTimeout(task, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', task);
  } else {
    task();
  }
})();

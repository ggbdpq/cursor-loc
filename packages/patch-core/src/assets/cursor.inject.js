/**
 * 注入到 workbench 副本头部的运行时 DOM 翻译脚本。
 *
 * 由 patch-core 在 apply 阶段写入 workbench.desktop.main_translated.js 顶部；
 * 词典 JSON 在构建时内联到本文件末尾的 REPLACEMENTS 变量。
 */
(function () {
  'use strict';

  /** 需要扫描并翻译的 DOM 根节点选择器。 */
  var ROOT_SELECTORS = [
    '.monaco-dialog-box',
    '.monaco-dialog',
    '.monaco-modal-dialog',
    '[role="dialog"]',
    '.dialog-message',
    '.cursor-settings-layout-main',
    '.settings-editor',
    '[data-component="agent-panel"]',
    '[data-component="composer"]',
    '.composer-bar',
    '.composer-input-blur-wrapper',
    '.agent-layout',
    '.review-panel',
    '.inline-diff-review',
    '.cursor-settings-layout',
    '.full-settings-editor',
    '.workbench',
  ];

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
        if (text.trim() === mapping.originalText) {
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
     * 遍历 root 下所有可见文本节点并翻译。
     *
     * 跳过 script、style、textarea、input 内的文本。
     *
     * @param {Element} rootElement 扫描根元素。
     * @returns {number} 被修改的文本节点数量。
     */
    translateElement(rootElement) {
      if (!rootElement || !rootElement.isConnected) {
        return 0;
      }

      var walker = document.createTreeWalker(
        rootElement,
        NodeFilter.SHOW_TEXT,
        {
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
        },
      );

      var changedCount = 0;
      var node;
      while ((node = walker.nextNode())) {
        if (this.translateTextNode(node)) {
          changedCount++;
        }
      }

      return changedCount;
    }

    /**
     * 翻译 input / button 等元素的 placeholder、title、aria-label 属性。
     *
     * @param {Element} rootElement 扫描根元素。
     * @returns {number} 被修改的属性数量。
     */
    translateAttributes(rootElement) {
      if (!rootElement || !rootElement.isConnected) {
        return 0;
      }

      var changedCount = 0;
      var elements = rootElement.querySelectorAll(
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
      }

      return changedCount;
    }
  }

  /**
   * 收集当前页面中需要翻译的 DOM 根节点。
   *
   * 若未命中任何 selector，则回退到 document.body。
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

    if (roots.length === 0 && document.body) {
      roots.push(document.body);
    }

    return roots;
  }

  /**
   * 定时扫描并翻译界面文本。
   *
   * 每 100ms 执行一次，以覆盖 Settings 等动态渲染内容。
   */
  function task() {
    try {
      var translationMappings = '${replacementsArray}';
      var translator = new TextTranslator(translationMappings);
      var roots = collectRootElements();

      for (var i = 0; i < roots.length; i++) {
        translator.translateElement(roots[i]);
        translator.translateAttributes(roots[i]);
      }
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

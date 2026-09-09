/**
 * 注入到 workbench 副本头部的运行时 DOM 翻译脚本（0.0.11 热路径止血版）。
 *
 * 由 patch-core 在 apply 阶段写入 workbench.desktop.main_translated.js 顶部；
 * 词典 JSON 在构建时内联到本文件末尾的 REPLACEMENTS 变量。
 *
 * 0.0.9 已移除旧引擎（≤0.0.8）的三个卡顿根源：100ms 定时轮询、attachShadow
 * 原型劫持、每次变更全页 TreeWalker。但 0.0.9/0.0.10 实测滚动与输入仍有卡顿，
 * 剩余根因（0.0.11 逐一修复）：
 *
 * 1. characterData 与新增文本节点直接调 translateTextNode，绕开了
 *    TreeWalker 过滤器里的禁区检查——Monaco .view-lines 打字产生的每次
 *    字符变更都跑完整匹配流程。0.0.11 所有 mutation 入口统一先过
 *    shouldSkipNode 禁区判断。
 * 2. childList 把变更父容器 m.target 加入重扫集合，往大容器加 1 个节点
 *    会重扫整个子树。0.0.11 只处理 addedNodes。
 * 3. rAF 在绘制前同步执行翻译，与 Monaco layout / React render 抢帧预算
 *    （60 FPS 每帧仅约 16.7ms）。0.0.11 改为 requestIdleCallback 低优先级
 *    分片队列，单批 JS 执行 ≤3ms，汉化宁可晚几十毫秒出现也让输入滚动优先。
 * 4. observer 挂 document.body 且 characterData: true，整个 renderer 的
 *    mutation（含 Monaco/Explorer/Terminal 的打字与虚拟滚动）都产生记录并
 *    进入 JS 回调。0.0.11 拆成两级：L0 门铃挂 body 但只开 childList（打字
 *    记录从源头消失），专职发现汉化区域容器；L1 只监听发现的汉化区域
 *    （childList + characterData），Monaco 等热点区零记录零处理。
 *
 * 保留 0.0.9 的词典索引：exact 词条进 Map O(1) 查找；partial/regex（86 条）
 * 仅对未命中 exact 且 ≤200 字符的节点回退。WeakMap 缓存已处理内容。
 */
(function () {
  'use strict';

  var cachedMappings = null;
  var exactMap = null;        // normalizedText -> changeText
  var partialRules = [];      // 短语级 partial 规则
  var regexRules = [];        // regex 规则
  var sharedTranslator = null;

  var rootObserverStarted = false;
  var zoneObserver = null;    // L1：共享实例，observe 各汉化区域容器
  var observedZones = null;   // WeakSet<Element>，已注册容器（幂等 + 可回收）

  var pendingQueue = new Set();     // 待翻译节点（Set 保插入序 + 去重）
  var processingScheduled = false;
  var idleChannel = null;           // requestIdleCallback 不可用时的降级通道

  /** 单批翻译 JS 执行预算（ms）：超时让出主线程，剩余任务下一空闲片继续。 */
  var BATCH_BUDGET_MS = 3;
  /** idle 调度兜底截止：任务最多延迟这么久，避免长期繁忙时汉化饿死。 */
  var IDLE_TIMEOUT_MS = 300;

  /**
   * 汉化区域选择器：增量 MutationObserver 只监听这些容器（0.0.11 缩圈）。
   * Monaco / Explorer / Terminal 等工作区热点天然不在列，打字与虚拟滚动的
   * mutation 记录从源头消失；不在区域内的动态 UI 由初始 pass 兜底 +
   * Microsoft 语言包（NLS）覆盖。
   */
  var ZONE_SELECTORS = [
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
  ];

  /** 初始 pass 扫描根：区域选择器 + .workbench 整页兜底（仅启动时跑一次）。 */
  var ROOT_SELECTORS = ZONE_SELECTORS.concat(['.workbench']);

  /** 增量监听范围（L0 发现 + L1 注册用）。 */
  var ZONE_SELECTOR = ZONE_SELECTORS.join(', ');

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

  /** 属性翻译目标选择器。 */
  var ATTR_SELECTOR = 'input[placeholder], textarea[placeholder], input[title], button[title], button[aria-label], [aria-label]';

  /** partial 回退的文本长度上限：超过视为长文本（正文/代码片段），跳过 86 条模糊规则。 */
  var PARTIAL_MAX_LEN = 200;

  /**
   * 统一禁区判断：mutation 与翻译的每个入口第一行都调用。
   *
   * 0.0.9 里只有 TreeWalker 过滤器做禁区检查，characterData 直调
   * translateTextNode 绕开了它，Monaco 打字因此进入完整匹配流程。
   *
   * @param {Node} node 文本节点或元素。
   * @returns {boolean} true 表示位于禁区，必须跳过。
   */
  function shouldSkipNode(node) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

    if (!el || !el.closest) {
      return false;
    }

    return !!el.closest(NO_TRANSLATE_SELECTOR);
  }

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
     * 仅对显式传入的 root 执行；root 位于工作区禁区时直接短路，不做遍历。
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

      if (rootNode.nodeType === Node.ELEMENT_NODE
        && rootNode.closest
        && rootNode.closest(NO_TRANSLATE_SELECTOR)) {
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
     * 翻译 root（含 root 自身）下 input / button 等元素的 placeholder、title、
     * aria-label 属性。
     *
     * querySelectorAll 不含 root 自身，而 0.0.11 起 childList 不再重扫父容器，
     * 新增元素若自身就是可翻译控件（如带 placeholder 的 input），只能在这里补上。
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

      var selfList = elementRoot.matches && elementRoot.matches(ATTR_SELECTOR)
        ? [elementRoot]
        : [];
      var descendants = elementRoot.querySelectorAll(ATTR_SELECTOR);
      var elements = selfList.concat(Array.prototype.slice.call(descendants));

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
   * 把节点加入待翻译队列并请求一次 idle 调度。
   *
   * 入口统一过禁区：Monaco/Explorer/Terminal 等热点区节点在这里被
   * 一次 closest 拦下，不产生任何翻译任务。
   *
   * @param {Node} node 文本节点或元素。
   */
  function enqueueNode(node) {
    if (!node || !node.isConnected || shouldSkipNode(node)) {
      return;
    }

    pendingQueue.add(node);
    scheduleProcessing();
  }

  /**
   * 请求一次低优先级处理：requestIdleCallback 空闲片执行，不可用时降级为
   * MessageChannel 宏任务（一次性调度，非定时器轮询）。
   */
  function scheduleProcessing() {
    if (processingScheduled) {
      return;
    }
    processingScheduled = true;

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(processQueue, { timeout: IDLE_TIMEOUT_MS });
      return;
    }

    if (!idleChannel) {
      idleChannel = new MessageChannel();
      idleChannel.port1.onmessage = function () {
        processQueue(null);
      };
    }
    idleChannel.port2.postMessage(0);
  }

  /**
   * idle 分片消费翻译队列：单批 JS 执行 ≤3ms，超预算让出主线程。
   *
   * 汉化可能晚几十毫秒出现，但输入与滚动的关键帧永远优先。
   *
   * @param {IdleDeadline|null} deadline requestIdleCallback 提供的空闲期限；
   *   MessageChannel 降级时为 null，仅按 BATCH_BUDGET_MS 分片。
   */
  function processQueue(deadline) {
    processingScheduled = false;

    if (!sharedTranslator) {
      pendingQueue.clear();
      return;
    }

    var start = performance.now();
    var hasDeadline = deadline && typeof deadline.timeRemaining === 'function';

    while (pendingQueue.size > 0) {
      if (performance.now() - start >= BATCH_BUDGET_MS
        || (hasDeadline && deadline.timeRemaining() < 1)) {
        scheduleProcessing();
        return;
      }

      var node = pendingQueue.values().next().value;
      pendingQueue.delete(node);

      if (!node.isConnected) {
        continue;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        sharedTranslator.translateElement(node);
        sharedTranslator.translateAttributes(node);
      } else if (node.nodeType === Node.TEXT_NODE) {
        sharedTranslator.translateTextNode(node);
      }
    }

    window.__cursorZhPatch = {
      active: true,
      count: cachedMappings.length,
      mode: 'incremental',
    };
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
   * 只做入队，真正的翻译统一在 idle 分片里消费。childList 只处理
   * addedNodes——不重扫变更父容器 m.target，往大容器加 1 个节点只处理
   * 那 1 个节点。
   *
   * @param {MutationRecord[]} mutations L1 observer 回调的记录列表。
   */
  function processMutations(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];

      if (m.type === 'characterData') {
        if (m.target) {
          enqueueNode(m.target);
        }
        continue;
      }

      if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var added = m.addedNodes[j];
          if (added
            && (added.nodeType === Node.TEXT_NODE || added.nodeType === Node.ELEMENT_NODE)) {
            enqueueNode(added);
          }
        }
      }
    }
  }

  /**
   * 注册一个汉化区域容器的 L1 增量监听（childList + characterData）。
   *
   * 共享 zoneObserver 实例 observe 各容器，WeakSet 保证幂等；容器断连后
   * observer 自动失效，WeakSet 不阻止回收。
   *
   * @param {Element} zoneEl 汉化区域容器。
   * @param {boolean} translateExisting 是否把容器存量内容入队翻译
   *   （动态新发现的容器需要；初始注册的容器已由初始 pass 覆盖）。
   */
  function attachZoneObserver(zoneEl, translateExisting) {
    if (!zoneEl || !zoneEl.isConnected || observedZones.has(zoneEl)) {
      return;
    }

    observedZones.add(zoneEl);
    zoneObserver.observe(zoneEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    if (translateExisting) {
      enqueueNode(zoneEl);
    }
  }

  /**
   * L0 门铃回调：只做禁区短路 + 汉化区域发现，不做任何翻译。
   *
   * Monaco / Explorer / Terminal 等热点区的新增节点（虚拟滚动重建的行等）
   * 在 shouldSkipNode 处一次 closest 即返回，不产生翻译任务。
   *
   * @param {MutationRecord[]} mutations L0 门铃记录列表。
   */
  function rootMutationCallback(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var addedNodes = mutations[i].addedNodes;

      for (var j = 0; j < addedNodes.length; j++) {
        var added = addedNodes[j];
        if (!added
          || added.nodeType !== Node.ELEMENT_NODE
          || shouldSkipNode(added)) {
          continue;
        }
        discoverZones(added);
      }
    }
  }

  /**
   * 发现新增元素自身、祖先或子树中的汉化区域容器并注册 L1 监听；
   * 新发现的容器把存量内容入队翻译。
   *
   * @param {Element} el 新挂载的元素。
   */
  function discoverZones(el) {
    var host = el.closest ? el.closest(ZONE_SELECTOR) : null;
    if (host) {
      attachZoneObserver(host, true);
    }

    if (el.querySelectorAll) {
      var inner = el.querySelectorAll(ZONE_SELECTOR);
      for (var i = 0; i < inner.length; i++) {
        attachZoneObserver(inner[i], true);
      }
    }
  }

  /**
   * 启动两级 observer：
   *
   * L1（翻译层）：监听启动时已存在的汉化区域容器——存量内容由初始 pass
   * 覆盖，这里只补监听后续动态变更；
   *
   * L0（发现层）：body 上只开 childList 门铃。刻意不开 characterData——
   * Monaco 打字等文本编辑的 mutation 记录从源头消失，不再进入任何 JS 回调；
   * 回调专职发现新挂载的汉化区域容器。
   */
  function startMutationObservers() {
    if (rootObserverStarted || typeof MutationObserver === 'undefined' || !document.body) {
      return;
    }

    rootObserverStarted = true;
    observedZones = new WeakSet();
    zoneObserver = new MutationObserver(function (muts) {
      processMutations(muts);
    });

    var initialZones = document.querySelectorAll(ZONE_SELECTOR);
    for (var i = 0; i < initialZones.length; i++) {
      attachZoneObserver(initialZones[i], false);
    }

    var rootObserver = new MutationObserver(rootMutationCallback);
    rootObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /** 启动入口：加载词典 → 初始 pass → 两级 observer。无任何定时器。 */
  function task() {
    try {
      if (!cachedMappings) {
        cachedMappings = '${replacementsArray}';
        sharedTranslator = new TextTranslator(cachedMappings);
      }
      runInitialPass();
      startMutationObservers();
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

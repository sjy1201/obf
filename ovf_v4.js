(function () {
  "use strict";

  // V4 NEW：调试开关及焦点历史有效期
  const DEBUG_V4 = true;
  const FOCUS_HISTORY_MS = 600;

  let debugSequence = 0;
  let lastFrameFocus = null;

  const ADM_NETWORK_ID = ["/23054585162/", "/23352693424/", "/23199949507/"];

  const dataLayer = (window.dataLayer = window.dataLayer || []);

  window.onlyPageEngine = false;
  window.onlyPageStatistics = false;
  window.onlyOne = false;
  window.onlyReportOne = false;
  window.i_like_it = 0;
  window.view_CC_num = false;
  window.click_CC_type = false;

  let isLinkClick = false;
  let lastTrustedLink = null;

  const BLUR_CONFIRM_MS = 1500;

  let pendingAdBlur = null;
  let pendingAdBlurTimer = null;

  // ==========================================
  // Blur 候选事件管理
  // ==========================================

  const cancelPendingAdBlur = (reason = "cancel") => {
    // V4 NEW：记录候选事件清除原因
    if (pendingAdBlur) {
      debugLog("PENDING_CLEAR", {
        reason,
      });
    }

    if (pendingAdBlurTimer !== null) {
      clearTimeout(pendingAdBlurTimer);
      pendingAdBlurTimer = null;
    }

    pendingAdBlur = null;
  };

  const markPendingAdBlur = (eventName) => {
    cancelPendingAdBlur("replace");

    pendingAdBlur = {
      eventName,
      timestamp: performance.now(),
    };

    pendingAdBlurTimer = setTimeout(() => {
      // V4 NEW：记录候选事件超时
      debugLog("PENDING_EXPIRED");

      pendingAdBlur = null;
      pendingAdBlurTimer = null;
    }, BLUR_CONFIRM_MS);

    // V4 NEW：记录候选事件开始计时
    debugLog("PENDING_START", {
      eventName,
      timeoutMs: BLUR_CONFIRM_MS,
    });
  };

  const confirmPendingAdBlur = (source) => {
    // V4 NEW：记录候选事件确认来源
    if (!pendingAdBlur) {
      debugLog("PENDING_EMPTY", {
        source,
      });

      return;
    }

    const { eventName, timestamp } = pendingAdBlur;

    const elapsedMs = performance.now() - timestamp;

    const withinTime = elapsedMs <= BLUR_CONFIRM_MS;

    // V4 NEW：记录时间窗口判断结果
    debugLog("PENDING_CHECK", {
      source,
      eventName,
      elapsedMs,
      withinTime,
    });

    cancelPendingAdBlur(withinTime ? "confirmed" : "expired");

    if (withinTime) {
      pushEvent(eventName);
    }
  };

  // ==========================================
  // 统一事件上报
  // ==========================================

  const pushEvent = (event, details) => {
    const counterKey =
      event === "siteAnchoringAD"
        ? "ax_times"
        : event === "sitePageAD"
          ? "nx_times"
          : null;

    if (counterKey) {
      try {
        localStorage.setItem(
          counterKey,
          (Number(localStorage.getItem(counterKey)) || 0) + 1,
        );
      } catch (error) {
        // localStorage 不可用时仍继续上报
      }
    }

    // V4 NEW：保留原有 dataLayer 上报结构
    const payload = {
      event,
      ...(details || {}),
    };

    dataLayer.push(payload);

    // V4 NEW：所有原有上报事件统一输出 Console
    debugLog("PUSH", {
      payload,
    });
  };

  // ==========================================
  // 原有公共方法
  // ==========================================

  const getActiveElement = () => document.activeElement || null;

  const getAttribute = (element, name) =>
    element && typeof element.getAttribute === "function"
      ? element.getAttribute(name)
      : null;

  const getClassName = (element) => {
    if (!element) return "";

    if (typeof element.className === "string") {
      return element.className;
    }

    return getAttribute(element, "class") || "";
  };

  // ==========================================
  // AdSense 广告类型识别
  // ==========================================

  const getAdsenseTypeByIns = (ins) => {
    if (!ins || ins.tagName !== "INS") {
      return null;
    }

    const attributes = ins
      .getAttributeNames()
      .map((name) => name.toLowerCase());

    const hasKeyword = (keyword) =>
      attributes.some((name) => name.includes(keyword));

    if (hasKeyword("anchor")) {
      return "anchor";
    }

    if (hasKeyword("vignette")) {
      return "vignette";
    }

    if (hasKeyword("rewarded")) {
      return "reward";
    }

    if (hasKeyword("ad-slot")) {
      return "page";
    }

    return null;
  };

  // ==========================================
  // ADM 广告识别
  // ==========================================

  const isAdmElement = (id) =>
    typeof id === "string" &&
    ADM_NETWORK_ID.some((networkId) => id.includes(networkId));

  const findParentIns = (element) =>
    element && typeof element.closest === "function"
      ? element.closest("ins")
      : null;

  // ==========================================
  // V4 NEW：当前元素身份快照
  // 仅用于诊断，不改变原有广告判定
  // ==========================================

  function snapshotElement(el = getActiveElement()) {
    if (!el) return null;

    const id = getAttribute(el, "id") || "";

    const ins = el.tagName === "IFRAME" ? findParentIns(el) : null;

    let platform = null;
    let format = null;

    if (isAdmElement(id)) {
      platform = "adm";

      if (id.includes("anchor")) {
        format = "anchor";
      } else if (id.includes("reward")) {
        format = "reward";
      } else if (id.includes("vignette") || id.includes("interstitial")) {
        format = "vignette";
      } else {
        format = "page";
      }
    } else if (ins) {
      format = getAdsenseTypeByIns(ins);

      if (format) {
        platform = "adsense";
      }
    }

    return {
      tag: el.tagName,
      id,
      platform,
      format,
      insId: getAttribute(ins, "id"),
      adStatus: getAttribute(ins, "data-ad-status"),
      loadComplete: getAttribute(el, "data-load-complete"),
    };
  }

  // ==========================================
  // V4 NEW：统一 Console 调试日志
  // 所有诊断信息均不进入 dataLayer
  // ==========================================

  function debugLog(stage, details = {}) {
    if (!DEBUG_V4) return;

    try {
      const t = performance.now();

      const age = lastFrameFocus ? t - lastFrameFocus.at : null;

      const logData = {
        // 日志执行顺序
        seq: ++debugSequence,

        // 日志阶段
        stage,

        // 当前时间
        timestamp: new Date().toISOString(),

        // 页面运行时间
        timeMs: Math.round(t),

        // 页面当前路径
        pathname: window.location.pathname,

        // 页面当前可见状态
        visibility: document.visibilityState,

        // 当前文档焦点状态
        hasFocus: document.hasFocus(),

        // 当前焦点元素及广告类型
        active: snapshotElement(),

        // 最近 600ms 内观察到的广告 iframe
        recentFocus:
          age !== null && age <= FOCUS_HISTORY_MS
            ? {
                ...lastFrameFocus.frame,
                source: lastFrameFocus.source,
                ageMs: Math.round(age),
              }
            : null,

        // 当前等待确认的 blur 候选事件
        pending: pendingAdBlur
          ? {
              event: pendingAdBlur.eventName,
              ageMs: Math.round(t - pendingAdBlur.timestamp),
            }
          : null,

        // 原有业务状态
        i_like_it: window.i_like_it,
        view_CC_num: window.view_CC_num,
        click_CC_type: window.click_CC_type,
        onlyPageStatistics: window.onlyPageStatistics,
        onlyOne: window.onlyOne,
        isLinkClick,

        ...details,
      };

      // V4 NEW：将日志立即序列化为 JSON 字符串
      // 避免页面跳转后无法展开 Console 对象
      console.log(
        "[OBF V4] " + stage + "\n" + JSON.stringify(logData, null, 2),
      );
    } catch (error) {
      // 调试异常不影响原有业务逻辑
      console.warn("[OBF V4] DEBUG_ERROR", String(error));
    }
  }

  // ==========================================
  // V4 NEW：保存最近的广告 iframe 焦点快照
  // 用于分析首次点击穿插后 activeElement 变成 BODY
  // 仅用于诊断，不参与原有事件上报
  // ==========================================

  function rememberFrameFocus(source, el) {
    if (!DEBUG_V4 || !el || el.tagName !== "IFRAME") {
      return;
    }

    try {
      const frame = snapshotElement(el);

      if (!frame || !frame.platform) {
        return;
      }

      lastFrameFocus = {
        at: performance.now(),
        source,
        frame,
      };

      debugLog("FOCUS_SNAPSHOT", {
        source,
        frame,
      });
    } catch (error) {
      // 诊断异常不影响原有业务
    }
  }

  // ==========================================
  // 穿插广告展示检测
  // 保留 V3 原有逻辑
  // ==========================================

  function watchFullscreenAds() {
    const observedElements = new WeakMap();
    const discoveredIns = new WeakSet();

    const reportedTypes = {
      adsense: false,
      adm: false,
    };

    const getVignettePlatform = (ins) => {
      if (!ins || ins.tagName !== "INS") {
        return null;
      }

      const id = ins.getAttribute("id") || "";

      if (isAdmElement(id)) {
        return id.toLowerCase().includes("vignette") ? "adm" : null;
      }

      const isVignette = ins
        .getAttributeNames()
        .some((name) => name.toLowerCase().includes("vignette"));

      return isVignette ? "adsense" : null;
    };

    const checkVignette = (ins) => {
      let state = observedElements.get(ins);

      const platform = state?.platform || getVignettePlatform(ins);

      if (!platform) return;

      const display = window.getComputedStyle(ins).display;

      if (!state) {
        observedElements.set(ins, {
          platform,
          display,
          shown: false,
          trigger: null,
        });

        // V4 NEW：记录穿插初始状态
        debugLog("VIGNETTE_INIT", {
          platform,
          display,
          insId: ins.id,
        });

        return;
      }

      const previousDisplay = state.display;

      state.display = display;

      // V4 NEW：只记录 display 实际发生变化的情况
      if (previousDisplay !== display) {
        debugLog("VIGNETTE_DISPLAY_CHANGE", {
          platform,
          previousDisplay,
          display,
          trigger: state.trigger,
          insId: ins.id,
        });
      }

      // ======================================
      // 穿插展示：none -> 非 none
      // ======================================

      if (previousDisplay === "none" && display !== "none") {
        state.shown = true;

        state.trigger = isLinkClick ? "link" : "tab";

        window.i_like_it = 1;

        // V4 NEW：记录穿插展示及触发类型
        debugLog("VIGNETTE_SHOW", {
          platform,
          trigger: state.trigger,
        });

        if (reportedTypes[platform]) {
          // V4 NEW：记录去重原因
          debugLog("VIGNETTE_SHOW_SKIPPED", {
            platform,
            reason: "already_reported",
          });

          return;
        }

        reportedTypes[platform] = true;

        pushEvent("adsChange");

        if (platform === "adm") {
          pushEvent("sw_cc");
        } else {
          pushEvent("sw_ads_cc");
        }

        if (isLinkClick) {
          pushEvent("clickAdsChange");
        }

        return;
      }

      // ======================================
      // Tab 穿插隐藏：非 none -> none
      // ======================================

      if (
        previousDisplay !== "none" &&
        display === "none" &&
        state.shown &&
        state.trigger === "tab"
      ) {
        state.shown = false;

        window.i_like_it = 0;

        // V4 NEW：记录 Tab 穿插隐藏后的状态清零
        // DOM 隐藏本身不代表已确认点击 X
        debugLog("VIGNETTE_TAB_RESET", {
          platform,
        });
      }
    };

    // 单独监听 INS 元素的属性变化
    const insObserver = new MutationObserver((mutations) => {
      const targets = new Set();

      for (const mutation of mutations) {
        const ins = mutation.target;

        const attr = mutation.attributeName || "";

        if (observedElements.has(ins)) {
          if (attr === "style" || attr === "class" || attr === "hidden") {
            targets.add(ins);
          }
        } else {
          if (attr === "id" || attr.toLowerCase().includes("vignette")) {
            targets.add(ins);
          }
        }
      }

      targets.forEach(checkVignette);
    });

    const discoverIns = (ins) => {
      if (!ins || ins.tagName !== "INS") {
        return;
      }

      if (discoveredIns.has(ins)) {
        return;
      }

      discoveredIns.add(ins);

      checkVignette(ins);

      insObserver.observe(ins, {
        attributes: true,
      });
    };

    const discoverSubtree = (node) => {
      if (!node || node.nodeType !== 1) {
        return;
      }

      if (node.tagName === "INS") {
        discoverIns(node);
      }

      node.querySelectorAll?.("ins").forEach(discoverIns);
    };

    // 全局观察器只负责发现新增元素
    const rootObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(discoverSubtree);
      }
    });

    document.querySelectorAll("ins").forEach(discoverIns);

    rootObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // ==========================================
  // AdSense 锚定广告展示检测
  // 保留 V3 原有逻辑
  // ==========================================

  function watchAdsMD() {
    let reported = false;

    const reportWhenFound = () => {
      if (reported) return;

      const adsenseAnchor = Array.from(
        document.querySelectorAll("ins[data-anchor-shown]"),
      ).find((ins) => {
        const id = ins.getAttribute("id") || "";

        if (isAdmElement(id)) {
          return false;
        }

        return getAdsenseTypeByIns(ins) === "anchor";
      });

      if (!adsenseAnchor) return;

      reported = true;

      pushEvent("sw_ads_md");

      observer.disconnect();
    };

    const observer = new MutationObserver(reportWhenFound);

    observer.observe(document.documentElement, {
      childList: true,
      attributes: true,
      attributeFilter: ["data-anchor-shown"],
      subtree: true,
    });

    reportWhenFound();
  }

  // ==========================================
  // AdSense 页内广告填充检测
  // 保留 V3 原有逻辑
  // ==========================================

  function watchAdsYN() {
    const processedAds = new WeakSet();

    const scan = () => {
      document.querySelectorAll("ins[data-ad-slot]").forEach((ins) => {
        if (processedAds.has(ins)) {
          return;
        }

        const statusObserver = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (
              mutation.attributeName === "data-ad-status" &&
              ins.getAttribute("data-ad-status") === "filled"
            ) {
              pushEvent("sw_ads_yn");
            }
          });
        });

        statusObserver.observe(ins, {
          attributes: true,
          attributeFilter: ["data-ad-status"],
        });

        processedAds.add(ins);
      });
    };

    scan();

    const observer = new MutationObserver(scan);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ==========================================
  // 搜索引擎点击检测
  // ==========================================

  function reportSearchEngineClick(activeElement, suffix) {
    let parentElement = activeElement && activeElement.parentElement;

    while (parentElement) {
      const id = getAttribute(parentElement, "id");

      if (!window.onlyPageEngine && id === "searchEngine") {
        pushEvent(`goClickEngine${suffix}`);

        window.onlyPageEngine = true;

        break;
      }

      parentElement = parentElement.parentElement;
    }
  }

  // ==========================================
  // Now：当前页面卸载时广告类型判断
  // 保留 V3 原有逻辑
  // ==========================================

  const analyzeNowSource = () => {
    // V4 NEW：记录 Now 函数入口
    debugLog("ANALYZE_NOW_START");

    const activeElement = getActiveElement();

    if (!activeElement) return;

    const id = getAttribute(activeElement, "id");

    let eventToPush = null;

    // ======================================
    // ADM
    // ======================================

    if (isAdmElement(id)) {
      if (id.includes("anchor")) {
        eventToPush = "siteAnchoringADNow";
      } else if (id.includes("preroll_reward") || id.includes("reward")) {
        eventToPush = "siteRewardADNow";
      } else if (id.includes("interstitial") || id.includes("vignette")) {
        if (window.i_like_it === 1 && window.view_CC_num) {
          eventToPush = "justdoitnow";
        }
      } else if (getAttribute(activeElement, "data-load-complete")) {
        eventToPush = "sitePageADNow";
      }
    }

    // ======================================
    // AdSense
    // ======================================
    else {
      const parentIns =
        activeElement.tagName === "IFRAME"
          ? findParentIns(activeElement)
          : null;

      if (parentIns) {
        const adsenseType = getAdsenseTypeByIns(parentIns);

        if (adsenseType) {
          const adStatus =
            getAttribute(parentIns, "data-ad-status") || "unfilled";

          // 锚定
          if (adsenseType === "anchor") {
            eventToPush = "siteAnchoringADNow";
          }

          // 激励
          else if (adsenseType === "reward") {
            if (adStatus === "filled") {
              eventToPush = "siteRewardADNow";
            }
          }

          // 穿插
          else if (adsenseType === "vignette") {
            if (window.i_like_it === 1) {
              eventToPush = "justdoitnow";
            }
          }

          // 页内
          else if (adsenseType === "page") {
            if (adStatus === "filled") {
              eventToPush = "sitePageADNow";
            }
          }
        }
      }
    }

    const className = getClassName(activeElement);

    if (className.includes("gs-") || className.includes("adpub-drawer-root")) {
      eventToPush = "clickIdentNow";
    }

    if (eventToPush) {
      window.onlyPageStatistics = true;

      pushEvent(eventToPush);
    }

    // V4 NEW：记录 Now 最终判断结果
    // eventToPush 为 null 代表没有命中上报条件
    debugLog("ANALYZE_NOW_RESULT", {
      eventToPush,
    });

    reportSearchEngineClick(activeElement, "Now");
  };

  // ==========================================
  // New：页面隐藏时广告类型判断
  // 保留 V3 原有逻辑
  // ==========================================

  const analyzeNewSource = () => {
    // V4 NEW：记录 New 函数入口
    debugLog("ANALYZE_NEW_START");

    const activeElement = getActiveElement();

    if (!activeElement) return;

    const id = getAttribute(activeElement, "id");

    let eventToPush = null;

    // ======================================
    // ADM
    // ======================================

    if (isAdmElement(id)) {
      if (id.includes("anchor")) {
        eventToPush = "siteAnchoringADNew";
      } else if (id.includes("preroll_reward") || id.includes("reward")) {
        eventToPush = "siteRewardADNew";
      } else if (id.includes("interstitial") || id.includes("vignette")) {
        if (
          window.i_like_it === 1 &&
          !window.click_CC_type &&
          window.view_CC_num
        ) {
          window.click_CC_type = true;

          eventToPush = "justdoitnew";

          pushEvent(isLinkClick ? "justdoitnew-link" : "justdoitnew-type");
        }
      } else if (getAttribute(activeElement, "data-load-complete")) {
        eventToPush = "sitePageADNew";
      }
    }

    // ======================================
    // AdSense
    // ======================================
    else {
      const parentIns =
        activeElement.tagName === "IFRAME"
          ? findParentIns(activeElement)
          : null;

      if (parentIns) {
        const adsenseType = getAdsenseTypeByIns(parentIns);

        if (adsenseType) {
          const adStatus =
            getAttribute(parentIns, "data-ad-status") || "unfilled";

          // 锚定
          if (adsenseType === "anchor") {
            eventToPush = "siteAnchoringADNew";
          }

          // 激励
          else if (adsenseType === "reward") {
            if (adStatus === "filled") {
              eventToPush = "siteRewardADNew";
            }
          }

          // 穿插
          else if (adsenseType === "vignette") {
            if (window.i_like_it === 1 && !window.click_CC_type) {
              window.click_CC_type = true;

              eventToPush = "justdoitnew";

              pushEvent(isLinkClick ? "justdoitnew-link" : "justdoitnew-type");
            }
          }

          // 页内
          else if (adsenseType === "page") {
            if (adStatus === "filled") {
              eventToPush = "sitePageADNew";
            }
          }
        }
      }
    }

    const className = getClassName(activeElement);

    if (className.includes("gs-") || className.includes("adpub-drawer-root")) {
      eventToPush = "clickIdentNew";
    }

    if (eventToPush) {
      pushEvent(eventToPush);
    }

    // V4 NEW：记录 New 最终判断结果
    // eventToPush 为 null 代表没有命中上报条件
    debugLog("ANALYZE_NEW_RESULT", {
      eventToPush,
    });

    reportSearchEngineClick(activeElement, "New");
  };

  // ==========================================
  // 搜索广告 Message 监听
  // 保留 V3 原有逻辑
  // ==========================================

  window.addEventListener("message", (event) => {
    if (
      typeof event.origin === "string" &&
      event.origin.includes("https://syndicatedsearch") &&
      typeof event.data === "string" &&
      event.data.includes("FSXDC,.aCS") &&
      !window.onlyReportOne
    ) {
      const activeElement = getActiveElement();

      const parentId = getAttribute(
        activeElement && activeElement.parentElement,
        "id",
      );

      if (parentId) {
        const boxId = parentId.toLowerCase();

        window.onlyReportOne = true;

        if (boxId.includes("fscontainer")) {
          pushEvent("site_click_s");
        }

        if (boxId.includes("elatedsearches")) {
          pushEvent("site_click_d");
        }
      }
    }
  });

  // ==========================================
  // a 标签点击及穿插关闭检测
  // ==========================================

  window.addEventListener(
    "click",
    (event) => {
      const eventTarget =
        event.target && event.target.nodeType === Node.ELEMENT_NODE
          ? event.target
          : event.target && event.target.parentElement;

      const target =
        eventTarget && typeof eventTarget.closest === "function"
          ? eventTarget.closest("a")
          : null;

      // V4 NEW：记录真实点击及模拟点击
      if (target || window.i_like_it === 1) {
        debugLog("PARENT_CLICK", {
          isTrusted: event.isTrusted,
          linkId: target?.id || null,
          hasLink: !!target,

          sameElement: !!lastTrustedLink && target === lastTrustedLink.element,

          sameHref:
            !!lastTrustedLink &&
            !!target &&
            target.href === lastTrustedLink.href,
        });
      }

      // ======================================
      // a 标签触发穿插后恢复原始链接
      // ======================================

      if (
        window.i_like_it === 1 &&
        isLinkClick &&
        event.isTrusted === false &&
        target &&
        lastTrustedLink &&
        target === lastTrustedLink.element &&
        target.href === lastTrustedLink.href
      ) {
        window.i_like_it = 0;

        // V4 NEW：记录原始链接模拟点击匹配
        debugLog("VIGNETTE_LINK_RESUME");

        return;
      }

      // ======================================
      // Tab 穿插结束后的普通链接点击
      // ======================================

      if (window.i_like_it === 1) {
        if (!isLinkClick && event.isTrusted && target && target.href) {
          window.i_like_it = 0;

          // V4 NEW：记录 Tab 穿插状态重置
          debugLog("VIGNETTE_TAB_LINK_RESET");
        } else {
          // V4 NEW：记录点击被跳过的原因
          debugLog("PARENT_CLICK_SKIPPED", {
            reason: "vignette_state",
          });

          return;
        }
      }

      if (!target || !target.href) {
        return;
      }

      if (event.isTrusted) {
        lastTrustedLink = {
          element: target,
          href: target.href,
        };
      }

      isLinkClick = true;

      pushEvent("click_a_tag", {
        click_url: target.href,

        click_id: getAttribute(target, "id"),

        click_class: getAttribute(target, "class"),

        parentNodeClass: getAttribute(target.parentNode, "class"),

        parentNodeId: getAttribute(target.parentNode, "id"),
      });
    },
    true,
  );

  // ==========================================
  // Beforeunload
  // 当前页面即将卸载
  // ==========================================

  window.addEventListener("beforeunload", () => {
    // V4 NEW：记录 beforeunload 开始
    debugLog("BEFOREUNLOAD_START");

    confirmPendingAdBlur("beforeunload");

    analyzeNowSource();

    // Tab 穿插相关页面离开判断
    if (!isLinkClick && window.i_like_it === 1) {
      pushEvent("justdoit-type");
    }

    // a 标签相关页面离开判断
    if (isLinkClick && !window.onlyOne) {
      pushEvent(window.i_like_it === 1 ? "justdoit" : "pageChange");

      window.onlyOne = true;

      isLinkClick = false;
    }

    // V4 NEW：记录 beforeunload 结束后的状态
    debugLog("BEFOREUNLOAD_END");
  });

  // ==========================================
  // Blur
  // 保留 V3 的 1500ms 候选上报机制
  // ==========================================

  window.addEventListener("blur", () => {
    const activeElement = getActiveElement();

    // V4 NEW：记录 blur 触发
    debugLog("BLUR_START");

    // V4 NEW：保存本次可观察到的广告 iframe
    // 后续用于分析焦点是否丢失
    rememberFrameFocus("blur", activeElement);

    if (!activeElement) return;

    const id = getAttribute(activeElement, "id");

    // ======================================
    // ADM
    // ======================================

    if (isAdmElement(id)) {
      // 锚定
      if (id.includes("anchor")) {
        markPendingAdBlur("siteAnchoringAD");
      }

      // 激励
      else if (id.includes("preroll_reward") || id.includes("reward")) {
        markPendingAdBlur("siteRewardAD");
      }

      // 穿插
      else if (id.includes("interstitial") || id.includes("vignette")) {
        window.view_CC_num = true;

        // V4 NEW：记录穿插 blur 状态
        debugLog("VIGNETTE_BLUR_FLAG");
      }

      // 页内
      else if (getAttribute(activeElement, "data-load-complete")) {
        markPendingAdBlur("sitePageAD");
      }
    }

    // ======================================
    // AdSense
    // ======================================
    else {
      const parentIns =
        activeElement.tagName === "IFRAME"
          ? findParentIns(activeElement)
          : null;

      if (parentIns) {
        const adsenseType = getAdsenseTypeByIns(parentIns);

        if (adsenseType) {
          // 锚定
          if (adsenseType === "anchor") {
            markPendingAdBlur("siteAnchoringAD");
          }

          // 激励
          else if (adsenseType === "reward") {
            markPendingAdBlur("siteRewardAD");
          }

          // 穿插
          else if (adsenseType === "vignette") {
            window.view_CC_num = true;

            // V4 NEW：记录穿插 blur 状态
            debugLog("VIGNETTE_BLUR_FLAG");
          }

          // 页内
          else if (adsenseType === "page") {
            const adStatus =
              getAttribute(parentIns, "data-ad-status") || "unfilled";

            if (adStatus === "filled") {
              markPendingAdBlur("sitePageAD");
            }
          }
        }
      }
    }

    // V4 NEW：记录 blur 处理后的最终状态
    debugLog("BLUR_END");
  });

  // ==========================================
  // Visibilitychange
  // ==========================================

  window.addEventListener("visibilitychange", () => {
    // V4 NEW：记录 visibilitychange 开始
    // 此时可以查看当前焦点和历史焦点
    debugLog("VISIBILITY_START");

    // ======================================
    // 页面恢复可见
    // ======================================

    if (document.visibilityState === "visible") {
      // 保留 V3 原有 focus 行为
      setTimeout(() => {
        // V4 NEW：记录原有 focus 调用
        debugLog("V3_WINDOW_FOCUS_REQUEST");

        window.focus();
      }, 0);

      window.view_CC_num = false;

      // V4 NEW：页面恢复可见时清除历史诊断快照
      lastFrameFocus = null;
    }

    // ======================================
    // 页面隐藏
    // ======================================
    else if (document.visibilityState === "hidden") {
      confirmPendingAdBlur("visibility_hidden");

      if (!window.onlyPageStatistics) {
        analyzeNewSource();
      } else {
        // V4 NEW：记录 New 函数未执行的原因
        debugLog("ANALYZE_NEW_SKIPPED", {
          reason: "onlyPageStatistics",
        });
      }
    }

    // V4 NEW：记录 visibilitychange 处理结束
    debugLog("VISIBILITY_END");
  });

  // ==========================================
  // V4 NEW：新增浏览器生命周期诊断监听
  // 以下监听均不执行 dataLayer.push
  // 不主动修改原有业务状态
  // ==========================================

  if (DEBUG_V4) {
    // 窗口恢复焦点
    window.addEventListener("focus", () => {
      debugLog("WINDOW_FOCUS");
    });

    // 观察父页面可接收到的焦点进入事件
    document.addEventListener(
      "focusin",
      (event) => {
        rememberFrameFocus("focusin", event.target);
      },
      true,
    );

    // 页面离开或进入 bfcache
    window.addEventListener("pagehide", (event) => {
      debugLog("PAGEHIDE", {
        persisted: event.persisted,
      });
    });

    // 页面显示或从 bfcache 恢复
    window.addEventListener("pageshow", (event) => {
      debugLog("PAGESHOW", {
        persisted: event.persisted,
      });
    });
  }

  // ==========================================
  // Ident 展示检测
  // 保留 V3 原有逻辑
  // ==========================================

  let miniIdent = false;
  let maxIdent = false;

  const checkMiniIdent = () => {
    if (miniIdent) return;

    if (
      document.getElementById("google-anno-sa") ||
      document.querySelector(".google-anno")
    ) {
      pushEvent("showMiniIdent");

      miniIdent = true;
    }
  };

  const checkMaxIdent = () => {
    if (maxIdent) return;

    if (document.querySelector(".adpub-drawer-root")) {
      pushEvent("showMaxIdent");

      maxIdent = true;
    }
  };

  checkMiniIdent();
  checkMaxIdent();

  const identObserver = new MutationObserver(() => {
    checkMiniIdent();
    checkMaxIdent();

    if (miniIdent && maxIdent) {
      identObserver.disconnect();
    }
  });

  identObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // ==========================================
  // 初始化广告展示监听
  // ==========================================

  watchFullscreenAds();
  watchAdsMD();
  watchAdsYN();

  // V4 NEW：初始化完成日志
  debugLog("READY", {
    version: "4.0-debug",
    blurConfirmMs: BLUR_CONFIRM_MS,
    focusHistoryMs: FOCUS_HISTORY_MS,
  });
})();

(function () {
  "use strict";

  const ADM_NETWORK_ID = ["/23054585162/", "/23352693424/", "/23199949507/"];
  const dataLayer = (window.dataLayer = window.dataLayer || []);

  window.i_like_it = 0;
  window.onlyPageEngine = false;
  window.onlyPageStatistics = false;
  window.onlyNow = false;
  window.onlyNew = false;
  window.onlyReportOne = false;

  let isLinkClick = false;
  let lastTrustedLink = null;
  const BLUR_CONFIRM_MS = 1500;
  let pendingAdBlur = null;
  let pendingAdBlurTimer = null;
  const cancelPendingAdBlur = () => {
    if (pendingAdBlurTimer !== null) {
      clearTimeout(pendingAdBlurTimer);
      pendingAdBlurTimer = null;
    }

    pendingAdBlur = null;
  };
  const markPendingAdBlur = (eventName) => {
    cancelPendingAdBlur();
    pendingAdBlur = {
      eventName,
      timestamp: performance.now(),
    };
    pendingAdBlurTimer = setTimeout(() => {
      pendingAdBlur = null;
      pendingAdBlurTimer = null;
    }, BLUR_CONFIRM_MS);
  };
  const confirmPendingAdBlur = () => {
    if (!pendingAdBlur) return;
    const { eventName, timestamp } = pendingAdBlur;
    const withinTime = performance.now() - timestamp <= BLUR_CONFIRM_MS;
    cancelPendingAdBlur();
    if (withinTime) {
      pushEvent(eventName);
    }
  };

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
        // Keep reporting events when localStorage is unavailable.
      }
    }
    dataLayer.push({ event, ...(details || {}) });
  };

  const getActiveElement = () => document.activeElement || null;

  const getAttribute = (element, name) =>
    element && typeof element.getAttribute === "function"
      ? element.getAttribute(name)
      : null;

  const getClassName = (element) => {
    if (!element) return "";
    if (typeof element.className === "string") return element.className;
    return getAttribute(element, "class") || "";
  };

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

  const isAdmElement = (id) =>
    typeof id === "string" &&
    ADM_NETWORK_ID.some((networkId) => id.includes(networkId));

  const findParentIns = (element) =>
    element && typeof element.closest === "function"
      ? element.closest("ins")
      : null;

  // 识别
  const resolveAdInfo = (activeElement = getActiveElement()) => {
    if (!activeElement) return null;
    const id = getAttribute(activeElement, "id") || "";
    if (isAdmElement(id)) {
      let format = "page";
      if (id.includes("anchor")) {
        format = "anchor";
      } else if (id.includes("preroll_reward") || id.includes("reward")) {
        format = "reward";
      } else if (id.includes("interstitial") || id.includes("vignette")) {
        format = "vignette";
      }
      return {
        platform: "adm",
        format,
        ...(format === "page"
          ? {
              loadComplete: !!getAttribute(activeElement, "data-load-complete"),
            }
          : {}),
      };
    }
    if (activeElement.tagName !== "IFRAME") {
      return null;
    }
    const parentIns = findParentIns(activeElement);
    if (!parentIns) return null;
    const format = getAdsenseTypeByIns(parentIns);
    if (!format) return null;
    return {
      platform: "adsense",
      format,
      adStatus: getAttribute(parentIns, "data-ad-status") || "unfilled",
    };
  };
  // 事件
  const resolveSourceEvent = (adInfo, suffix) => {
    if (!adInfo) return null;
    const { platform, format, adStatus, loadComplete } = adInfo;
    switch (format) {
      // 锚定广告
      case "anchor":
        return `siteAnchoringAD${suffix}`;
      // 激励广告
      case "reward":
        if (
          platform === "adm" ||
          (platform === "adsense" && adStatus === "filled")
        ) {
          return `siteRewardAD${suffix}`;
        }
        break;
      // 穿插广告
      case "vignette":
        if (window.i_like_it !== 1) break;
        if (suffix === "Now") {
          return "justdoitnow";
        }
        if (suffix === "New" && !window.onlyNew) {
          return "justdoitnew";
        }
        break;
      // 页内广告
      case "page":
        if (
          (platform === "adm" && loadComplete) ||
          (platform === "adsense" && adStatus === "filled")
        ) {
          return `sitePageAD${suffix}`;
        }
        break;
    }

    return null;
  };

  function watchFullscreenAds() {
    const observedElements = new WeakMap();
    const discoveredIns = new WeakSet();
    const reportedTypes = {
      adsense: false,
      adm: false,
    };
    const getVignettePlatform = (ins) => {
      if (!ins || ins.tagName !== "INS") return null;
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
        return;
      }

      const previousDisplay = state.display;
      state.display = display;

      if (previousDisplay === "none" && display !== "none") {
        state.shown = true;

        state.trigger = isLinkClick ? "link" : "tab";

        window.i_like_it = 1;

        if (reportedTypes[platform]) return;
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

      if (
        previousDisplay !== "none" &&
        display === "none" &&
        state.shown &&
        state.trigger === "tab"
      ) {
        state.shown = false;
        window.i_like_it = 0;
      }
    };

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
      if (!ins || ins.tagName !== "INS") return;
      if (discoveredIns.has(ins)) return;
      discoveredIns.add(ins);
      checkVignette(ins);
      insObserver.observe(ins, {
        attributes: true,
      });
    };
    const discoverSubtree = (node) => {
      if (!node || node.nodeType !== 1) return;
      if (node.tagName === "INS") {
        discoverIns(node);
      }
      node.querySelectorAll?.("ins").forEach(discoverIns);
    };
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

  function watchAdsMD() {
    let reported = false;
    const reportWhenFound = () => {
      if (reported) return;
      for (const ins of document.querySelectorAll("ins[data-anchor-shown]")) {
        const id = ins.getAttribute("id") || "";
        if (isAdmElement(id)) continue;
        if (getAdsenseTypeByIns(ins) !== "anchor") {
          continue;
        }
        reported = true;
        pushEvent("sw_ads_md");
        observer.disconnect();

        return;
      }
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

  function watchAdsYN() {
    const processedAds = new WeakSet();
    const statusObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const ins = mutation.target;
        if (
          mutation.attributeName === "data-ad-status" &&
          ins.getAttribute("data-ad-status") === "filled"
        ) {
          pushEvent("sw_ads_yn");
        }
      }
    });
    const scan = () => {
      document.querySelectorAll("ins[data-ad-slot]").forEach((ins) => {
        if (processedAds.has(ins)) return;
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

  const analyzeNowSource = () => {
    const activeElement = getActiveElement();
    if (!activeElement) return;
    const adInfo = resolveAdInfo(activeElement);
    let eventToPush = resolveSourceEvent(adInfo, "Now");
    const className = getClassName(activeElement);
    if (className.includes("gs-") || className.includes("adpub-drawer-root")) {
      eventToPush = "clickIdentNow";
    }
    if (eventToPush) {
      window.onlyPageStatistics = true;
      pushEvent(eventToPush);
    }
    // Console JSON 日志
    console.log(
      "[ANALYZE NOW]",
      JSON.stringify(
        {
          activeTag: activeElement.tagName,
          activeId: activeElement.id,
          adInfo,
          eventToPush,
          i_like_it: window.i_like_it,
          onlyPageStatistics: window.onlyPageStatistics,
        },
        null,
        2,
      ),
    );
    reportSearchEngineClick(activeElement, "Now");
  };

  const analyzeNewSource = () => {
    const activeElement = getActiveElement();
    if (!activeElement) return;
    const adInfo = resolveAdInfo(activeElement);
    let eventToPush = resolveSourceEvent(adInfo, "New");
    if (eventToPush === "justdoitnew") {
      window.onlyNew = true;
      pushEvent(isLinkClick ? "justdoitnew-link" : "justdoitnew-type");
    }
    const className = getClassName(activeElement);
    if (className.includes("gs-") || className.includes("adpub-drawer-root")) {
      eventToPush = "clickIdentNew";
    }
    if (eventToPush) {
      pushEvent(eventToPush);
    }
    // Console JSON 日志
    console.log(
      "[ANALYZE NEW]",
      JSON.stringify(
        {
          activeTag: activeElement.tagName,
          activeId: activeElement.id,
          adInfo,
          eventToPush,
          i_like_it: window.i_like_it,
          onlyPageStatistics: window.onlyPageStatistics,
          isLinkClick,
        },
        null,
        2,
      ),
    );
    reportSearchEngineClick(activeElement, "New");
  };

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
        return;
      }
      if (window.i_like_it === 1) {
        if (!isLinkClick && event.isTrusted && target && target.href) {
          window.i_like_it = 0;
        } else {
          return;
        }
      }
      if (!target || !target.href) return;
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

  window.addEventListener("beforeunload", () => {
    confirmPendingAdBlur();
    analyzeNowSource();

    if (!isLinkClick && window.i_like_it === 1) {
      pushEvent("justdoit-type");
    }

    if (isLinkClick && !window.onlyNow) {
      pushEvent(window.i_like_it === 1 ? "justdoit" : "pageChange");
      window.onlyNow = true;
      isLinkClick = false;
    }
  });

  window.addEventListener("blur", () => {
    const adInfo = resolveAdInfo();
    console.log("[BLUR]", JSON.stringify(adInfo, null, 2));
    if (!adInfo) return;
    const { platform, format, adStatus, loadComplete } = adInfo;
    switch (format) {
      // 锚定广告
      case "anchor":
        markPendingAdBlur("siteAnchoringAD");
        break;
      // 激励广告
      case "reward":
        markPendingAdBlur("siteRewardAD");
        break;
      // 穿插广告
      case "vignette":
        console.log(platform, "穿插 blur");
        break;
      // 页内广告
      case "page":
        if (
          (platform === "adm" && loadComplete) ||
          (platform === "adsense" && adStatus === "filled")
        ) {
          markPendingAdBlur("sitePageAD");
        }
        break;
    }
  });

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      setTimeout(() => window.focus(), 0);
    } else if (document.visibilityState === "hidden") {
      confirmPendingAdBlur();
      if (!window.onlyPageStatistics) {
        analyzeNewSource();
      }
    }
  });

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

  watchFullscreenAds();
  watchAdsMD();
  watchAdsYN();
})();

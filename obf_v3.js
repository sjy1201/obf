(function () {
  "use strict";

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
      const adsenseAnchor = Array.from(
        document.querySelectorAll("ins[data-anchor-shown]"),
      ).find((ins) => {
        const id = ins.getAttribute("id") || "";
        if (isAdmElement(id)) return false;
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

  function watchAdsYN() {
    const processedAds = new WeakSet();

    const scan = () => {
      document.querySelectorAll("ins[data-ad-slot]").forEach((ins) => {
        if (processedAds.has(ins)) return;

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
    const id = getAttribute(activeElement, "id");
    let eventToPush = null;
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
    } else {
      const parentIns =
        activeElement.tagName === "IFRAME"
          ? findParentIns(activeElement)
          : null;
      if (parentIns) {
        const adsenseType = getAdsenseTypeByIns(parentIns);
        if (adsenseType) {
          const adStatus =
            getAttribute(parentIns, "data-ad-status") || "unfilled";
          if (adsenseType === "anchor") {
            eventToPush = "siteAnchoringADNow";
          } else if (adsenseType === "reward") {
            if (adStatus === "filled") {
              eventToPush = "siteRewardADNow";
            }
          } else if (adsenseType === "vignette") {
            if (window.i_like_it === 1) {
              eventToPush = "justdoitnow";
            }
          } else if (adsenseType === "page") {
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

    reportSearchEngineClick(activeElement, "Now");
  };

  const analyzeNewSource = () => {
    const activeElement = getActiveElement();
    if (!activeElement) return;
    const id = getAttribute(activeElement, "id");
    let eventToPush = null;

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
    } else {
      const parentIns =
        activeElement.tagName === "IFRAME"
          ? findParentIns(activeElement)
          : null;
      if (parentIns) {
        const adsenseType = getAdsenseTypeByIns(parentIns);
        if (adsenseType) {
          const adStatus =
            getAttribute(parentIns, "data-ad-status") || "unfilled";
          if (adsenseType === "anchor") {
            eventToPush = "siteAnchoringADNew";
          } else if (adsenseType === "reward") {
            if (adStatus === "filled") {
              eventToPush = "siteRewardADNew";
            }
          } else if (adsenseType === "vignette") {
            if (window.i_like_it === 1 && !window.click_CC_type) {
              window.click_CC_type = true;
              eventToPush = "justdoitnew";
              pushEvent(isLinkClick ? "justdoitnew-link" : "justdoitnew-type");
            }
          } else if (adsenseType === "page") {
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

    if (isLinkClick && !window.onlyOne) {
      pushEvent(window.i_like_it === 1 ? "justdoit" : "pageChange");
      window.onlyOne = true;
      isLinkClick = false;
    }
  });

  window.addEventListener("blur", () => {
    const activeElement = getActiveElement();
    if (!activeElement) return;
    const id = getAttribute(activeElement, "id");
    if (isAdmElement(id)) {
      if (id.includes("anchor")) {
        markPendingAdBlur("siteAnchoringAD");
      } else if (id.includes("preroll_reward") || id.includes("reward")) {
        markPendingAdBlur("siteRewardAD");
      } else if (id.includes("interstitial") || id.includes("vignette")) {
        window.view_CC_num = true;
      } else if (getAttribute(activeElement, "data-load-complete")) {
        markPendingAdBlur("sitePageAD");
      }
    } else {
      const parentIns =
        activeElement.tagName === "IFRAME"
          ? findParentIns(activeElement)
          : null;
      if (parentIns) {
        const adsenseType = getAdsenseTypeByIns(parentIns);
        if (adsenseType) {
          if (adsenseType === "anchor") {
            markPendingAdBlur("siteAnchoringAD");
          } else if (adsenseType === "reward") {
            markPendingAdBlur("siteRewardAD");
          } else if (adsenseType === "vignette") {
            window.view_CC_num = true;
          } else if (adsenseType === "page") {
            const adStatus =
              getAttribute(parentIns, "data-ad-status") || "unfilled";
            if (adStatus === "filled") {
              markPendingAdBlur("sitePageAD");
            }
          }
        }
      }
    }
  });

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      setTimeout(() => window.focus(), 0);
      window.view_CC_num = false;
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

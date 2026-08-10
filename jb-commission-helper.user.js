
// ==UserScript==
// @name         JB Commission Helper
// @namespace    jb-commission-helper
// @version      8.4.11
// @description  automatically does ur jb commmissions for u :) anthonythach.com
// @match        https://jbh-all-commissions-ui-webapp-prod.azurewebsites.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  // --- UTILITIES ---
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LS_KEY_CALC = "jbh_give_calc";
  const LS_KEY_REASON = "jbh_give_reason";
  const LS_KEY_ONLY_ZERO = "jbh_only_zero";
  const LS_KEY_CONFIRM = "jbh_confirm";
  const LS_KEY_COLLAPSED = "jbh_collapsed";
  const LS_KEY_REASON_SELECT = "jbh_reason_select";
  const LS_KEY_REASON_OTHER_TEXT = "jbh_reason_other_text";
  const LS_KEY_EFFICIENCY = "jbh_efficiency";
  let obs = null;
  let updateTimer = null;
  let lastRunData = null;
  let runBusy = false;
  let effPosListening = false;
  let effClusterLocked = false;
  let effLockTimer = null;

  // Missing key → defaultValue ($0-only + confirm default on)
  function lsFlag(key, defaultValue = false) {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === "true";
  }

  let selectedReason = localStorage.getItem(LS_KEY_REASON_SELECT) || "Matched Advertised Price";
  let selectedOtherText = localStorage.getItem(LS_KEY_REASON_OTHER_TEXT) || "";
  const REASON_OPTIONS = [
    "Price Match",
    "EL & Q Under Cost",
    "Ex-Display Under Cost",
    "Open Sku Sale",
    "Matched Advertised Price",
    "Other",
  ];

  const THEME = {
    bg: "rgba(8, 8, 12, 0.92)",
    bgSolid: "#08080c",
    blur: "28px",
    border: "1px solid rgba(255, 255, 255, 0.06)",
    noise: "url('https://grainy-gradients.vercel.app/noise.svg')",
    noiseOpacity: "0.07",
    accent: "#34C759",
    textMain: "#FFFFFF",
    textDim: "rgba(255, 255, 255, 0.55)",
    textDark: "rgba(255, 255, 255, 0.28)",
    radius: "20px",
    shadow: "0 25px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04) inset",
    shadowLift: "0 30px 70px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06) inset",
  };

  function parseMoney(txt) {
    if (!txt) return 0;
    const isNegative = txt.includes("-") || (txt.includes("(") && txt.includes(")"));
    const num = Number(txt.replace(/[^0-9.]/g, ""));
    return isNegative ? -Math.abs(num) : num;
  }

  function text(el) {
    return (el?.textContent || "").trim();
  }

  function normName(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function trunc3(x) {
    if (x == null || Number.isNaN(x)) return x;
    return Math.trunc(x * 1000) / 1000;
  }

  function fmtPercent(rate) {
    if (!Number.isFinite(rate)) return "—";
    const p = Math.round(rate * 1000) / 10;
    return String(p).replace(/\.0$/, "");
  }

  // --- DOM ---
  function isSaleOverview() {
    return $$("h2").some((h) => text(h).includes("Sale Overview") && !isInHostModal(h));
  }

  function isInHostModal(node) {
    return !!(
      node &&
      node.closest &&
      node.closest(
        '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .MuiModal-root, .MuiDialog-root'
      )
    );
  }

  function isProductCard(node) {
    if (!node || node === document.body || node === document.documentElement) return false;
    if (!$$("b", node).some((b) => text(b) === "Sale Total:")) return false;
    const skus = $$("p", node).filter((p) => text(p).startsWith("SKU:"));
    return skus.length === 1;
  }

  function getProductContainers() {
    const containers = [];
    const seen = new Set();
    for (const skuP of $$("p").filter((p) => text(p).startsWith("SKU:"))) {
      if (isInHostModal(skuP)) continue;
      let node = skuP.parentElement;
      let container = null;
      for (let i = 0; i < 8 && node; i++) {
        if (isProductCard(node)) {
          container = node;
          break;
        }
        node = node.parentElement;
      }
      if (!container || seen.has(container) || isInHostModal(container)) continue;
      seen.add(container);
      containers.push(container);
    }
    return containers;
  }

  function labeledMoney(container, label) {
    const b = $$("b", container).find((el) => text(el) === label);
    if (!b) return null;
    const wrap = b.closest("span") || b.parentElement;
    return parseMoney(text(wrap?.querySelector("p")));
  }

  const getSaleTotal = (c) => labeledMoney(c, "Sale Total:");
  const getOriginalComm = (c) => labeledMoney(c, "Comm:");

  function getAdjustButton(container) {
    return $$("button", container).find((btn) => text(btn).includes("Add/Edit Adjustment"));
  }

  function skuText(container) {
    const p = $$("p", container).find((el) => text(el).startsWith("SKU:"));
    return p ? text(p) : "";
  }

  function getSKU(container) {
    const m = skuText(container).match(/SKU:\s*(\d+)/i);
    return m ? m[1] : null;
  }

  function getStockType(container) {
    const m = skuText(container).match(/\(([A-Z])\)/i);
    return m ? m[1].toUpperCase() : null;
  }

  function getProductName(container) {
    const skip = /^(SKU:)|Qty:|Sale Total:|Cost:|Go Price:|Comm:/;
    const candidates = $$("p", container)
      .map((p) => text(p))
      .filter((t) => t.length > 3 && !skip.test(t));
    if (!candidates.length) return "";

    const scored = candidates.map((c) => {
      let score = c.length;
      const u = c.toUpperCase();
      if (/IPHONE|2D SAMSUNG|MACBOOK|IMAC|MAC|IPAD|WATCH|SURFACE|LAPTOP|GALAXY|TABLET/i.test(u)) {
        score += 200;
      }
      if (/\b(64|128|256|512)\s*GB\b/i.test(u) || /\b[12]\s*TB\b/i.test(u)) score += 50;
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].c;
  }

  function getQty(container) {
    const qtyP = $$("p", container).find((p) => text(p).includes("Qty:"));
    const m = text(qtyP).match(/Qty:\s*(\d+)/i);
    return m ? Number(m[1]) : 1;
  }

  // --- CATEGORIZATION ---
  // MacBook SKUs treated as primary even if the title is messy
  const SKU_MAIN_PRODUCTS = new Set([
    "465729", "465733", "448451", "448452", "465734", "465730", "465731", "465732",
    "453376", "453378", "453379", "453381", "453377", "453371", "448417", "448416",
    "453382", "453384", "453386", "453373", "453383", "453385", "453387", "453374",
  ]);

  const RX_ACCESSORY_HINTS =
    /\b(CASE|COVER|PROTECTOR|SCREEN|GLASS|BUNDLE|PACK|KIT|SLEEVE|FOLIO|SHELL|SKIN|STRAP|BAND|CABLE|CHARGER|ADAPTER|MOUNT|HOLDER|STAND|KEYBOARD|PENCIL|STYLUS|BUDS|WATCH|FIT|EARBUD|HEADPHONE|SPEAKER|MOUSE|AUDIO)\b/i;
  const RX_CAMERA_BRANDS =
    /\b(CANON|SONY A|SONY ALPHA|NIKON|PANASONIC|INSTAX|POLAROID|GOPRO|DJI)\b/i;
  const RX_CAMERA_EXCLUDE =
    /\b(LENS|BATTERY|CHARGER|CASE|STRAP|MOUNT|SD|MEMORY|HEADPHONE|HEADPHONES|BUDS|EARBUD|SPEAKER|AUDIO)\b/i;
  const RX_LAPTOP =
    /\b(LENOVO\s+(IDEAPAD|LEGION|LOQ|YOGA)|MICROSOFT\s+SURFACE|HP\s+(VICTUS|OMNIBOOK|PAVILION|SPECTRE|LAPTOP|OMEN)|VICTUS\s+15|MSI\s+(CYBORG|CROSSHAIR)|ASUS\s+(ROG|VIVOBOOK|ZENBOOK|TUF))\b/i;

  function isAppleWatch(nameUpper) {
    const n = normName(nameUpper);
    return /\bAPPLE\s+WATCH/i.test(n) || /\bWATCH\s+(SERIES|SE|ULTRA)/i.test(n);
  }

  function isAccessory(nameUpper, container = null) {
    const sku = container && getSKU(container);
    if (sku && SKU_MAIN_PRODUCTS.has(sku)) return false;
    if (/^3SIXT\s*-\s*/i.test(nameUpper) || /^PANZERGLASS\s*-/i.test(nameUpper)) return true;
    if (isAppleWatch(nameUpper)) return false;
    return /AIRFLY|ADAPTER|AIRTAG|DONGLE|TRANSMITTER|RECEIVER|CASE|CABLE|CHARGER|MOUNT|STAND|COVER|PROTECTOR|EARBUD|HEADPHONE|TWS|ACCESSORY|ACCESSORIES|SPEAKER|MOUSE|KEYBOARD|SDXC|MICROSD|MEMORY|BAG|BACKPACK/i.test(
      nameUpper
    );
  }

  function isAppleCare(nameUpper) {
    const n = normName(nameUpper);
    if (!n) return false;
    if (/APPLECARE\+?|APPLE\s*CARE|CARE\+|AC\s*\+|AC\+/i.test(n)) return true;
    // Lone "AC" only with Apple/care context (skip AC adapters)
    return (
      /\bAC\b/.test(n) &&
      /\b(IPHONE|IPAD|MACBOOK|IMAC|MAC\s+MINI|APPLE\s+WATCH|\bWATCH\b|AIRPODS|APPLE\s+TV|HOMEPOD|COVERAGE|PROTECTION|INSURANCE|DEVICE)\b/i.test(n)
    );
  }

  function isAirPods(nameUpper) {
    return /\bAIRPODS\b/i.test(nameUpper);
  }

  function isAppleProduct(nameUpper, container = null) {
    const sku = container && getSKU(container);
    if (sku && SKU_MAIN_PRODUCTS.has(sku)) return true;

    const n = normName(nameUpper);
    if (isAppleWatch(n)) return true;
    if (RX_ACCESSORY_HINTS.test(n)) return false;

    if (/IPHONE/i.test(n)) {
      if (!/\bIPHONE\s*(1[3-9]|SE)\b/i.test(n)) return false;
      return /\b(64|128|256|512)\s*GB\b/i.test(n) || /\b[12]\s*TB\b/i.test(n);
    }
    return /\b(IPAD|MACBOOK|IMAC|MAC\s+MINI|MAC\s+STUDIO|AIRPODS)\b/i.test(n);
  }

  function isSamsungDevice(nameUpper) {
    const n = normName(nameUpper);
    if (!/\bSAMSUNG\b/i.test(n) || RX_ACCESSORY_HINTS.test(n)) return false;
    if (/\bS25[\s\+]?\+?[\s]?(ULTRA|PRO)?/i.test(n)) return true;
    if (!/\bGALAXY\b/i.test(n) || /\bBOOK\b/i.test(n)) return false;
    return true;
  }

  function isCamera(nameUpper) {
    const n = normName(nameUpper);
    return RX_CAMERA_BRANDS.test(n) && !RX_CAMERA_EXCLUDE.test(n);
  }

  function isMainNonAppleProduct(nameUpper, container = null) {
    const sku = container && getSKU(container);
    if (sku && SKU_MAIN_PRODUCTS.has(sku)) return false;
    const n = normName(nameUpper);
    return isSamsungDevice(n) || isCamera(n) || RX_LAPTOP.test(n);
  }

  function rateResult(saleTotal, rate, label, note, name, extra = {}) {
    return {
      value: saleTotal * rate,
      rate,
      baseRate: extra.baseRate ?? rate,
      multiplier: extra.multiplier ?? 1,
      label,
      note,
      name,
    };
  }

  function computeCommission(container, ctx) {
    const saleTotal = getSaleTotal(container);
    if (saleTotal == null) return null;

    const nameRaw = getProductName(container).trim();
    const nameU = nameRaw.toUpperCase();
    const stockType = getStockType(container);
    const qty = getQty(container);
    const solo = ctx.saleItemCount === 1 && qty === 1;
    const appleCareItem = isAppleCare(nameU);
    const airPods = isAirPods(nameU);

    let appleItem = isAppleProduct(nameU, container) && !appleCareItem;
    let accessoryItem = isAccessory(nameU, container);
    if (appleItem) accessoryItem = false;

    if (appleCareItem) {
      return rateResult(saleTotal, 0.05, "AppleCare", "AppleCare 5%", nameRaw);
    }

    // AirPods are always 0.5% — never the solo-primary 0.2% rate, no IPS/AC multipliers
    if (airPods) {
      return rateResult(saleTotal, 0.005, "AirPods", "AirPods 0.5%", nameRaw);
    }

    if (stockType === "Q") {
      const isMain = appleItem || isMainNonAppleProduct(nameU, container);
      const noteSuffix = isMain
        ? ". Considering this as primary product for any attached items (IPS Multiplier)"
        : "";
      if (appleItem) {
        return rateResult(saleTotal, 0.015, "Q Apple", `Apple Q Stock 1.5%${noteSuffix}`, nameRaw);
      }
      return rateResult(saleTotal, 0.023, "Q stock", `Q Stock 2.3%${noteSuffix}`, nameRaw);
    }

    if (appleItem || isMainNonAppleProduct(nameU, container)) {
      if (solo) {
        return rateResult(
          saleTotal, 0.002,
          appleItem ? "Solo Apple" : "Solo Primary",
          "Main Product with no attach 0.2%",
          nameRaw
        );
      }
      return rateResult(
        saleTotal, 0.005,
        appleItem ? "Apple w/ others" : "Main Product w/ others",
        appleItem ? "Main Product with attach/AC 0.5%" : "Main Product (non-Apple) 0.5%",
        nameRaw
      );
    }

    let label = accessoryItem ? "Accessory default" : "Default";
    let note = "";
    let multiplier = 1;

    if (ctx.appleCareSoldWithAppleAndOthers && !appleCareItem && !appleItem) {
      multiplier = 2.5;
      label += " ×2.5 (AppleCare bundle)";
      note = "AppleCare Multiplier 0.5% * 2.5";
    } else if (ctx.primarySoldWithOthers && !appleCareItem) {
      multiplier = 2;
      label += " ×2 (IPS bundle)";
      note = "IPS Multiplier 0.5% * 2";
    }

    return rateResult(saleTotal, 0.005 * multiplier, label, note, nameRaw, {
      baseRate: 0.005,
      multiplier,
    });
  }

  function buildWorkingText(
    rate,
    saleTotal,
    value,
    baseRate = rate,
    multiplier = 1,
    note = "",
    calcOn = true,
    reasonOn = true
  ) {
    let calc = "";
    if (calcOn) {
      if (multiplier === 2.5 && baseRate === 0.005) {
        calc = `(0.5% of $${saleTotal}) * 2.5 = $${value}`;
      } else if (multiplier === 2 && baseRate === 0.005) {
        calc = `(0.5% of $${saleTotal}) * 2 = $${value}`;
      } else {
        calc = `${fmtPercent(rate)}% of $${saleTotal} = $${value}`;
      }
    }

    const extra = reasonOn && note ? note : "";

    if (calc && extra) return `${calc}\n\n${extra}`;
    if (calc) return calc;
    if (extra) return extra;
    return "";
  }

  // --- UI & INTERACTION ---

  function setReactValue(el, value) {
    if (!el) return;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitForModal(timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const input = document.querySelector("#commission-value-input");
      if (input) return input.closest("[tabindex='-1']") || document.body;
      await sleep(60);
    }
    return null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function notify(msg, duration = 4500) {
    let stack = document.getElementById("jbh-notification-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "jbh-notification-stack";
      Object.assign(stack.style, {
        position: "fixed",
        left: "50%",
        bottom: "24px",
        transform: "translateX(-50%)",
        zIndex: 2147483647,
        display: "flex",
        flexDirection: "column-reverse",
        gap: "8px",
        alignItems: "center",
        pointerEvents: "none",
        maxWidth: "90vw",
        transition: "all 0.3s ease",
      });
      document.body.appendChild(stack);
    }
    const item = document.createElement("div");
    item.className = "jbh-toast";
    item.textContent = msg;
    stack.appendChild(item);
    setTimeout(() => {
      item.classList.add("hiding");
      setTimeout(() => {
        item.remove();
        if (!stack.hasChildNodes()) stack.remove();
      }, 400);
    }, duration);
  }

  async function pickReasonOption(label) {
    const selectBtn = document.querySelector("#reason-select");
    if (!selectBtn) return false;

    selectBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    selectBtn.click();

    const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

    let listbox = null;
    for (let i = 0; i < 30; i++) {
      const listboxes = $$("[role='listbox']");
      for (const lb of listboxes) {
        const opts = $$("[role='option']", lb);
        const labels = opts
          .map((o) => o.dataset.value || text(o))
          .filter(Boolean);
        if (
          labels.some((l) => norm(l) === norm("Other")) ||
          labels.some((l) => norm(l) === norm("Matched Advertised Price"))
        ) {
          listbox = lb;
          break;
        }
      }
      if (listbox) break;
      await sleep(80);
    }

    if (!listbox) {
      console.warn("[JBH Helper] listbox not found after opening reason select");
      return false;
    }

    const options = $$("[role='option']", listbox);
    const target =
      options.find((o) => norm(o.dataset.value || "") === norm(label)) ||
      options.find((o) => norm(text(o)) === norm(label));

    if (!target) {
      console.warn(
        "[JBH Helper] reason option not found:",
        label,
        options.map((o) => o.dataset.value || text(o))
      );
      document.body.click();
      return false;
    }

    target.click();
    await sleep(150);
    return true;
  }

  async function waitForCustomReasonInput(timeoutMs = 1800) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ta =
        document.querySelector("#custom-reason-input") ||
        document.querySelector("textarea[name='customReason']");
      if (ta) return ta;
      await sleep(60);
    }
    return null;
  }

  async function fillAndSaveModal({ commissionValue, commentText, reasonLabel }) {
    const reason = reasonLabel || selectedReason || "Matched Advertised Price";

    const modalRoot = await waitForModal();
    if (!modalRoot) return false;

    const commInput = document.querySelector("#commission-value-input");
    if (!commInput) return false;

    setReactValue(commInput, String(commissionValue));
    await sleep(120); // allow any reactive UI recalculation/clearing to occur

    await pickReasonOption(reason);

    const fullComment = reason === "Other"
      ? (selectedOtherText ? (commentText ? `${selectedOtherText}\n\n${commentText}` : selectedOtherText) : commentText)
      : (commentText || "") + (selectedOtherText ? (commentText ? "\n\n" : "") + selectedOtherText : "");

    if (fullComment) {
      const customTa = await waitForCustomReasonInput();
      if (customTa) {
        setReactValue(customTa, fullComment);
      }
    }

    const saveBtn = $$("button", modalRoot).find((b) => text(b) === "Save");
    if (saveBtn) saveBtn.click();

    await sleep(300);
    return true;
  }

  function clampToOriginalIfLower(computed, originalComm, saleTotal) {
    if (
      computed &&
      originalComm != null &&
      originalComm > 0 &&
      computed.value < originalComm
    ) {
      const newVal = originalComm;
      const newRate = saleTotal > 0 ? newVal / saleTotal : computed.rate;
      return {
        ...computed,
        value: newVal,
        rate: newRate,
        label: `${computed.label} (kept original)`,
        note: computed.note,
        keptOriginal: true,
      };
    }
    return computed;
  }

  // Clamp + trunc3 — same value Run Adjustment writes
  function finalizeCommission(computedRaw, container) {
    if (!computedRaw) return null;
    const saleTotal = getSaleTotal(container) || 0;
    const originalComm = getOriginalComm(container);
    let computed = clampToOriginalIfLower(computedRaw, originalComm, saleTotal);
    const truncatedValue = trunc3(computed.value);
    if (truncatedValue !== computed.value) {
      computed = {
        ...computed,
        value: truncatedValue,
        rate: saleTotal > 0 ? truncatedValue / saleTotal : computed.rate,
      };
    }
    return computed;
  }

  function formatSignedMoney(n) {
    if (n == null || Number.isNaN(n)) return "$0";
    return n < 0 ? `-$${Math.abs(n)}` : `$${n}`;
  }

  function buildSaleContext(containers) {
    const flags = containers.map((c) => {
      const nU = getProductName(c).toUpperCase();
      const airPods = isAirPods(nU);
      const listedPrimary = isAppleProduct(nU, c) || isMainNonAppleProduct(nU, c);
      return {
        appleCare: isAppleCare(nU),
        airPods,
        listedPrimary,
      };
    });
    const hasRealPrimaryProduct = flags.some((f) => f.listedPrimary && !f.airPods);
    const primaryCount = flags.filter((f) => {
      if (f.airPods && hasRealPrimaryProduct) return false;
      return f.listedPrimary;
    }).length;
    const n = containers.length;
    const appleCareCount = flags.filter((f) => f.appleCare).length;
    return {
      saleItemCount: n,
      hasRealPrimaryProduct,
      primarySoldWithOthers: primaryCount > 0 && n > primaryCount,
      appleCareSoldWithAppleAndOthers:
        appleCareCount > 0 && primaryCount > 0 && n > primaryCount + appleCareCount,
    };
  }

  function computeSalePreview() {
    const containers = getProductContainers();
    if (!containers.length) return null;

    const ctx = buildSaleContext(containers);
    const onlyZeroOn = lsFlag(LS_KEY_ONLY_ZERO, true);
    const targets = onlyZeroOn
      ? containers.filter((c) => getOriginalComm(c) === 0)
      : containers;

    const items = [];
    let total = 0;
    let targetTotal = 0;

    for (const c of containers) {
      const computed = finalizeCommission(computeCommission(c, ctx), c);
      if (!computed) continue;

      const saleTotal = getSaleTotal(c) || 0;
      const originalComm = getOriginalComm(c);
      const isTarget = targets.includes(c);
      items.push({
        name: computed.name,
        rate: computed.rate,
        value: computed.value,
        saleTotal,
        originalComm,
        isTarget,
        keptOriginal: computed.keptOriginal
      });
      total += computed.value;
      if (isTarget) targetTotal += computed.value;
    }

    return {
      items,
      total: trunc3(total),
      targetTotal: trunc3(targetTotal),
      targetCount: targets.length,
      totalCount: containers.length,
    };
  }

  function showConfirmation(preview) {
    return new Promise((resolve) => {
      let resolved = false;
      const runBtn = document.getElementById("jbh-eff-run-btn");
      const useEffConfirm = lsFlag(LS_KEY_EFFICIENCY) && !!runBtn;
      let placeEffConfirm = () => {};

      const overlay = document.createElement("div");
      overlay.id = "jbh-confirm-overlay";

      const dialog = document.createElement("div");
      dialog.id = "jbh-confirm-dialog";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.textContent = "Confirm";

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", placeEffConfirm);
        window.visualViewport?.removeEventListener("resize", placeEffConfirm);
        overlay.remove();
        confirmBtn.remove();
        if (runBtn) runBtn.style.visibility = "";
      };

      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup();
          resolve(false);
        } else if (e.key === "Enter") {
          e.preventDefault();
          cleanup();
          resolve(true);
        }
      };
      document.addEventListener("keydown", onKey);

      overlay.addEventListener("click", (e) => {
        if (e.target !== overlay && !e.target.classList?.contains("jbh-confirm-scrim")) return;
        cleanup();
        resolve(false);
      });

      const noiseOverlay = document.createElement("div");
      noiseOverlay.className = "jbh-confirm-noise";
      dialog.appendChild(noiseOverlay);

      const titleEl = document.createElement("div");
      titleEl.className = "jbh-confirm-title";
      titleEl.textContent = "Confirm Adjustments";
      dialog.appendChild(titleEl);

      const list = document.createElement("div");
      list.className = "jbh-confirm-list";

      for (const item of preview.items) {
        const row = document.createElement("div");
        row.className = `jbh-confirm-row${item.isTarget ? " is-target" : ""}`;

        const nameSpan = document.createElement("span");
        nameSpan.className = "jbh-confirm-name";
        nameSpan.textContent = item.name || "Unknown";

        const valSpan = document.createElement("span");
        valSpan.className = "jbh-confirm-val";
        const fmtVal = formatSignedMoney(item.value);
        valSpan.textContent = item.keptOriginal
          ? `${fmtPercent(item.rate)}% = ${fmtVal} · kept`
          : `${fmtPercent(item.rate)}% = ${fmtVal}`;

        row.append(nameSpan, valSpan);
        list.appendChild(row);
      }
      dialog.appendChild(list);

      const totalEl = document.createElement("div");
      totalEl.className = "jbh-confirm-total";
      const writeFmt = formatSignedMoney(preview.targetTotal);
      const skipped = preview.totalCount - preview.targetCount;
      let totalHtml = `<span class="jbh-confirm-total-label">Total to write</span><span class="jbh-confirm-total-value">${writeFmt}</span><div class="jbh-confirm-total-meta">${preview.targetCount} items to adjust</div>`;
      if (skipped > 0) {
        totalHtml += `<div class="jbh-confirm-total-meta">Sale preview ${formatSignedMoney(preview.total)} · ${skipped} unchanged</div>`;
      }
      totalEl.innerHTML = totalHtml;
      dialog.appendChild(totalEl);

      const btnRow = document.createElement("div");
      btnRow.className = "jbh-confirm-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "jbh-confirm-cancel";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => { cleanup(); resolve(false); });

      confirmBtn.addEventListener("click", () => { cleanup(); resolve(true); });

      if (useEffConfirm) {
        confirmBtn.className = "jbh-eff-btn jbh-eff-confirm-btn";
        runBtn.style.visibility = "hidden";
        placeEffConfirm = () => {
          const r = runBtn.getBoundingClientRect();
          if (!r.width && !r.height) return;
          confirmBtn.style.left = `${r.left}px`;
          confirmBtn.style.top = `${r.top}px`;
          confirmBtn.style.width = `${r.width}px`;
          confirmBtn.style.height = `${r.height}px`;
        };
        window.addEventListener("resize", placeEffConfirm);
        window.visualViewport?.addEventListener("resize", placeEffConfirm);
        btnRow.append(cancelBtn);
      } else {
        confirmBtn.className = "jbh-confirm-ok";
        btnRow.append(cancelBtn, confirmBtn);
      }

      dialog.appendChild(btnRow);
      const scrim = document.createElement("div");
      scrim.className = "jbh-confirm-scrim";
      overlay.append(scrim, dialog);
      document.body.appendChild(overlay);
      if (useEffConfirm) {
        document.body.appendChild(confirmBtn);
        placeEffConfirm();
        requestAnimationFrame(placeEffConfirm);
      }
    });
  }

  function forRunButtons(fn) {
    for (const id of ["jbh-auto-btn", "jbh-eff-run-btn"]) {
      const el = document.getElementById(id);
      if (el) fn(el);
    }
  }

  function beginRunButtons() {
    forRunButtons((btn) => {
      btn.classList.add("processing");
      btn.disabled = true;
      btn.style.background = "";
      btn.style.color = "";
      btn.style.opacity = "";
      btn.style.cursor = "";
    });
  }

  function setRunButtonsLabel(label) {
    forRunButtons((btn) => {
      btn.textContent = label;
    });
  }

  function endRunButtons() {
    forRunButtons((btn) => {
      btn.classList.remove("processing");
      btn.disabled = false;
    });
  }

  async function undoLastRun() {
    if (runBusy) return;
    if (!lastRunData || !lastRunData.length) {
      notify("Nothing to undo.");
      return;
    }

    runBusy = true;
    const undoBtn = document.getElementById("jbh-undo-btn");
    if (undoBtn) {
      undoBtn.disabled = true;
      undoBtn.textContent = "Undoing...";
    }

    beginRunButtons();

    try {
      for (let i = 0; i < lastRunData.length; i++) {
        const entry = lastRunData[i];
        const btn = getAdjustButton(entry.container);
        if (!btn) continue;

        setRunButtonsLabel(`Undoing ${i + 1}/${lastRunData.length}...`);

        btn.click();
        await sleep(220);

        const ok = await fillAndSaveModal({
          commissionValue: entry.originalComm || 0,
          commentText: "Undo adjustment"
        });

        if (!ok) {
          notify(`Undo stopped at ${i + 1}. Modal not found.`);
          return;
        }

        await sleep(250);
      }

      notify("Undo complete");
      lastRunData = null;
      if (undoBtn) undoBtn.style.display = "none";
    } finally {
      runBusy = false;
      endRunButtons();
      if (undoBtn) {
        undoBtn.disabled = false;
        undoBtn.textContent = "Undo Last Run";
      }
      updateUIState();
    }
  }

  async function autoFixZeros() {
    if (runBusy) return;
    runBusy = true;
    beginRunButtons();

    try {
      for (let i = 0; i < 30; i++) {
        if (getProductContainers().length) break;
        await sleep(150);
      }

      const containers = getProductContainers();
      if (!containers.length) {
        notify("No items found in this sale.");
        return;
      }

    const ctx = buildSaleContext(containers);
    const onlyZeroOn = lsFlag(LS_KEY_ONLY_ZERO, true);
    const targets = onlyZeroOn
      ? containers.filter((c) => getOriginalComm(c) === 0)
      : containers;

    if (!targets.length) {
      notify("No $0 commission items found.");
      return;
    }

    if (selectedReason === "Other" && !(selectedOtherText || "").trim()) {
      notify("Please enter a comment when 'Other' is selected.");
      return;
    }

    const confirmOn = lsFlag(LS_KEY_CONFIRM, true);
    if (confirmOn) {
      const preview = computeSalePreview();
      if (!preview) return;
      const confirmed = await showConfirmation(preview);
      if (!confirmed) return;
    }

    const undoEntries = targets.map(c => ({
      container: c,
      originalComm: getOriginalComm(c),
      saleTotal: getSaleTotal(c) || 0,
      name: getProductName(c)
    }));

    const calcOn = lsFlag(LS_KEY_CALC);
    const reasonOn = lsFlag(LS_KEY_REASON);

    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      const btn = getAdjustButton(c);
      if (!btn) continue;

      const computed = finalizeCommission(computeCommission(c, ctx), c);
      if (!computed) continue;

      const saleTotal = getSaleTotal(c) || 0;
      const originalComm = getOriginalComm(c);

      let commentText = "";

      const hasPresetNote = !!(computed.note && computed.note.trim());
      const nU = (computed.name || "").toUpperCase();
      const _isAirPods = isAirPods(nU);
      let _isPrimary = isAppleProduct(nU, c) || isMainNonAppleProduct(nU, c);
      if (_isAirPods && ctx.hasRealPrimaryProduct) _isPrimary = false;

      if (
        originalComm != null &&
        originalComm > 0 &&
        computed.value > originalComm &&
        !hasPresetNote &&
        !_isPrimary && // Only use percentage comment for accessories/non-primary
        (calcOn || reasonOn)
      ) {
        commentText = `${fmtPercent(computed.rate)}%`;
      } else {
        commentText = buildWorkingText(
          computed.rate,
          saleTotal,
          computed.value,
          computed.baseRate,
          computed.multiplier,
          computed.note,
          calcOn,
          reasonOn
        );
      }

      setRunButtonsLabel(`Adjusting ${i + 1}/${targets.length}...`);

      btn.click();
      await sleep(220);

      const ok = await fillAndSaveModal({
        commissionValue: computed.value,
        commentText,
        reasonLabel: selectedReason,
      });

      if (!ok) {
        notify(`Stopped at ${i + 1}. Modal not found.`);
        return;
      }

      await sleep(250);
    }

    lastRunData = undoEntries;
    const undoBtnEl = document.getElementById("jbh-undo-btn");
    if (undoBtnEl) undoBtnEl.style.display = "block";

    notify("Done ✅");
    } finally {
      runBusy = false;
      endRunButtons();
      updateUIState();
    }
  }

  function getHostNextSaleBtn() {
    for (const b of document.querySelectorAll('button[aria-label="View Next Sale"]')) {
      if (b.id !== "jbh-eff-next-btn") return b;
    }
    return null;
  }

  function placeEffCluster(cluster, hostBtn) {
    const r = hostBtn.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      cluster.style.visibility = "hidden";
      return;
    }
    const w = cluster.offsetWidth || 260;
    const h = cluster.offsetHeight || 36;
    let left = r.left;
    let top = r.top + (r.height - h) / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    cluster.style.left = `${left}px`;
    cluster.style.top = `${top}px`;
    cluster.style.visibility = "visible";
  }

  function lockEffClusterSoon(hostBtn) {
    if (effClusterLocked) return;
    clearTimeout(effLockTimer);
    const startLeft = hostBtn.getBoundingClientRect().left;
    effLockTimer = setTimeout(() => {
      const host = getHostNextSaleBtn();
      const cluster = document.getElementById("jbh-eff-cluster");
      if (!host || !cluster) return;
      const left = host.getBoundingClientRect().left;
      if (Math.abs(left - startLeft) > 2) {
        lockEffClusterSoon(host);
        return;
      }
      placeEffCluster(cluster, host);
      effClusterLocked = true;
    }, 160);
  }

  function bindEffPosListeners() {
    if (effPosListening) return;
    effPosListening = true;
    const onViewportChange = () => {
      effClusterLocked = false;
      syncEfficiencyButton();
    };
    window.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("resize", onViewportChange);
  }

  function removeEffCluster() {
    clearTimeout(effLockTimer);
    effLockTimer = null;
    effClusterLocked = false;
    document.getElementById("jbh-eff-cluster")?.remove();
    document.documentElement.classList.remove("jbh-eff-on");
  }

  function syncEfficiencyButton(onOverview = isSaleOverview()) {
    const hostNext = getHostNextSaleBtn();
    const show = lsFlag(LS_KEY_EFFICIENCY) && !!hostNext && onOverview;

    if (!show) {
      removeEffCluster();
      return;
    }

    document.documentElement.classList.add("jbh-eff-on");
    bindEffPosListeners();

    let cluster = document.getElementById("jbh-eff-cluster");
    let nextBtn = document.getElementById("jbh-eff-next-btn");
    let runBtn = document.getElementById("jbh-eff-run-btn");

    if (!cluster) {
      cluster = document.createElement("div");
      cluster.id = "jbh-eff-cluster";
      cluster.style.visibility = "hidden";

      nextBtn = document.createElement("button");
      nextBtn.id = "jbh-eff-next-btn";
      nextBtn.className = "jbh-eff-btn";
      nextBtn.type = "button";
      nextBtn.textContent = "Next Sale";
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        getHostNextSaleBtn()?.click();
      });

      runBtn = document.createElement("button");
      runBtn.id = "jbh-eff-run-btn";
      runBtn.className = "jbh-eff-btn";
      runBtn.type = "button";
      runBtn.textContent = "Run Adjustment";
      runBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        autoFixZeros();
      });

      cluster.append(nextBtn, runBtn);
      document.body.appendChild(cluster);
    }

    nextBtn.disabled = !!hostNext.disabled;

    const main = document.getElementById("jbh-auto-btn");
    if (main?.classList.contains("processing") || runBusy) {
      runBtn.classList.add("processing");
      runBtn.disabled = true;
      if (main?.textContent) runBtn.textContent = main.textContent;
    } else {
      runBtn.classList.remove("processing");
      runBtn.disabled = false;
      runBtn.style.opacity = "";
      runBtn.style.cursor = "";
      runBtn.style.background = "";
      runBtn.style.color = "";
      if (runBtn.textContent !== "Run Adjustment") runBtn.textContent = "Run Adjustment";
    }

    if (effClusterLocked) return;
    cluster.style.visibility = "hidden";
    lockEffClusterSoon(hostNext);
  }

  function updateUIState() {
    const btn = document.getElementById("jbh-auto-btn");
    const onOverview = isSaleOverview();
    if (btn) {
      if (onOverview) {
        if (!btn.classList.contains("processing") && btn.textContent !== "Run Adjustment") {
          btn.textContent = "Run Adjustment";
          btn.disabled = false;
          btn.style.opacity = "1";
          btn.style.cursor = "pointer";
          btn.style.background = "";
          btn.style.color = "";
          btn.style.border = "";
        }
      } else {
        if (btn.textContent !== "Open a Sale to Adjust") {
          btn.textContent = "Open a Sale to Adjust";
          btn.disabled = true;
          btn.style.opacity = "0.5";
          btn.style.cursor = "not-allowed";
          btn.style.background = "#444";
          btn.style.color = "#aaa";
          btn.style.border = "2px solid transparent";
        }
        lastRunData = null;
      }
    }

    updateSaleSummary(onOverview);
    const undoBtnEl = document.getElementById("jbh-undo-btn");
    if (undoBtnEl) {
      undoBtnEl.style.display = lastRunData?.length && onOverview ? "block" : "none";
    }
    syncEfficiencyButton(onOverview);
  }

  function updateSaleSummary(isOnOverview) {
    const summaryEl = document.getElementById("jbh-sale-summary");
    if (!summaryEl) return;

    const wrap = document.getElementById("jbh-helper-wrap");
    if (!isOnOverview || (wrap && wrap.classList.contains("collapsed"))) {
      summaryEl.style.display = "none";
      return;
    }

    const preview = computeSalePreview();
    if (!preview || !preview.items.length) {
      summaryEl.style.display = "none";
      return;
    }

    summaryEl.style.display = "block";
    summaryEl.replaceChildren();

    const skipped = preview.totalCount - preview.targetCount;
    const head = el("div", "jbh-preview-head");
    const total = el("span", "jbh-preview-total", formatSignedMoney(preview.targetTotal));
    const meta = el(
      "span",
      "jbh-preview-meta",
      `${preview.targetCount} to write${skipped ? ` · ${skipped} skip` : ""}`
    );
    head.append(total, meta);
    summaryEl.appendChild(head);

    for (const item of preview.items) {
      const row = el("div", item.isTarget ? "jbh-preview-row" : "jbh-preview-row is-skip");
      row.append(
        el("span", "jbh-preview-name", item.name || "Unknown"),
        el(
          "span",
          "jbh-preview-val",
          `${fmtPercent(item.rate)}%  ${formatSignedMoney(item.value)}${item.keptOriginal ? " · kept" : ""}`
        )
      );
      summaryEl.appendChild(row);
    }
  }

  async function applySingleAdjustment(c, rate, noteOverride = null, absoluteValue = null) {
    if (selectedReason === "Other" && !(selectedOtherText || "").trim()) {
      notify("Please enter a comment when Other is selected.");
      return false;
    }
    const saleTotal = getSaleTotal(c) || 0;
    const val = absoluteValue != null ? trunc3(absoluteValue) : trunc3(saleTotal * rate);
    const btn = getAdjustButton(c);
    if (!btn) {
      notify("Adjust button not found");
      return false;
    }

    const pct = fmtPercent(rate) + "%";
    const commentText = noteOverride
      ? noteOverride
      : lsFlag(LS_KEY_CALC)
        ? `${pct} of $${saleTotal} = $${val}`
        : pct;

    btn.click();
    await sleep(200);
    const ok = await fillAndSaveModal({
      commissionValue: val,
      commentText,
      reasonLabel: selectedReason,
    });
    notify(ok ? `Applied ${pct}` : "Failed to apply adjustment");
    return ok;
  }

  function syncReasonUI() {
    document.querySelectorAll(".jbh-reason-select").forEach((select) => {
      if (select !== document.activeElement && select.value !== selectedReason) {
        select.value = selectedReason;
      }
    });
    document.querySelectorAll(".jbh-reason-comment").forEach((input) => {
      input.placeholder = selectedReason === "Other" ? "Required for Other" : "Optional note";
      if (input !== document.activeElement && input.value !== selectedOtherText) {
        input.value = selectedOtherText;
      }
    });
  }

  function buildReasonFields() {
    const box = el("div", "jbh-reason-box");
    box.appendChild(el("div", "jbh-field-label", "Reason"));
    const select = document.createElement("select");
    select.className = "jbh-reason-select";
    REASON_OPTIONS.forEach((reason) => {
      const opt = document.createElement("option");
      opt.value = reason;
      opt.textContent = reason;
      select.appendChild(opt);
    });
    select.value = selectedReason;
    select.addEventListener("change", () => {
      selectedReason = select.value;
      localStorage.setItem(LS_KEY_REASON_SELECT, selectedReason);
      syncReasonUI();
    });
    select.addEventListener("click", (e) => e.stopPropagation());
    const comment = document.createElement("input");
    comment.type = "text";
    comment.className = "jbh-reason-comment";
    comment.value = selectedOtherText;
    comment.placeholder = selectedReason === "Other" ? "Required for Other" : "Optional note";
    comment.addEventListener("input", () => {
      selectedOtherText = comment.value;
      localStorage.setItem(LS_KEY_REASON_OTHER_TEXT, selectedOtherText);
      syncReasonUI();
    });
    comment.addEventListener("click", (e) => e.stopPropagation());
    box.append(select, comment);
    return box;
  }

  function commissionTrackingId(r) {
    return `${r.name}|${r.rate}|${r.value}|${r.keptOriginal ? 1 : 0}`;
  }

  function injectRowInfo() {
    if (!isSaleOverview()) {
      $$(".jbh-row-info").forEach((el) => el.remove());
      return;
    }

    const containers = getProductContainers();
    if (!containers.length) {
      $$(".jbh-row-info").forEach((el) => el.remove());
      return;
    }

    const ctx = buildSaleContext(containers);
    const computedRows = containers.map((c) => ({
      c,
      result: finalizeCommission(computeCommission(c, ctx), c),
    }));
    const currentTrackingIds = new Set(
      computedRows.filter((row) => row.result).map((row) => commissionTrackingId(row.result))
    );

    $$(".jbh-row-info").forEach((el) => {
      if (isInHostModal(el) || !el.dataset.trackingId || !currentTrackingIds.has(el.dataset.trackingId)) {
        el.remove();
      }
    });

    if (obs) obs.disconnect();

    try {
        computedRows.forEach(({ c, result }) => {
            if (!result || isInHostModal(c)) return;

            const trackingId = commissionTrackingId(result);

            const nextEl = c.nextElementSibling;
            if (nextEl && nextEl.classList.contains("jbh-row-info")) {
              if (nextEl.dataset.trackingId === trackingId && nextEl.querySelector(".jbh-reason-comment")) {
                return;
              }
              nextEl.remove();
            }

            let kicker = result.label || "Suggested";
            if (result.keptOriginal) kicker = "Kept original";
            else if (ctx.appleCareSoldWithAppleAndOthers && result.multiplier === 2.5) kicker += " · AC ×2.5";
            else if (result.multiplier === 2) kicker += " · IPS ×2";
            else if (ctx.hasRealPrimaryProduct && isAirPods(result.name)) kicker += " · attached";

            const infoDiv = el("div", "jbh-row-info");
            infoDiv.dataset.trackingId = trackingId;

            const main = el("div", "jbh-row-main");
            const suggest = el("div", "jbh-row-suggest");
            suggest.append(
              el("div", "jbh-row-kicker", kicker),
              el("div", result.value < 0 ? "jbh-row-value is-neg" : "jbh-row-value",
                `${fmtPercent(result.rate)}%   ${formatSignedMoney(result.value)}`)
            );

            const applyBtn = el("button", "jbh-apply-btn", "Apply");
            applyBtn.type = "button";
            applyBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              applyBtn.disabled = true;
              applyBtn.textContent = "…";
              await applySingleAdjustment(c, result.rate, null, result.value);
              applyBtn.disabled = false;
              applyBtn.textContent = "Apply";
            });

            main.append(suggest, applyBtn);
            infoDiv.appendChild(main);
            infoDiv.appendChild(buildReasonFields());

            const more = el("div", "jbh-row-more");
            more.appendChild(el("div", "jbh-field-label", "Other rates"));
            const pctRow = el("div", "jbh-pct-row");
            [0.002, 0.005, 0.01, 0.015, 0.02, 0.023, 0.05].forEach((rate) => {
              const b = el("button", "jbh-pct-btn", fmtPercent(rate) + "%");
              b.type = "button";
              b.addEventListener("click", async (e) => {
                e.stopPropagation();
                b.disabled = true;
                await applySingleAdjustment(c, rate);
                b.disabled = false;
              });
              pctRow.appendChild(b);
            });

            const extra = el("div", "jbh-row-extra");
            const customInput = el("input", "jbh-custom-input");
            customInput.type = "text";
            customInput.placeholder = "Custom %";
            customInput.addEventListener("click", (e) => e.stopPropagation());
            customInput.addEventListener("keydown", async (e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();
              const raw = customInput.value.trim().replace(/%$/, "");
              const pct = parseFloat(raw);
              if (!raw || Number.isNaN(pct) || pct < 0 || pct > 100) {
                notify("Enter a % between 0 and 100");
                return;
              }
              customInput.disabled = true;
              await applySingleAdjustment(c, pct / 100);
              customInput.disabled = false;
              customInput.value = "";
            });

            const resetBtn = el("button", "jbh-reset-btn", "Reset $0");
            resetBtn.type = "button";
            resetBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              resetBtn.disabled = true;
              await applySingleAdjustment(c, 0, "Reset to $0");
              resetBtn.disabled = false;
            });

            extra.append(customInput, resetBtn);
            more.append(pctRow, extra);
            infoDiv.appendChild(more);
            c.insertAdjacentElement("afterend", infoDiv);
        });
    } catch(e) {
        console.error("JBH Helper Error:", e);
    } finally {
        if (obs) obs.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function addUIIfMissing() {
    if (document.getElementById("jbh-dock")) {
        updateUIState();
        return;
    }

    // --- STYLES ---
    if (!document.getElementById("jbh-helper-styles")) {
      const style = document.createElement("style");
      style.id = "jbh-helper-styles";
      style.textContent = `
        #jbh-dock {
            position: fixed;
            right: 20px;
            bottom: 20px;
            left: auto;
            top: auto;
            z-index: 2147483647;
            display: flex;
            flex-direction: row;
            align-items: flex-end;
            gap: 10px;
            font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
            user-select: none;
            opacity: 0;
            animation: jbh-fade-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        #jbh-helper-wrap {
            position: relative;
            display: flex;
            flex-direction: column;
            flex: 0 0 auto;
            font-family: inherit;
            background: ${THEME.bg};
            backdrop-filter: blur(${THEME.blur});
            border-radius: ${THEME.radius};
            border: ${THEME.border};
            box-shadow: ${THEME.shadow};
            color: ${THEME.textMain};
            min-width: 260px;
            min-height: 150px;
            max-width: 90vw;
            max-height: 90vh;
            overflow: hidden;
            user-select: none;
        }

        #jbh-helper-wrap::before {
            content: "";
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background-image: ${THEME.noise};
            opacity: ${THEME.noiseOpacity};
            pointer-events: none;
            z-index: -1;
        }

        #jbh-dock.dragging #jbh-helper-wrap {
            cursor: grabbing !important;
            box-shadow: ${THEME.shadowLift};
        }

        #jbh-helper-wrap.resizing {
            cursor: nwse-resize !important;
        }

        #jbh-helper-wrap .jbh-row input[type="checkbox"] {
            position: absolute;
            opacity: 0;
            width: 0;
            height: 0;
            margin: 0;
            pointer-events: none;
        }

        .jbh-drag-handle {
            padding: 14px 18px;
            cursor: grab;
            background: rgba(255, 255, 255, 0.03);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }

        .jbh-drag-handle:active {
            cursor: grabbing;
        }

        .jbh-drag-handle:hover {
            background: rgba(255, 255, 255, 0.06);
        }

        .jbh-content {
            padding: 18px;
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }

        .jbh-content-scrollable {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            display: flex;
            flex-direction: column;
            gap: 14px;
            min-height: 0;
            padding-right: 6px;
        }

        .jbh-content-scrollable::-webkit-scrollbar {
            width: 4px;
        }

        .jbh-content-scrollable::-webkit-scrollbar-track {
            background: transparent;
        }

        .jbh-content-scrollable::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
        }

        .jbh-content-scrollable::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .jbh-button-container {
            margin-top: 14px;
            flex-shrink: 0;
            padding-top: 14px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }

        .jbh-resize-handle {
            position: absolute;
            background: transparent;
            border: 1px solid transparent;
            z-index: 10;
            transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
        }
        .jbh-resize-handle:hover {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.25);
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
        }
        .jbh-resize-handle.n { top: 0; left: 0; right: 0; height: 8px; cursor: ns-resize; }
        .jbh-resize-handle.s { bottom: 0; left: 0; right: 0; height: 8px; cursor: ns-resize; }
        .jbh-resize-handle.e { top: 0; right: 0; bottom: 0; width: 8px; cursor: ew-resize; }
        .jbh-resize-handle.w { top: 0; left: 0; bottom: 0; width: 8px; cursor: ew-resize; }
        .jbh-resize-handle.ne { top: 0; right: 0; width: 16px; height: 16px; cursor: nesw-resize; }
        .jbh-resize-handle.nw { top: 0; left: 0; width: 16px; height: 16px; cursor: nwse-resize; }
        .jbh-resize-handle.se { bottom: 0; right: 0; width: 16px; height: 16px; cursor: nwse-resize; }
        .jbh-resize-handle.sw { bottom: 0; left: 0; width: 16px; height: 16px; cursor: nesw-resize; }
        #jbh-auto-btn.processing:hover {
            background: #FF9500;
            transform: translateY(0);
        }

        #jbh-helper-wrap.collapsed {
            min-height: auto;
            height: auto !important;
        }
        #jbh-helper-wrap.collapsed .jbh-content {
            display: none;
        }
        #jbh-helper-wrap.collapsed .jbh-resize-handle {
            display: none;
        }

        .jbh-minimize-btn {
            background: none;
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 14px;
            padding: 0 6px;
            flex-shrink: 0;
            transition: color 0.2s;
            line-height: 1;
        }
        .jbh-minimize-btn:hover {
            color: #fff;
        }

        .jbh-custom-input {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            border: ${THEME.border};
            border-radius: 10px;
            padding: 6px 10px;
            color: ${THEME.textMain};
            font-size: 12px;
            outline: none;
            min-width: 0;
            font-family: inherit;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .jbh-custom-input:focus {
            border-color: ${THEME.accent};
            box-shadow: 0 0 0 1px ${THEME.accent}22;
        }
        .jbh-custom-input::placeholder {
            color: ${THEME.textDark};
        }

        @keyframes jbh-fade-in {
            from { opacity: 0; transform: translateY(15px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .jbh-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: ${THEME.textDim};
            flex: 1;
        }

        .jbh-drag-icon {
            width: 16px;
            height: 16px;
            opacity: 0.3;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .jbh-drag-icon::before {
            content: "⋮⋮";
            font-size: 12px;
            color: #fff;
        }

        .jbh-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            gap: 12px;
            min-height: 36px;
            padding: 4px 0;
            color: ${THEME.textMain};
        }

        .jbh-row span {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .jbh-switch {
            position: relative;
            width: 36px;
            height: 20px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            flex-shrink: 0;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .jbh-switch::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 14px;
            height: 14px;
            background: white;
            border-radius: 50%;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        input:checked + .jbh-switch {
            background: ${THEME.accent};
            border-color: rgba(0, 0, 0, 0.1);
        }
        input:checked + .jbh-switch::after {
            transform: translateX(16px);
        }

        #jbh-auto-btn {
            width: 100%;
            padding: 14px 0;
            border-radius: 12px;
            border: 2px solid transparent;
            background: ${THEME.textMain};
            color: ${THEME.bgSolid};
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }

        #jbh-auto-btn:hover {
            background: ${THEME.accent};
            color: #fff;
            border-color: transparent;
        }

        #jbh-auto-btn:active {
            transform: translateY(0);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        #jbh-auto-btn.processing {
            background: #FF9500;
            color: white;
            cursor: wait;
            animation: jbh-pulse 1.5s infinite;
        }

        #jbh-confirm-overlay {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
            box-sizing: border-box;
            background: transparent;
            z-index: 2147483647;
        }
        .jbh-confirm-scrim {
            position: absolute;
            inset: 0;
            background: rgba(8, 8, 12, 0.62);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            cursor: pointer;
            z-index: 0;
        }
        #jbh-confirm-dialog {
            position: relative;
            z-index: 1;
            isolation: isolate;
            box-sizing: border-box;
            cursor: default;
            width: min(420px, 100%);
            max-height: 100%;
            display: flex;
            flex-direction: column;
            gap: 20px;
            padding: 28px;
            overflow: hidden;
            color: ${THEME.textMain};
            background: ${THEME.bgSolid};
            border-radius: ${THEME.radius};
            border: ${THEME.border};
            box-shadow: ${THEME.shadow};
            font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
            animation: jbh-fade-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .jbh-confirm-noise {
            position: absolute;
            inset: 0;
            background-image: ${THEME.noise};
            opacity: ${THEME.noiseOpacity};
            pointer-events: none;
            z-index: 0;
        }
        .jbh-confirm-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: ${THEME.textDim};
            text-align: center;
            flex-shrink: 0;
            position: relative;
            z-index: 1;
        }
        .jbh-confirm-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            overflow-y: auto;
            flex: 1 1 auto;
            min-height: 0;
            padding: 4px 0;
            position: relative;
            z-index: 1;
        }
        .jbh-confirm-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 13px;
            padding: 10px 14px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            opacity: 0.4;
        }
        .jbh-confirm-row.is-target {
            background: ${THEME.accent}10;
            border: 1px solid ${THEME.accent}22;
            opacity: 1;
        }
        .jbh-confirm-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-right: 12px;
            font-weight: 500;
        }
        .jbh-confirm-val {
            font-weight: 700;
            flex-shrink: 0;
            color: ${THEME.textDim};
            font-size: 14px;
        }
        .jbh-confirm-row.is-target .jbh-confirm-val {
            color: ${THEME.accent};
        }
        .jbh-confirm-total {
            text-align: center;
            font-size: 14px;
            font-weight: 500;
            padding: 16px 0 0;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            flex-shrink: 0;
            position: relative;
            z-index: 1;
        }
        .jbh-confirm-total-label {
            color: ${THEME.textDim};
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            display: block;
            margin-bottom: 4px;
        }
        .jbh-confirm-total-value {
            color: ${THEME.accent};
            font-weight: 800;
            font-size: 24px;
        }
        .jbh-confirm-total-meta {
            color: ${THEME.textDark};
            font-size: 11px;
            margin-top: 4px;
        }
        .jbh-confirm-actions {
            display: flex;
            gap: 12px;
            flex-shrink: 0;
            position: relative;
            z-index: 1;
        }
        .jbh-confirm-cancel,
        .jbh-confirm-ok {
            padding: 14px;
            border-radius: 12px;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s;
        }
        .jbh-confirm-cancel {
            flex: 1;
            flex-shrink: 0;
            border: 1px solid rgba(255, 255, 255, 0.22);
            background: rgba(255, 255, 255, 0.14);
            color: #fff;
            font-weight: 600;
        }
        .jbh-confirm-cancel:hover {
            background: rgba(255, 255, 255, 0.22);
        }
        .jbh-confirm-ok {
            flex: 1.5;
            border: none;
            background: ${THEME.textMain};
            color: ${THEME.bgSolid};
            font-weight: 700;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }
        .jbh-confirm-ok:hover {
            background: ${THEME.accent};
            color: #fff;
            transform: translateY(-2px);
            box-shadow: 0 8px 25px ${THEME.accent}44;
        }
        .jbh-eff-confirm-btn {
            position: fixed !important;
            z-index: 2147483647 !important;
            box-sizing: border-box;
        }

        html.jbh-eff-on button[aria-label="View Next Sale"]:not(#jbh-eff-next-btn) {
            visibility: hidden !important;
            pointer-events: none !important;
            transition: none !important;
            animation: none !important;
            transform: none !important;
        }

        #jbh-eff-cluster {
            position: fixed;
            z-index: 2147483646;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .jbh-eff-btn {
            margin: 0;
            height: 36px;
            padding: 0 12px;
            border: none;
            border-radius: 8px;
            background: ${THEME.accent};
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.01em;
            cursor: pointer;
            white-space: nowrap;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
        }
        .jbh-eff-btn:hover:not(:disabled):not(.processing) {
            background: ${THEME.bgSolid};
            color: ${THEME.textMain};
        }
        .jbh-eff-btn:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }
        #jbh-eff-run-btn.processing {
            background: #FF9500;
            cursor: wait;
            animation: jbh-pulse 1.5s infinite;
        }

        @keyframes jbh-pulse {
            0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(255, 149, 0, 0.4); }
            50% { opacity: 0.8; box-shadow: 0 0 0 10px rgba(255, 149, 0, 0); }
        }

        #jbh-undo-btn {
            width: 100%;
            padding: 10px 0;
            border-radius: 10px;
            border: 1px solid rgba(255, 59, 48, 0.2);
            background: rgba(255, 59, 48, 0.05);
            color: #FF453A;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 10px;
            display: none;
        }
        #jbh-undo-btn:hover {
            background: rgba(255, 59, 48, 0.15);
            border-color: rgba(255, 59, 48, 0.4);
        }

        #jbh-sale-summary {
            padding: 10px 12px;
            background: rgba(255, 255, 255, 0.04);
            border-radius: 14px;
            border: ${THEME.border};
        }
        .jbh-preview-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
        }
        .jbh-preview-total {
            font-size: 20px;
            font-weight: 800;
            color: ${THEME.accent};
            font-variant-numeric: tabular-nums;
        }
        .jbh-preview-meta {
            font-size: 11px;
            color: ${THEME.textDark};
            flex-shrink: 0;
        }
        .jbh-preview-row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 11px;
            padding: 3px 0;
        }
        .jbh-preview-row.is-skip { opacity: 0.45; }
        .jbh-preview-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #ccc;
        }
        .jbh-preview-val {
            flex-shrink: 0;
            font-weight: 600;
            color: ${THEME.accent};
            font-variant-numeric: tabular-nums;
        }
        .jbh-preview-row.is-skip .jbh-preview-val { color: #888; }

        .jbh-reason-box {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 10px;
            position: relative;
            z-index: 1;
        }
        .jbh-field-label {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            color: ${THEME.textDark};
        }
        .jbh-reason-select, .jbh-reason-comment {
            width: 100%;
            box-sizing: border-box;
            padding: 9px 10px;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.06);
            color: ${THEME.textMain};
            font-size: 13px;
            font-family: inherit;
            outline: none;
        }
        .jbh-reason-select:focus, .jbh-reason-comment:focus {
            border-color: ${THEME.accent};
        }
        .jbh-reason-select option { background: #121218; color: #fff; }

        .jbh-settings {
            border-top: 1px solid rgba(255,255,255,0.06);
            padding-top: 8px;
        }
        .jbh-settings > summary {
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.6px;
            text-transform: uppercase;
            color: ${THEME.textDark};
            list-style: none;
            padding: 6px 0;
        }
        .jbh-settings > summary::-webkit-details-marker { display: none; }
        .jbh-settings > summary::after { content: " ▾"; }
        .jbh-settings[open] > summary::after { content: " ▴"; }

        .jbh-row-info {
            margin-top: 10px;
            padding: 12px 14px;
            background: ${THEME.bg};
            backdrop-filter: blur(${THEME.blur});
            border: ${THEME.border};
            border-radius: 16px;
            box-shadow: ${THEME.shadow};
            color: ${THEME.textMain};
            font-family: -apple-system, BlinkMacSystemFont, Inter, Segoe UI, Roboto, sans-serif;
            position: relative;
            overflow: hidden;
        }
        .jbh-row-main {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            position: relative;
            z-index: 1;
        }
        .jbh-row-kicker {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.6px;
            text-transform: uppercase;
            color: ${THEME.textDim};
            margin-bottom: 2px;
        }
        .jbh-row-value {
            font-size: 18px;
            font-weight: 700;
            color: ${THEME.accent};
            font-variant-numeric: tabular-nums;
        }
        .jbh-row-value.is-neg { color: #FF453A; }
        .jbh-apply-btn {
            flex-shrink: 0;
            border: none;
            background: ${THEME.textMain};
            color: ${THEME.bgSolid};
            font-weight: 700;
            font-size: 13px;
            padding: 10px 18px;
            border-radius: 10px;
            cursor: pointer;
            font-family: inherit;
        }
        .jbh-apply-btn:hover { background: ${THEME.accent}; color: #fff; }
        .jbh-apply-btn:disabled { opacity: 0.5; cursor: wait; }
        .jbh-row-more {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid rgba(255,255,255,0.06);
            position: relative;
            z-index: 1;
        }
        .jbh-pct-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 8px;
        }
        .jbh-pct-btn {
            border: 1px solid rgba(255,255,255,0.08);
            background: rgba(255,255,255,0.05);
            color: #fff;
            border-radius: 8px;
            padding: 6px 10px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
        }
        .jbh-pct-btn:hover { background: rgba(255,255,255,0.12); }
        .jbh-pct-btn:disabled { opacity: 0.5; }
        .jbh-row-extra {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .jbh-reset-btn {
            border: 1px solid rgba(255, 69, 58, 0.3);
            background: rgba(255, 69, 58, 0.08);
            color: #FF453A;
            border-radius: 8px;
            padding: 6px 10px;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
            font-family: inherit;
        }
        .jbh-reset-btn:hover { background: rgba(255, 69, 58, 0.18); }

        .jbh-toast {
            background: ${THEME.bg};
            backdrop-filter: blur(${THEME.blur});
            -webkit-backdrop-filter: blur(${THEME.blur});
            color: ${THEME.textMain};
            padding: 12px 20px;
            border-radius: 30px;
            border: ${THEME.border};
            font-size: 13px;
            font-weight: 500;
            box-shadow: ${THEME.shadow};
            position: relative;
            overflow: hidden;
        }
        .jbh-toast::before {
            content: "";
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background-image: ${THEME.noise};
            opacity: ${THEME.noiseOpacity};
            pointer-events: none;
            z-index: -1;
        }
        .jbh-toast.hiding {
            opacity: 0;
            transform: scale(0.9) translateY(10px);
            margin-bottom: -40px;
        }

        #jbh-tooltip {
            position: fixed;
            top: 0;
            left: 0;
            transform: translateX(-10px) translateY(-50%);
            background: ${THEME.bg};
            backdrop-filter: blur(${THEME.blur});
            -webkit-backdrop-filter: blur(${THEME.blur});
            color: ${THEME.textMain};
            padding: 12px 16px;
            border-radius: 14px;
            font-size: 14px;
            font-weight: 500;
            line-height: 1.4;
            white-space: pre-line;
            width: 260px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
            border: ${THEME.border};
            box-shadow: ${THEME.shadow};
            z-index: 2147483648;
            overflow: hidden;
        }
        #jbh-tooltip::before {
            content: "";
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background-image: ${THEME.noise};
            opacity: ${THEME.noiseOpacity};
            pointer-events: none;
            z-index: -1;
        }
        #jbh-tooltip::after {
            content: '';
            position: absolute;
            top: 50%;
            right: -8px;
            transform: translateY(-50%);
            border-width: 8px 0 8px 8px;
            border-style: solid;
            border-color: transparent transparent transparent ${THEME.bgSolid};
        }
        #jbh-tooltip.visible {
            opacity: 1;
        }
      `;
      document.head.appendChild(style);
    }

    const dock = document.createElement("div");
    dock.id = "jbh-dock";

    const wrap = document.createElement("div");
    wrap.id = "jbh-helper-wrap";

    const savedSize = localStorage.getItem("jbh-wrap-size");
    const savedPos = localStorage.getItem("jbh-wrap-position");
    dock.style.right = "20px";
    dock.style.bottom = "20px";
    dock.style.left = "auto";
    dock.style.top = "auto";
    if (savedPos) {
      try {
        const pos = JSON.parse(savedPos);
        const left = parseInt(pos.left, 10);
        const top = parseInt(pos.top, 10);
        if (!isNaN(left) && !isNaN(top)) {
          dock.style.left = `${left}px`;
          dock.style.top = `${top}px`;
          dock.style.right = "auto";
          dock.style.bottom = "auto";
        }
      } catch {
        localStorage.removeItem("jbh-wrap-position");
      }
    }

    if (savedSize) {
      try {
        const size = JSON.parse(savedSize);
        const w = parseInt(size.width, 10);
        const h = parseInt(size.height, 10);
        if (!isNaN(w) && w >= 200 && w <= window.innerWidth) {
          wrap.style.width = size.width;
        }
        if (!isNaN(h) && h >= 150 && h <= window.innerHeight) {
          wrap.style.height = size.height;
        }
      } catch {
        localStorage.removeItem("jbh-wrap-size");
      }
    } else {
      wrap.style.width = "280px";
    }

    let tooltip = document.getElementById("jbh-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "jbh-tooltip";
      document.body.appendChild(tooltip);
    }

    const dragHandle = document.createElement("div");
    dragHandle.className = "jbh-drag-handle";
    const title = document.createElement("div");
    title.className = "jbh-title";
    title.textContent = "Commission Helper";

    const isCollapsedOnLoad = lsFlag(LS_KEY_COLLAPSED);
    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "jbh-minimize-btn";
    minimizeBtn.textContent = isCollapsedOnLoad ? "+" : "\u2212";
    minimizeBtn.title = "Minimize / Expand";
    minimizeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isCollapsed = wrap.classList.toggle("collapsed");
      localStorage.setItem(LS_KEY_COLLAPSED, isCollapsed ? "true" : "false");
      minimizeBtn.textContent = isCollapsed ? "+" : "\u2212";
    });
    if (isCollapsedOnLoad) {
      wrap.classList.add("collapsed");
    }

    const dragIcon = document.createElement("div");
    dragIcon.className = "jbh-drag-icon";
    dragHandle.appendChild(title);
    dragHandle.appendChild(minimizeBtn);
    dragHandle.appendChild(dragIcon);
    wrap.appendChild(dragHandle);

    const content = document.createElement("div");
    content.className = "jbh-content";
    wrap.appendChild(content);

    const createToggle = (key, labelText, tooltipText, defaultOn = false, onChange) => {
        const label = document.createElement("label");
        label.className = "jbh-row";
        label.style.position = "relative"; 
        
        const span = document.createElement("span");
        span.textContent = labelText;
        
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = lsFlag(key, defaultOn);
        input.addEventListener("change", () => {
            localStorage.setItem(key, input.checked ? "true" : "false");
            onChange?.(input.checked);
        });

        const sw = document.createElement("div");
        sw.className = "jbh-switch";

        label.append(span, input, sw);

        label.addEventListener("mouseenter", () => {
            if (!tooltipText?.trim()) return;
            tooltip.textContent = tooltipText;
            const rect = label.getBoundingClientRect();
            const wrapRect = wrap.getBoundingClientRect();
            tooltip.style.top = `${rect.top + rect.height / 2}px`;
            if (wrapRect.left < 280) {
              tooltip.style.left = `${wrapRect.right + 10}px`;
              tooltip.style.transform = "translateY(-50%)";
            } else {
              tooltip.style.left = `${wrapRect.left - 10}px`;
              tooltip.style.transform = "translateX(-100%) translateY(-50%)";
            }
            tooltip.classList.add("visible");
        });

        label.addEventListener("mouseleave", () => {
            tooltip.classList.remove("visible");
        });

        return label;
    };

    const scrollableContent = document.createElement("div");
    scrollableContent.className = "jbh-content-scrollable";

    const summary = document.createElement("div");
    summary.id = "jbh-sale-summary";
    summary.style.display = "none";
    scrollableContent.appendChild(summary);

    const settings = el("details", "jbh-settings");
    settings.appendChild(el("summary", "", "Options"));
    settings.appendChild(createToggle(LS_KEY_ONLY_ZERO, "$0 only", "Only adjust lines that currently have $0 commission.", true));
    settings.appendChild(createToggle(LS_KEY_CALC, "Add formula", "Include the calculation in the comment (e.g. 0.5% of $1000 = $5)."));
    settings.appendChild(createToggle(LS_KEY_REASON, "Add note", "Include the explanation note (IPS, AppleCare, solo product, etc.)."));
    settings.appendChild(createToggle(LS_KEY_CONFIRM, "Confirm first", "Preview every line before writing.", true));
    settings.appendChild(createToggle(
      LS_KEY_EFFICIENCY,
      "Efficiency",
      "Show Run Adjustment next to View Next Sale so you can adjust and move on with less mouse travel.",
      false,
      () => syncEfficiencyButton()
    ));
    scrollableContent.appendChild(settings);

    content.appendChild(scrollableContent);

    const buttonContainer = document.createElement("div");
    buttonContainer.className = "jbh-button-container";
    const btn = document.createElement("button");
    btn.id = "jbh-auto-btn";
    btn.textContent = "Run Adjustment";
    btn.addEventListener("click", autoFixZeros);
    buttonContainer.appendChild(btn);

    const undoBtnEl = document.createElement("button");
    undoBtnEl.id = "jbh-undo-btn";
    undoBtnEl.textContent = "Undo Last Run";
    undoBtnEl.addEventListener("click", undoLastRun);
    buttonContainer.appendChild(undoBtnEl);

    content.appendChild(buttonContainer);

    const resizeHandles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    resizeHandles.forEach(direction => {
      const handle = document.createElement("div");
      handle.className = `jbh-resize-handle ${direction}`;
      wrap.appendChild(handle);
    });

    function isDockCustomPos() {
      return !!(dock.style.left && dock.style.left !== "auto");
    }

    function applyDockPos(left, top) {
      const maxLeft = Math.max(0, window.innerWidth - dock.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - dock.offsetHeight);
      dock.style.left = `${Math.max(0, Math.min(left, maxLeft))}px`;
      dock.style.top = `${Math.max(0, Math.min(top, maxTop))}px`;
      dock.style.right = "auto";
      dock.style.bottom = "auto";
    }

    function saveDockPos() {
      if (!isDockCustomPos()) {
        localStorage.removeItem("jbh-wrap-position");
        return;
      }
      const r = dock.getBoundingClientRect();
      localStorage.setItem("jbh-wrap-position", JSON.stringify({
        left: `${r.left}px`,
        top: `${r.top}px`,
      }));
    }

    function keepDockInViewport() {
      const maxW = Math.max(200, window.innerWidth - 40);
      const maxH = Math.max(150, window.innerHeight - 40);
      if (wrap.offsetWidth > maxW) wrap.style.width = `${maxW}px`;
      if (wrap.offsetHeight > maxH) wrap.style.height = `${maxH}px`;
      if (!isDockCustomPos()) {
        dock.style.right = "20px";
        dock.style.bottom = "20px";
        dock.style.left = "auto";
        dock.style.top = "auto";
        return;
      }
      const r = dock.getBoundingClientRect();
      applyDockPos(r.left, r.top);
    }

    window.addEventListener("resize", keepDockInViewport);
    window.visualViewport?.addEventListener("resize", keepDockInViewport);

    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragOriginLeft = 0;
    let dragOriginTop = 0;

    dragHandle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".jbh-minimize-btn")) return;
      if (e.target.closest(".jbh-resize-handle")) return;
      isDragging = true;
      dock.classList.add("dragging");
      const rect = dock.getBoundingClientRect();
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragOriginLeft = rect.left;
      dragOriginTop = rect.top;
      applyDockPos(dragOriginLeft, dragOriginTop);
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      applyDockPos(dragOriginLeft + e.clientX - dragStartX, dragOriginTop + e.clientY - dragStartY);
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      dock.classList.remove("dragging");
      saveDockPos();
    });

    let isResizing = false;
    let resizeDirection = "";
    let resizeStartX = 0;
    let resizeStartY = 0;
    let initialWidth = 0;
    let initialHeight = 0;
    let initialDockLeft = 0;
    let initialDockTop = 0;
    let resizeFromCustom = false;

    wrap.style.left = "";
    wrap.style.top = "";

    resizeHandles.forEach((direction) => {
      const handle = wrap.querySelector(`.jbh-resize-handle.${direction}`);
      handle.addEventListener("mousedown", (e) => {
        isResizing = true;
        resizeDirection = direction;
        wrap.classList.add("resizing");
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        const wrapRect = wrap.getBoundingClientRect();
        const dockRect = dock.getBoundingClientRect();
        initialWidth = wrapRect.width;
        initialHeight = wrapRect.height;
        initialDockLeft = dockRect.left;
        initialDockTop = dockRect.top;
        resizeFromCustom = isDockCustomPos();
        if (resizeFromCustom) applyDockPos(initialDockLeft, initialDockTop);
        wrap.style.left = "";
        wrap.style.top = "";
        e.preventDefault();
        e.stopPropagation();
      });
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      e.preventDefault();
      const deltaX = e.clientX - resizeStartX;
      const deltaY = e.clientY - resizeStartY;
      let newWidth = initialWidth;
      let newHeight = initialHeight;

      if (resizeDirection.includes("e")) newWidth = initialWidth + deltaX;
      if (resizeDirection.includes("w")) newWidth = initialWidth - deltaX;
      if (resizeDirection.includes("s")) newHeight = initialHeight + deltaY;
      if (resizeDirection.includes("n")) newHeight = initialHeight - deltaY;

      newWidth = Math.max(200, Math.min(newWidth, window.innerWidth - 40));
      newHeight = Math.max(150, Math.min(newHeight, window.innerHeight - 40));

      wrap.style.width = `${newWidth}px`;
      wrap.style.height = `${newHeight}px`;

      if (resizeFromCustom) {
        let left = initialDockLeft;
        let top = initialDockTop;
        if (resizeDirection.includes("w")) left = initialDockLeft - (newWidth - initialWidth);
        if (resizeDirection.includes("n")) top = initialDockTop - (newHeight - initialHeight);
        applyDockPos(left, top);
      }
    });

    document.addEventListener("mouseup", () => {
      if (!isResizing) return;
      isResizing = false;
      wrap.classList.remove("resizing");
      keepDockInViewport();
      const rect = wrap.getBoundingClientRect();
      localStorage.setItem("jbh-wrap-size", JSON.stringify({
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }));
      if (resizeFromCustom) saveDockPos();
    });

    dock.appendChild(wrap);
    document.body.appendChild(dock);
    keepDockInViewport();
    updateUIState();
  }

  addUIIfMissing();
  obs = new MutationObserver(() => {
    if (updateTimer) return;
    updateTimer = setTimeout(() => {
      updateTimer = null;
      addUIIfMissing();
      injectRowInfo();
    }, 150);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();

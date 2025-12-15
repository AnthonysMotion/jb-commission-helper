
// ==UserScript==
// @name         JB Commission Helper
// @namespace    jb-commission-helper
// @version      8.1
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

  function parseMoney(txt) {
    if (!txt) return 0;
    return Number(txt.replace(/[^0-9.]/g, ""));
  }

  function text(el) {
    return (el?.textContent || "").trim();
  }

  // Truncate to 3 decimal places (no rounding)
  function trunc3(x) {
    if (x == null || Number.isNaN(x)) return x;
    return Math.trunc(x * 1000) / 1000;
  }

  function fmtPercent(rate) {
    const p = rate * 100;
    return String(p)
      .replace(/(\.\d*?[1-9])0+$/, "$1")
      .replace(/\.0$/, "");
  }

  // --- DOM TRAVERSAL ---
  function getProductContainers() {
    const skuPs = $$("p").filter((p) => text(p).startsWith("SKU:"));
    const containers = [];

    for (const skuP of skuPs) {
      let node = skuP;
      let container = null;

      for (let i = 0; i < 8 && node; i++) {
        if (text(node).includes("Sale Total:")) {
          container = node;
          break;
        }
        node = node.parentElement;
      }
      container = container || skuP.parentElement;
      containers.push(container);
    }
    return containers;
  }

  function getSaleTotal(container) {
    const saleB = $$("b", container).find((b) => text(b) === "Sale Total:");
    if (!saleB) return null;
    const span = saleB.closest("span") || saleB.parentElement;
    const valP = span?.querySelector("p");
    return parseMoney(text(valP));
  }

  function getOriginalComm(container) {
    const commB = $$("b", container).find((b) => text(b) === "Comm:");
    if (!commB) return null;
    const span = commB.closest("span") || commB.parentElement;
    const valP = span?.querySelector("p");
    return parseMoney(text(valP));
  }

  function getAdjustButton(container) {
    return $$("button", container).find((btn) =>
      text(btn).includes("Add/Edit Adjustment")
    );
  }

  function getSKU(container) {
    const skuP = $$("p", container).find((p) => text(p).startsWith("SKU:"));
    if (!skuP) return null;
    const skuText = text(skuP);
    // Extract SKU number (format: "SKU: 123456" or "SKU: 123456 (Q)")
    const m = skuText.match(/SKU:\s*(\d+)/i);
    return m ? m[1] : null;
  }

  function getStockType(container) {
    const skuP = $$("p", container).find((p) => text(p).startsWith("SKU:"));
    const skuText = text(skuP);
    const m = skuText.match(/\(([A-Z])\)/i);
    return m ? m[1].toUpperCase() : null;
  }

  function getProductName(container) {
    const ps = $$("p", container).map((p) => text(p)).filter(Boolean);
    const candidates = ps.filter(
      (t) =>
        !t.startsWith("SKU:") &&
        !t.includes("Qty:") &&
        !t.includes("Sale Total:") &&
        !t.includes("Cost:") &&
        !t.includes("Go Price:") &&
        !t.includes("Comm:") &&
        t.length > 3
    );
    if (!candidates.length) return "";

    // Prioritize likely product names over descriptions
    const scored = candidates.map((c) => {
      let score = c.length;
      const upper = c.toUpperCase();
      if (
        /IPHONE|2D SAMSUNG|MACBOOK|IMAC|MAC|IPAD|WATCH|SURFACE|LAPTOP|GALAXY|TABLET/i.test(
          upper
        )
      )
        score += 200;
      if (
        /\b(64|128|256|512)\s*GB\b/i.test(upper) ||
        /\b[12]\s*TB\b/i.test(upper)
      )
        score += 50;
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

  // --- PRODUCT CATEGORIZATION ---

  // SKU Lists (Highest Priority - checked before name-based detection)
  const SKU_MAIN_PRODUCTS = new Set([
    // MacBook Pro SKUs
    "465729", // MacBook Pro 14" M5 512GB/16GB Space Black
    "465733", // MacBook Pro 14" M5 1TB/24GB Space Black
    "448451", // MacBook Pro 14" M4 Pro 512GB/24GB Space Black
    "448452", // MacBook Pro 14" M4 Pro 512GB/24GB Silver
    "465734", // Apple MacBook Pro 14-inch with M5 Chip, 1TB/24GB (Silver)
    "465730", // Apple MacBook Pro 14-inch with M5 Chip, 512GB/16GB (Silver)
    "465731", // Apple MacBook Pro 14-inch with M5 Chip, 1TB/16GB (Space Black)
    "465732", // Apple MacBook Pro 14-inch with M5 Chip, 1TB/16GB (Silver)

    // MacBook Air SKUs
    "453376", // MacBook Air 13" M4 256GB/16GB Midnight
    "453376", // MacBook Air 13" M4 256GB/16GB Silver
    "453378", // MacBook Air 13" M4 256GB/16GB Starlight
    "453379", // MacBook Air 13" M4 256GB/16GB Sky Blue

    "453379", // MacBook Air 13" M4 512GB/16GB Starlight
    "453381", // MacBook Air 13" M4 512GB/16GB Midnight
    "453377", // MacBook Air 13" M4 512GB/16GB Silver
    "453371", // MacBook Air 13" M4 512GB/16GB Sky Blue


    "448417", // MacBook Air 13" M2 256GB/16GB Midnight
    "448416", // MacBook Air 13" M2 256GB/16GB Starlight

    "453382", // Apple MacBook Air 15-inch with M4 Chip, 256GB/16GB (Silver)
    "453384", // Apple MacBook Air 15-inch with M4 Chip, 256GB/16GB (Starlight)
    "453386", // Apple MacBook Air 15-inch with M4 Chip, 256GB/16GB (Midnight)
    "453373", // Apple MacBook Air 15-inch with M4 Chip, 256GB/16GB (Sky Blue)
    
    "453383", // Apple MacBook Air 15-inch with M4 Chip, 512GB/16GB (Silver)
    "453385", // Apple MacBook Air 15-inch with M4 Chip, 512GB/16GB (Starlight)
    "453387", // Apple MacBook Air 15-inch with M4 Chip, 512GB/16GB (Midnight)
    "453374", // Apple MacBook Air 15-inch with M4 Chip, 512GB/16GB (Sky Blue)
  ]);

  // Attach/Accessory SKUs by category
  const SKU_ATTACH_IPHONE = new Set([
  ]);

  const SKU_ATTACH_MACBOOK = new Set([
  ]);

  const SKU_ATTACH_IPAD = new Set([
  ]);

  const SKU_ATTACH_CAMERA = new Set([
  ]);

  const SKU_ATTACH_GENERAL = new Set([
  ]);

  // Helper function to check if SKU is in any attach list
  function getSKUAttachCategory(sku) {
    if (!sku) return null;
    if (SKU_ATTACH_IPHONE.has(sku)) return "iphone";
    if (SKU_ATTACH_MACBOOK.has(sku)) return "macbook";
    if (SKU_ATTACH_IPAD.has(sku)) return "ipad";
    if (SKU_ATTACH_CAMERA.has(sku)) return "camera";
    if (SKU_ATTACH_GENERAL.has(sku)) return "general";
    return null;
  }

  // Regex for accessories to exclude from main product checks
  const RX_ACCESSORY_HINTS =
    /\b(CASE|COVER|PROTECTOR|SCREEN|GLASS|BUNDLE|PACK|KIT|SLEEVE|FOLIO|SHELL|SKIN|STRAP|BAND|CABLE|CHARGER|ADAPTER|MOUNT|HOLDER|STAND|KEYBOARD|PENCIL|STYLUS|BUDS|WATCH|FIT|EARBUD|HEADPHONE|SPEAKER|MOUSE|AUDIO)\b/i;

  const RX_CAMERA_BRANDS =
    /\b(CANON|SONY A|SONY ALPHA|NIKON|PANASONIC|INSTAX|POLAROID|GOPRO|DJI)\b/i;

  const RX_CAMERA_EXCLUDE =
    /\b(LENS|BATTERY|CHARGER|CASE|STRAP|MOUNT|SD|MEMORY|HEADPHONE|HEADPHONES|BUDS|EARBUD|SPEAKER|AUDIO)\b/i;

  function isAppleWatch(nameUpper) {
    // Check for Apple Watch patterns (must check before accessory hints since "WATCH" is in RX_ACCESSORY_HINTS)
    const n = nameUpper.replace(/\s+/g, " ");
    return /\bAPPLE\s+WATCH/i.test(n) || 
           /\bWATCH\s+(SERIES|SE|ULTRA)/i.test(n) ||
           /APPLE\s+WATCH\s+(SERIES\s+\d+|SE|ULTRA)/i.test(n);
  }

  function isAccessory(nameUpper, container = null) {
    // Check SKU first (highest priority)
    if (container) {
      const sku = getSKU(container);
      if (sku && getSKUAttachCategory(sku)) {
        return true; // SKU is in an attach list
      }
      // If SKU is in main products list, it's NOT an accessory
      if (sku && SKU_MAIN_PRODUCTS.has(sku)) {
        return false;
      }
    }
    
    // Products starting with "3SIXT - " are accessories
    if (/^3SIXT\s*-\s*/i.test(nameUpper)) {
      return true;
    }
    
    // Products starting with "PANZERGLASS-" are accessories
    if (/^PANZERGLASS\s*-/i.test(nameUpper)) {
      return true;
    }
    
    // Apple Watch is NOT an accessory - check this before other accessory patterns
    if (isAppleWatch(nameUpper)) {
      return false;
    }
    
    // Fall back to name-based detection
    return /AIRFLY|ADAPTER|AIRTAG|DONGLE|TRANSMITTER|RECEIVER|CASE|CABLE|CHARGER|MOUNT|STAND|COVER|PROTECTOR|EARBUD|HEADPHONE|TWS|ACCESSORY|ACCESSORIES|SPEAKER|MOUSE|KEYBOARD|SDXC|MICROSD|MEMORY|BAG|BACKPACK/i.test(
      nameUpper
    );
  }

  function isAppleCare(nameUpper) {
    return /APPLECARE|APPLE CARE|CARE\+/i.test(nameUpper);
  }

  function isAirPods(nameUpper) {
    // Specifically match AirPods Pro 3, Pro 2, and AirPods 4
    if (/AIRPODS\s+PRO\s+3|AIRPODS\s+PRO\s+2|AIRPODS\s+4/i.test(nameUpper)) {
      return true;
    }
    // Also catch other AirPods variants
    return /\bAIRPODS\b/i.test(nameUpper);
  }

  function isAppleProduct(nameUpper, container = null) {
    // Check SKU first (highest priority)
    if (container) {
      const sku = getSKU(container);
      if (sku && SKU_MAIN_PRODUCTS.has(sku)) {
        // Check if it's an Apple product by name (SKU list doesn't distinguish Apple vs non-Apple)
        // If SKU is in main products, check name to see if it's Apple
        const n = nameUpper.replace(/\s+/g, " ");
        // Check Apple Watch before accessory hints
        if (isAppleWatch(n)) return true;
        if (RX_ACCESSORY_HINTS.test(n)) return false;
        if (/IPHONE|IPAD|MACBOOK|IMAC|MAC\s+MINI|MAC\s+STUDIO|AIRPODS/i.test(n)) {
          return true;
        }
        // If SKU is in main products but name doesn't suggest Apple, it's not Apple
        return false;
      }
      // If SKU is in attach lists, it's NOT a main Apple product
      if (sku && getSKUAttachCategory(sku)) {
        return false;
      }
    }
    
    // Fall back to name-based detection
    const n = nameUpper.replace(/\s+/g, " ");
    
    // Check Apple Watch FIRST (before accessory hints, since "WATCH" is in RX_ACCESSORY_HINTS)
    if (isAppleWatch(n)) return true;
    
    if (RX_ACCESSORY_HINTS.test(n)) return false;

    if (/IPHONE/i.test(n)) {
      const modelMatch = n.match(/\bIPHONE\s*(1[3-9]|SE)\b/i);
      if (!modelMatch) return false;
      // iPhone must have storage to be valid hardware
      const hasStorage =
        /\b(64|128|256|512)\s*GB\b/i.test(n) ||
        /\b1\s*TB\b/i.test(n) ||
        /\b2\s*TB\b/i.test(n);
      return hasStorage;
    }

    if (/\bIPAD\b/i.test(n)) return true;
    if (/\bMACBOOK\b|\bIMAC\b|\bMAC\s+MINI\b|\bMAC\s+STUDIO\b/i.test(n))
      return true;
    if (/\bAIRPODS\b/i.test(n)) return true;

    return false;
  }

  function isSamsungDevice(nameUpper) {
    const n = nameUpper.replace(/\s+/g, " ");
    if (!/\bSAMSUNG\b/i.test(n)) return false;
    
    // Check for S25 series (S25, S25+, S25 Ultra, S25 Pro, etc.) - these don't have "GALAXY" in the name
    if (/\bS25[\s\+]?\+?[\s]?(ULTRA|PRO)?/i.test(n)) {
      if (RX_ACCESSORY_HINTS.test(n)) return false;
      return true;
    }
    
    // Check for Galaxy devices (requires both SAMSUNG and GALAXY)
    if (!/\bGALAXY\b/i.test(n)) return false;
    if (RX_ACCESSORY_HINTS.test(n)) return false;
    if (/\bBOOK\b/i.test(n)) return false; // Exclude Galaxy Book (Laptops handled in general logic)
    return true;
  }

  function isCamera(nameUpper) {
    const n = nameUpper.replace(/\s+/g, " ");
    return RX_CAMERA_BRANDS.test(n) && !RX_CAMERA_EXCLUDE.test(n);
  }

  function isMainNonAppleProduct(nameUpper, container = null) {
    // Check SKU first (highest priority)
    if (container) {
      const sku = getSKU(container);
      if (sku && SKU_MAIN_PRODUCTS.has(sku)) {
        // Check if it's NOT an Apple product (if it's in main products but not Apple, it's non-Apple main)
        const n = nameUpper.replace(/\s+/g, " ");
        if (RX_ACCESSORY_HINTS.test(n)) return false;
        // If SKU is in main products and name suggests non-Apple, return true
        if (isSamsungDevice(n)) return true;
        if (isCamera(n)) return true;
        if (/\bLENOVO|MICROSOFT\s+SURFACE|HP\s+(VICTUS|OMNIBOOK|PAVILION|SPECTRE|LAPTOP|OMEN)|MSI|ASUS/i.test(n)) {
          return true;
        }
        // If SKU is in main products but name suggests Apple, it's not non-Apple
        if (/IPHONE|IPAD|MACBOOK|IMAC|MAC\s+MINI|MAC\s+STUDIO|APPLE\s+WATCH|AIRPODS/i.test(n)) {
          return false;
        }
        // If SKU is in main products but we can't determine from name, assume it could be non-Apple
        // This is a fallback - ideally SKU lists would be more specific
      }
      // If SKU is in attach lists, it's NOT a main product
      if (sku && getSKUAttachCategory(sku)) {
        return false;
      }
    }
    
    // Fall back to name-based detection
    const n = nameUpper.replace(/\s+/g, " ");

    if (isSamsungDevice(n)) return true;
    if (isCamera(n)) return true;

    return (
      /\bLENOVO\s+IDEAPAD\b/i.test(n) ||
      /\bLENOVO\s+LEGION\b/i.test(n) ||
      /\bLENOVO\s+LOQ\b/i.test(n) ||
      /\bLENOVO\s+YOGA\b/i.test(n) ||
      /\bMICROSOFT\s+SURFACE\b/i.test(n) ||
      /\bHP\s+VICTUS\b/i.test(n) ||
      /\bHP\s+OMNIBOOK\b/i.test(n) ||
      /\bHP\s+PAVILION\b/i.test(n) ||
      /\bHP\s+SPECTRE\b/i.test(n) ||
      /\bVICTUS\s+15\b/i.test(n) ||
      /\bHP\s+LAPTOP\b/i.test(n) ||
      /\bHP\s+OMEN\b/i.test(n) ||
      /\bMSI\s+CYBORG\b/i.test(n) ||
      /\bMSI\s+CROSSHAIR\b/i.test(n) ||
      /\bASUS\s+ROG\b/i.test(n) ||
      /\bASUS\s+VIVOBOOK\b/i.test(n) ||
      /\bASUS\s+ZENBOOK\b/i.test(n) ||
      /\bASUS\s+TUF\b/i.test(n)
    );
  }

  function isBigElectronicDevice(nameUpper) {
    const n = nameUpper.replace(/\s+/g, " ");
    return /TABLET|IPAD|GALAXY TAB|SURFACE|CAMERA|DSLR|MIRRORLESS|LAPTOP|CANON EOS|SONY ALPHA|NOTEBOOK|ULTRABOOK|MACBOOK|RYZEN|INTEL|SNAPDRAGON|CHROMEBOOK|PC|SMARTPHONE|GALAXY S/i.test(
      n
    );
  }

  // --- CALCULATION LOGIC ---

  function computeCommission(container, ctx) {
    const saleTotal = getSaleTotal(container);
    if (saleTotal == null) return null;

    const nameRaw = getProductName(container).trim();
    const nameU = nameRaw.toUpperCase();
    const stockType = getStockType(container);
    const qty = getQty(container);

    const appleCareItem = isAppleCare(nameU);
    
    const isItemAirPods = isAirPods(nameU);
    let appleItem = isAppleProduct(nameU, container) && !appleCareItem;
    let accessoryItem = isAccessory(nameU, container);

    // Dynamic AirPods logic:
    // - AirPods sold alone (saleItemCount === 1) = 0.2% (treated as main product)
    // - AirPods sold with other items (saleItemCount > 1) = 0.5% (treated as accessory, regardless of what it's sold with)
    if (isItemAirPods) {
      if (ctx.saleItemCount === 1) {
        // AirPods sold alone = main product (0.2%)
        appleItem = true;
        accessoryItem = false;
      } else {
        // AirPods sold with other items = accessory (0.5%)
        appleItem = false;
        accessoryItem = true;
      }
    } else if (appleItem) {
      // Ensure normal Apple products don't accidentally flag as accessories via overlapping keywords
      accessoryItem = false;
    }

    // 1. AppleCare Always 5%
    if (appleCareItem) {
      return {
        value: saleTotal * 0.05,
        rate: 0.05,
        baseRate: 0.05,
        multiplier: 1,
        label: "AppleCare",
        note: "AppleCare 5%",
        name: nameRaw,
      };
    }

    // 1.5. AirPods sold alone = 0.2% (before Q Stock check)
    // This must happen before any other logic that might classify AirPods differently
    // Check if AirPods is the only item in the sale (sold alone)
    // Use both isItemAirPods check and direct name check for robustness
    const isAirPodsProduct = isItemAirPods || /AIRPODS/i.test(nameU);
    if (isAirPodsProduct && stockType !== "Q") {
      // If sold alone (saleItemCount === 1 means only this item in the sale)
      // Also check qty === 1 to ensure it's a single unit
      if (ctx.saleItemCount === 1 && qty === 1) {
        return {
          value: saleTotal * 0.002,
          rate: 0.002,
          baseRate: 0.002,
          multiplier: 1,
          label: "Solo Apple (AirPods)",
          note: "Main Product with no attach 0.2%",
          name: nameRaw,
        };
      }
    }

    // 2. Q Stock Logic
    if (stockType === "Q") {
      const isMain = appleItem || isMainNonAppleProduct(nameU, container);
      const noteSuffix = isMain 
        ? ". Considering this as primary product for any attached items (IPS Multiplier)" 
        : "";

      if (appleItem) {
        return {
          value: saleTotal * 0.015,
          rate: 0.015,
          baseRate: 0.015,
          multiplier: 1,
          label: "Q Apple",
          note: `Apple Q Stock 1.5%${noteSuffix}`,
          name: nameRaw,
        };
      }
      return {
        value: saleTotal * 0.023,
        rate: 0.023,
        baseRate: 0.023,
        multiplier: 1,
        label: "Q stock",
        note: `Q Stock 2.3%${noteSuffix}`,
        name: nameRaw,
      };
    }

    // 3. Primary Products Logic (Phones, Tablets, Cameras, Computers)
    if (appleItem || isMainNonAppleProduct(nameU, container)) {
      // Rule: Any Primary Product sold by itself = 0.2%
      // Special handling for AirPods: ensure solo AirPods gets 0.2%
      // Use both isItemAirPods check and direct name check for robustness
      const isAirPodsProduct = isItemAirPods || /AIRPODS/i.test(nameU);
      if (isAirPodsProduct && ctx.saleItemCount === 1 && qty === 1) {
        return {
          value: saleTotal * 0.002,
          rate: 0.002,
          baseRate: 0.002,
          multiplier: 1,
          label: "Solo Apple (AirPods)",
          note: "Main Product with no attach 0.2%",
          name: nameRaw,
        };
      }

      const isSoloEligible = true;

      if (ctx.saleItemCount === 1 && qty === 1 && isSoloEligible) {
        return {
          value: saleTotal * 0.002,
          rate: 0.002,
          baseRate: 0.002,
          multiplier: 1,
          label: appleItem ? "Solo Apple" : "Solo Primary",
          note: "Main Product with no attach 0.2%",
          name: nameRaw,
        };
      }

      return {
        value: saleTotal * 0.005,
        rate: 0.005,
        baseRate: 0.005,
        multiplier: 1,
        label: appleItem ? "Apple w/ others" : "Main Product w/ others",
        note: appleItem
          ? "Main Product with attach/AC 0.5%"
          : "Main Product (non-Apple) 0.5%",
        name: nameRaw,
      };
    }

    // 4. Default/Accessory Logic
    let baseRate = 0.005;
    let label = "Default";
    let note = "";

    if (accessoryItem) {
      baseRate = 0.005;
      label = "Accessory default";
    } else if (isBigElectronicDevice(nameU)) {
      baseRate = 0.005;
      label = "Big device default";
    }

    // 5. Multipliers
    let multiplier = 1;

    // AirPods should get 0.5% flat when sold with others (no multipliers)
    if (isItemAirPods && accessoryItem) {
      // AirPods as accessory: 0.5% flat, no multipliers
      multiplier = 1;
    } else if (ctx.appleCareSoldWithAppleAndOthers && !appleCareItem && !appleItem) {
      multiplier = 2.5;
      label += " ×2.5 (AppleCare bundle)";
      note = "AppleCare Multiplier 0.5% * 2.5";
    } else if (
      (ctx.appleSoldWithOthers || ctx.nonAppleMainSoldWithOthers) &&
      !appleCareItem
    ) {
      multiplier = 2;
      label += " ×2 (IPS bundle)";
      note = "IPS Multiplier 0.5% * 2";
    }

    const finalRate = baseRate * multiplier;
    const finalValue = saleTotal * finalRate;

    return {
      value: finalValue,
      rate: finalRate,
      baseRate,
      multiplier,
      label,
      note,
      name: nameRaw,
    };
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

    let proto;
    if (el.tagName === "TEXTAREA") {
      proto = HTMLTextAreaElement.prototype;
    } else {
      proto = HTMLInputElement.prototype;
    }

    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }

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

  // --- NOTIFICATION SYSTEM ---

  function getStack() {
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
        flexDirection: "column-reverse", // Newest at bottom
        gap: "8px",
        alignItems: "center",
        pointerEvents: "none",
        maxWidth: "90vw",
        transition: "all 0.3s ease"
      });
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showToast(msg, duration = 3000, isSecondary = false) {
    const stack = getStack();
    const item = document.createElement("div");
    item.className = "jbh-toast";
    item.textContent = msg;

    if (isSecondary) {
        item.style.opacity = "0.8";
        item.style.transform = "scale(0.95)";
    }

    stack.appendChild(item);

    // Animate out
    setTimeout(() => {
      item.classList.add("hiding");
      setTimeout(() => {
        item.remove();
        if (!stack.hasChildNodes()) {
          stack.remove();
        }
      }, 400);
    }, duration);
  }

  function showSummary(msg) {
    showToast(msg, 5000);
  }

  function notify(msg) {
    showToast(msg, 4500); // Increased from 2500 to 4500
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

  async function fillAndSaveModal({ commissionValue, commentText }) {
    const modalRoot = await waitForModal();
    if (!modalRoot) return false;

    const commInput = document.querySelector("#commission-value-input");
    if (!commInput) return false;
    setReactValue(commInput, String(commissionValue));

    const spivInput = document.querySelector("#spiv-value-input");
    if (spivInput && spivInput.value === "") {
      setReactValue(spivInput, "0");
    }

    await pickReasonOption("Matched Advertised Price");

    if (commentText) {
      const customTa = await waitForCustomReasonInput();
      if (customTa) {
        setReactValue(customTa, commentText);
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

  async function autoFixZeros() {
    // Set button to processing state
    const runBtn = document.getElementById("jbh-auto-btn");
    if (runBtn) {
      runBtn.classList.add("processing");
      runBtn.disabled = true;
    }

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

    const flags = containers.map((c) => {
      const nU = getProductName(c).toUpperCase();
      const appleCare = isAppleCare(nU);
      
      // Pre-calculate context for dynamic AirPods
      const _isAirPods = isAirPods(nU);
      const _isPrimary = isAppleProduct(nU, c) || isMainNonAppleProduct(nU, c);
      const _isRealPrimary = _isPrimary && !_isAirPods;

      return { appleCare, _isAirPods, _isRealPrimary, _isPrimary };
    });

    // Context Calculations
    const hasRealPrimaryProduct = flags.some(f => f._isRealPrimary);
    
    // Determine final role of each item (Primary vs Accessory)
    const finalRoles = flags.map(f => {
      let isPrimary = f._isPrimary;
      if (f._isAirPods && hasRealPrimaryProduct) {
        isPrimary = false; // Downgraded
      }
      return { ...f, isPrimary };
    });

    const hasAppleProduct = finalRoles.some(f => f.isPrimary && (f._isAirPods || isAppleProduct("IPHONE"))); // Simplification: Apple Product check inside loop is better but context needs global flags.
    // Re-calculating strict flags for context passing
    const appleItemCount = finalRoles.filter(f => f.isPrimary && f._isPrimary).length; // Approximate
    // Actually, let's simplify context passing. computeCommission does the heavy lifting per item.
    // We just need global flags.

    const appleSoldWithOthers = finalRoles.filter(f => f.isPrimary).length < containers.length; 
    // Wait, appleSoldWithOthers logic: "When accessories are sold with a primary product"
    // If we have 1 Primary and 1 Accessory -> appleSoldWithOthers = true?
    // Actually the original logic was: hasAppleProduct && containers.length > appleItemCount.
    
    const primaryCount = finalRoles.filter(f => f.isPrimary).length;
    const hasPrimary = primaryCount > 0;
    
    // "Apple Sold With Others" effectively means "Primary Sold With Non-Primary" in the new unified logic
    // But legacy name kept for minimizing diff.
    const ctx = {
      saleItemCount: containers.length,
      hasRealPrimaryProduct,
      appleSoldWithOthers: hasPrimary && containers.length > primaryCount,
      nonAppleMainSoldWithOthers: hasPrimary && containers.length > primaryCount, // Unified
      appleCareSoldWithAppleAndOthers: false // Calculated below
    };

    const hasAppleCare = flags.some(f => f.appleCare);
    const appleCareCount = flags.filter(f => f.appleCare).length;
    
    if (hasAppleCare && hasPrimary && containers.length > (primaryCount + appleCareCount)) {
        ctx.appleCareSoldWithAppleAndOthers = true;
    }

    const onlyZeroOn = localStorage.getItem(LS_KEY_ONLY_ZERO) === "true";
    const targets = onlyZeroOn
      ? containers.filter((c) => getOriginalComm(c) === 0)
      : containers;

    if (!targets.length) {
      notify("No $0 commission items found.");
      return;
    }

    notify(`Adjusting ${targets.length} items...`);

    const calcOn = localStorage.getItem(LS_KEY_CALC) === "true";
    const reasonOn = localStorage.getItem(LS_KEY_REASON) === "true";

    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      const btn = getAdjustButton(c);
      if (!btn) continue;

      const computedRaw = computeCommission(c, ctx);
      if (!computedRaw) continue;

      const saleTotal = getSaleTotal(c) || 0;
      const originalComm = getOriginalComm(c);

      let computed = clampToOriginalIfLower(computedRaw, originalComm, saleTotal);

      const truncatedValue = trunc3(computed.value);
      if (truncatedValue !== computed.value) {
        computed = {
          ...computed,
          value: truncatedValue,
          rate: saleTotal > 0 ? truncatedValue / saleTotal : computed.rate,
        };
      }

      let commentText = "";

      const hasPresetNote = !!(computed.note && computed.note.trim());
      const nU = (computed.name || "").toUpperCase();
      
      // Determine if this specific item is acting as Main Product
      // We use the same logic as computeCommission to check
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

      btn.click();
      await sleep(220);

      const ok = await fillAndSaveModal({
        commissionValue: computed.value,
        commentText,
      });

      if (!ok) {
        notify(`Stopped at ${i + 1}. Modal not found.`);
        return;
      }

      // Consolidated Notification
      // Format: "Adjusted 1/5 -> 0.5% for PRODUCT NAME"
      if (computed.keptOriginal) {
        notify(`Kept original $${originalComm} for ${nU} (auto was lower).`);
      } else {
        const ratePct = fmtPercent(computed.rate) + "%";
        notify(
          `Adjusted ${i + 1}/${targets.length} → ${ratePct} for ${nU}`
        );
      }

      await sleep(250);
    }

    notify("Done ✅");
    } finally {
      // Remove processing state
      if (runBtn) {
        runBtn.classList.remove("processing");
        runBtn.disabled = false;
      }
    }
  }

  function updateUIState() {
    const btn = document.getElementById("jbh-auto-btn");
    if (!btn) return;

    // Check if "Sale Overview" header exists in the DOM (safer than class jss808)
    const headers = Array.from(document.querySelectorAll("h2"));
    const isOnOverview = headers.some(h => h.textContent.includes("Sale Overview"));
    
    if (isOnOverview) {
      if (btn.textContent !== "Run Adjustment") {
        btn.textContent = "Run Adjustment";
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
        btn.style.background = "white";
        btn.style.color = "black";
      }
    } else {
      if (btn.textContent !== "Open a Sale to Adjust") {
        btn.textContent = "Open a Sale to Adjust";
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
        btn.style.background = "#444";
        btn.style.color = "#aaa";
      }
    }
  }

  // --- SINGLE ADJUSTMENT LOGIC ---
  async function applySingleAdjustment(c, rate, noteOverride = null) {
    const saleTotal = getSaleTotal(c) || 0;
    const val = trunc3(saleTotal * rate);
    
    const btn = getAdjustButton(c);
    if (!btn) {
        notify("Error: Adjust button not found");
        return;
    }

    const calcOn = localStorage.getItem(LS_KEY_CALC) === "true";
    const reasonOn = localStorage.getItem(LS_KEY_REASON) === "true";

    let commentText = "";
    if (noteOverride) {
        // Manual override
        commentText = noteOverride;
    } else {
        // If using preset rate without explicit note, generate standard text
        const pct = fmtPercent(rate) + "%";
        if (calcOn) {
             commentText = `${pct} of $${saleTotal} = $${val}`;
        } else {
             commentText = pct;
        }
        
        if (reasonOn) {
            // commentText += "\n\nManual Adjustment";
        }
    }

    btn.click();
    await sleep(200);
    const ok = await fillAndSaveModal({
        commissionValue: val,
        commentText
    });
    
    if (ok) {
        notify(`Applied ${fmtPercent(rate)}% to item`);
    } else {
        notify("Failed to apply adjustment");
    }
  }

  // --- INJECT INFO UI ---
  function injectRowInfo() {
    // Only run on Overview page
    const headers = Array.from(document.querySelectorAll("h2"));
    if (!headers.some(h => h.textContent.includes("Sale Overview"))) {
      // Clean up any orphaned UI elements when not on Overview page
      $$('.jbh-row-info').forEach(el => el.remove());
      return;
    }

    const containers = getProductContainers();
    if (!containers.length) {
      // If no containers, remove all UI elements
      $$('.jbh-row-info').forEach(el => el.remove());
      return;
    }

    // Calculate context once (needed for computeCommission)
    const flags = containers.map((c) => {
      const nU = getProductName(c).toUpperCase();
      const appleCare = isAppleCare(nU);
      const _isAirPods = isAirPods(nU);
      const _isPrimary = isAppleProduct(nU, c) || isMainNonAppleProduct(nU, c);
      const _isRealPrimary = _isPrimary && !_isAirPods;
      return { appleCare, _isAirPods, _isRealPrimary, _isPrimary };
    });

    const hasRealPrimaryProduct = flags.some(f => f._isRealPrimary);
    const finalRoles = flags.map(f => {
        let isPrimary = f._isPrimary;
        if (f._isAirPods && hasRealPrimaryProduct) isPrimary = false;
        return { ...f, isPrimary };
    });
    const primaryCount = finalRoles.filter(f => f.isPrimary).length;
    const hasPrimary = primaryCount > 0;
    
    const ctx = {
      saleItemCount: containers.length,
      hasRealPrimaryProduct,
      appleSoldWithOthers: hasPrimary && containers.length > primaryCount,
      nonAppleMainSoldWithOthers: hasPrimary && containers.length > primaryCount,
      appleCareSoldWithAppleAndOthers: false
    };
    
    const hasAppleCare = flags.some(f => f.appleCare);
    const appleCareCount = flags.filter(f => f.appleCare).length;
    if (hasAppleCare && hasPrimary && containers.length > (primaryCount + appleCareCount)) {
        ctx.appleCareSoldWithAppleAndOthers = true;
    }

    // Pre-compute tracking IDs for all current containers to identify orphaned elements
    // This allows us to preserve matching UI elements while cleaning up stale ones
    const currentTrackingIds = new Set();
    containers.forEach((c) => {
      const result = computeCommission(c, ctx);
      if (result) {
        const trackingId = `${result.name}|${result.rate}|${result.value}`;
        currentTrackingIds.add(trackingId);
      }
    });

    // Remove only UI elements that don't match any current container's tracking ID
    // This preserves matching elements for the optimization check in the loop
    $$('.jbh-row-info').forEach(el => {
      const trackingId = el.dataset.trackingId;
      if (!trackingId || !currentTrackingIds.has(trackingId)) {
        el.remove();
      }
    });

    // Inject info
    // We disconnect observer to prevent infinite loops during DOM manipulation
    obs.disconnect();

    try {
        containers.forEach((c) => {
            const result = computeCommission(c, ctx);
            if (!result) return;

            const card = c.parentElement || c;
            const trackingId = `${result.name}|${result.rate}|${result.value}`;

            // Check for existing UI in the card (not in c)
            const existingUI = card.querySelector('.jbh-row-info');
            if (existingUI) {
                // If UI exists and matches current data, skip
                if (existingUI.dataset.trackingId === trackingId) {
                    return;
                }
                // If UI exists but stale (wrong product/price), remove it
                existingUI.remove();
            }

            // Content Building
            const stockStr = getStockType(c) === "Q" ? "Q Stock" : "Regular Stock";
            
            let category = "Unknown";
            const resultNameU = (result.name || "").toUpperCase();
            if (/2D\s+SAMSUNG|SAMSUNG\s+GALAXY\s+S|SAMSUNG\s+S25/i.test(resultNameU) || isSamsungDevice(resultNameU)) {
                category = "Samsung Main Product";
            } else if (isAirPods(resultNameU)) {
                // AirPods Pro 3, Pro 2, and AirPods 4: "Apple Primary" if alone, "Accessory" if attached to iPhone/MacBook
                if (ctx.hasRealPrimaryProduct) {
                    category = "Accessory";
                } else {
                    category = "Apple Primary";
                }
            } else if (isAppleProduct(resultNameU, c)) category = "Apple Primary";
            else if (isMainNonAppleProduct(resultNameU, c)) category = "Primary (Non-Apple)";
            else if (isAccessory(resultNameU, c)) category = "Accessory";
            else if (isBigElectronicDevice(resultNameU)) category = "Big Device";
            
            let bundleStatus = "None";
            if (ctx.appleCareSoldWithAppleAndOthers && result.multiplier === 2.5) bundleStatus = "AC Multiplier (2.5x)";
            else if (result.multiplier === 2) bundleStatus = "IPS Multiplier (2x)";
            else if (ctx.hasRealPrimaryProduct && isAirPods(result.name)) bundleStatus = "Attached (AirPods)";

            const infoDiv = document.createElement("div");
            infoDiv.className = "jbh-row-info";
            // Store the tracking ID
            infoDiv.dataset.trackingId = trackingId;
            Object.assign(infoDiv.style, {
                marginTop: "12px",
                padding: "16px",
                background: "rgba(20, 20, 20, 0.95)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "16px",
                fontSize: "13px",
                color: "white",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                width: "260px",
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                position: "absolute",
                bottom: "10px",
                left: "10px",
                zIndex: "100"
            });

            // Calculate truncated value for display to match actual behavior
            const dispValue = trunc3(result.value);

            // Top Section: Auto Suggestion
            const topSection = document.createElement("div");
            topSection.className = "jbh-auto-section";
            topSection.innerHTML = `
                <div style="text-align:center; font-weight:700; color:#fff; font-size:14px; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); letter-spacing: 0.3px;">
                    Automatic Adjustment: <span style="color:#34C759;">${fmtPercent(result.rate)}%</span> - <span style="color:#34C759;">$${dispValue}</span>
                </div>
                <div style="display:flex; flex-direction:column; align-items:center; gap:4px; font-size:12px; color:#aaa;">
                    <span>${category} • ${stockStr}</span>
                    <span style="font-size:11px; color:#888; font-style:italic;">${bundleStatus}</span>
                </div>
            `;
            infoDiv.appendChild(topSection);

            // Bottom Section: Manual Controls
            const bottomSection = document.createElement("div");
            bottomSection.className = "jbh-manual-section";
            Object.assign(bottomSection.style, {
                marginTop: "4px",
                paddingTop: "8px",
                borderTop: "1px solid rgba(255,255,255,0.1)",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
            });

            const manualHeader = document.createElement("div");
            manualHeader.textContent = "Manual Override (if incorrect)";
            Object.assign(manualHeader.style, {
                textAlign: "center",
                fontSize: "11px",
                fontWeight: "600",
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: "0.5px"
            });
            bottomSection.appendChild(manualHeader);

            const btnRow = document.createElement("div");
            Object.assign(btnRow.style, {
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "6px"
            });

            // Quick Percent Buttons
            const pcts = [0.002, 0.005, 0.01, 0.015, 0.02, 0.023];
            pcts.forEach(rate => {
                const btn = document.createElement("button");
                btn.textContent = fmtPercent(rate) + "%";
                Object.assign(btn.style, {
                    border: "none",
                    background: "#333",
                    borderRadius: "6px",
                    padding: "6px 0",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: "500",
                    color: "#fff",
                    transition: "all 0.2s",
                    textAlign: "center"
                });
                btn.addEventListener("mouseenter", () => {
                    btn.style.background = "#444";
                    btn.style.transform = "scale(1.02)";
                });
                btn.addEventListener("mouseleave", () => {
                    btn.style.background = "#333";
                    btn.style.transform = "scale(1)";
                });
                
                // Click Action
                btn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    btn.textContent = "...";
                    btn.style.color = "#aaa";
                    btn.disabled = true;
                    await applySingleAdjustment(c, rate);
                    btn.disabled = false;
                    btn.style.color = "#fff";
                    btn.textContent = fmtPercent(rate) + "%";
                });

                btnRow.appendChild(btn);
            });

            bottomSection.appendChild(btnRow);
            infoDiv.appendChild(bottomSection);

            // Injection Point: Bottom Left of Product Box
            // card is already defined above
            if (card) {
                const style = window.getComputedStyle(card);
                if (style.position === 'static') card.style.position = 'relative';
                
                // Adjust infoDiv style for absolute positioning at bottom left
                Object.assign(infoDiv.style, {
                   position: "absolute",
                   bottom: "10px",
                   left: "10px",
                   zIndex: "100"
                });

                card.appendChild(infoDiv);
            } else {
                c.appendChild(infoDiv);
            }
        });
    } catch(e) {
        console.error("JBH Helper Error:", e);
    } finally {
        // Reconnect observer
        obs.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function addUIIfMissing() {
    if (document.getElementById("jbh-helper-wrap")) {
        updateUIState();
        return;
    }

    // --- STYLES ---
    if (!document.getElementById("jbh-helper-styles")) {
      const style = document.createElement("style");
      style.id = "jbh-helper-styles";
      style.textContent = `
        #jbh-helper-wrap {
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: rgba(20, 20, 20, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
            color: white;
            opacity: 0;
            animation: jbh-fade-in 0.4s ease forwards;
            min-width: 200px;
            min-height: 150px;
            max-width: 90vw;
            max-height: 90vh;
            overflow: hidden;
            user-select: none;
        }

        #jbh-helper-wrap.dragging {
            cursor: grabbing !important;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
        }

        #jbh-helper-wrap.resizing {
            cursor: nwse-resize !important;
        }

        .jbh-drag-handle {
            padding: 12px 16px;
            cursor: grab;
            background: rgba(255, 255, 255, 0.05);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }

        .jbh-drag-handle:active {
            cursor: grabbing;
        }

        .jbh-drag-handle:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .jbh-content {
            padding: 16px;
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
            gap: 12px;
            min-height: 0;
            padding-right: 4px;
        }

        .jbh-content-scrollable::-webkit-scrollbar {
            width: 6px;
        }

        .jbh-content-scrollable::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
        }

        .jbh-content-scrollable::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }

        .jbh-content-scrollable::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        .jbh-button-container {
            margin-top: 12px;
            flex-shrink: 0;
            padding-top: 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .jbh-resize-handle {
            position: absolute;
            background: transparent;
            z-index: 10;
        }

        .jbh-resize-handle.n {
            top: 0;
            left: 0;
            right: 0;
            height: 8px;
            cursor: ns-resize;
        }

        .jbh-resize-handle.s {
            bottom: 0;
            left: 0;
            right: 0;
            height: 8px;
            cursor: ns-resize;
        }

        .jbh-resize-handle.e {
            top: 0;
            right: 0;
            bottom: 0;
            width: 8px;
            cursor: ew-resize;
        }

        .jbh-resize-handle.w {
            top: 0;
            left: 0;
            bottom: 0;
            width: 8px;
            cursor: ew-resize;
        }

        .jbh-resize-handle.ne {
            top: 0;
            right: 0;
            width: 16px;
            height: 16px;
            cursor: nesw-resize;
        }

        .jbh-resize-handle.nw {
            top: 0;
            left: 0;
            width: 16px;
            height: 16px;
            cursor: nwse-resize;
        }

        .jbh-resize-handle.se {
            bottom: 0;
            right: 0;
            width: 16px;
            height: 16px;
            cursor: nwse-resize;
        }

        .jbh-resize-handle.sw {
            bottom: 0;
            left: 0;
            width: 16px;
            height: 16px;
            cursor: nesw-resize;
        }

        .jbh-resize-handle:hover {
            background: rgba(52, 199, 89, 0.2);
        }

        @keyframes jbh-fade-in {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .jbh-title {
            font-size: 13px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #888;
            flex: 1;
        }

        .jbh-drag-icon {
            width: 16px;
            height: 16px;
            opacity: 0.5;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .jbh-drag-icon::before {
            content: '⋮⋮';
            font-size: 12px;
            line-height: 1;
            color: #888;
        }

        .jbh-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            gap: 12px;
            min-height: 32px;
            flex-shrink: 0;
        }

        .jbh-row span {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* SWITCH */
        .jbh-switch {
            position: relative;
            width: 40px;
            height: 22px;
            background: #444;
            border-radius: 20px;
            transition: background 0.3s;
            flex-shrink: 0;
        }
        .jbh-switch::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 18px;
            height: 18px;
            background: white;
            border-radius: 50%;
            transition: transform 0.3s cubic-bezier(0.3, 1.2, 0.2, 1);
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        input:checked + .jbh-switch {
            background: #34C759; /* Apple Green */
        }
        input:checked + .jbh-switch::after {
            transform: translateX(18px);
        }
        input { display: none; }

        /* BUTTON */
        #jbh-auto-btn {
            width: 100%;
            padding: 12px 0;
            border-radius: 10px;
            border: none;
            background: white;
            color: black;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: background 0.3s ease, color 0.3s ease, transform 0.2s ease, box-shadow 0.3s ease, border-color 0.3s ease;
            transform: translateY(0);
            border: 2px solid transparent;
        }

        #jbh-auto-btn:hover {
            background: #34C759;
            color: white;
            border-color: #34C759;
            box-shadow: 0 4px 12px rgba(52, 199, 89, 0.3);
            transform: translateY(-2px);
        }

        #jbh-auto-btn:active {
            background: #2AB04A;
            border-color: #2AB04A;
            transform: translateY(0);
            box-shadow: 0 2px 6px rgba(52, 199, 89, 0.2);
            transition: all 0.1s;
        }

        #jbh-auto-btn.processing {
            background: #FF9500;
            color: white;
            border-color: #FF9500;
            cursor: wait;
            animation: jbh-pulse 1.5s ease-in-out infinite;
        }

        #jbh-auto-btn.processing:hover {
            background: #FF9500;
            transform: translateY(0);
        }

        @keyframes jbh-pulse {
            0%, 100% {
                box-shadow: 0 4px 12px rgba(255, 149, 0, 0.3);
            }
            50% {
                box-shadow: 0 4px 20px rgba(255, 149, 0, 0.5);
            }
        }

        #jbh-auto-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
            background: white;
            color: black;
            border-color: transparent;
        }

        #jbh-auto-btn:disabled:hover {
            transform: none;
            box-shadow: none;
            background: white;
            color: black;
            border-color: transparent;
        }

        /* ROW INFO HOVER EFFECTS */
        .jbh-row-info {
            transition: opacity 0.3s ease, background 0.3s ease;
        }

        .jbh-row-info .jbh-auto-section {
            transition: opacity 0.3s ease;
            opacity: 1;
        }

        /* When hovering auto section, fade entire widget including background */
        .jbh-row-info:has(.jbh-auto-section:hover) {
            opacity: 0.2;
        }

        /* Keep manual section fully visible even when widget is faded */
        .jbh-row-info:has(.jbh-auto-section:hover) .jbh-manual-section {
            opacity: 1;
            pointer-events: auto;
        }

        .jbh-row-info .jbh-manual-section {
            opacity: 1;
            pointer-events: auto;
        }

        /* When hovering manual section, keep widget at full opacity */
        .jbh-row-info:has(.jbh-manual-section:hover) {
            opacity: 1;
        }

        /* NOTIFICATIONS & TOASTS */
        .jbh-toast {
            background: rgba(20, 20, 20, 0.9);
            backdrop-filter: blur(8px);
            color: white;
            padding: 10px 16px;
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 8px 20px rgba(0,0,0,0.3);
            animation: jbh-pop-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            transition: opacity 0.3s, transform 0.3s, margin 0.3s;
        }
        .jbh-toast.hiding {
            opacity: 0;
            transform: scale(0.9) translateY(10px);
            margin-bottom: -40px; /* Collapse space */
        }
        
        @keyframes jbh-pop-in {
            from { opacity: 0; transform: scale(0.8); }
            to { opacity: 1; transform: scale(1); }
        }

        /* TOOLTIP */
        #jbh-tooltip {
            position: fixed;
            top: 0;
            left: 0;
            transform: translateX(-10px) translateY(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 12px 16px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 500;
            line-height: 1.4;
            white-space: pre-line;
            width: 260px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 2147483648;
        }
        #jbh-tooltip::after {
            content: '';
            position: absolute;
            top: 50%;
            right: -8px;
            transform: translateY(-50%);
            border-width: 8px 0 8px 8px;
            border-style: solid;
            border-color: transparent transparent transparent rgba(0, 0, 0, 0.9);
        }
        #jbh-tooltip.visible {
            opacity: 1;
        }
      `;
      document.head.appendChild(style);
    }

    // --- BUILD UI ---
    const wrap = document.createElement("div");
    wrap.id = "jbh-helper-wrap";

    // Load saved position and size
    const savedPos = localStorage.getItem("jbh-wrap-position");
    const savedSize = localStorage.getItem("jbh-wrap-size");
    if (savedPos) {
      const pos = JSON.parse(savedPos);
      wrap.style.left = pos.left;
      wrap.style.top = pos.top;
      wrap.style.right = "auto";
      wrap.style.bottom = "auto";
    }
    if (savedSize) {
      const size = JSON.parse(savedSize);
      wrap.style.width = size.width;
      wrap.style.height = size.height;
    } else {
      wrap.style.width = "220px";
    }

    // Shared Tooltip Element (append to body to avoid overflow clipping)
    const tooltip = document.createElement("div");
    tooltip.id = "jbh-tooltip";
    document.body.appendChild(tooltip);

    // Drag Handle
    const dragHandle = document.createElement("div");
    dragHandle.className = "jbh-drag-handle";
    const title = document.createElement("div");
    title.className = "jbh-title";
    title.textContent = "COMMISSION HELPER";
    const dragIcon = document.createElement("div");
    dragIcon.className = "jbh-drag-icon";
    dragHandle.appendChild(title);
    dragHandle.appendChild(dragIcon);
    wrap.appendChild(dragHandle);

    // Content Container
    const content = document.createElement("div");
    content.className = "jbh-content";
    wrap.appendChild(content);

    // Helper to create toggle row
    const createToggle = (key, labelText, tooltipText) => {
        const label = document.createElement("label");
        label.className = "jbh-row";
        label.style.position = "relative"; 
        
        const span = document.createElement("span");
        span.textContent = labelText;
        
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = localStorage.getItem(key) === "true";
        input.addEventListener("change", () => {
            localStorage.setItem(key, input.checked ? "true" : "false");
        });

        const sw = document.createElement("div");
        sw.className = "jbh-switch";

        label.append(span, input, sw);

        // Tooltip Logic
        label.addEventListener("mouseenter", () => {
            if (!tooltipText || !tooltipText.trim()) return;
            tooltip.textContent = tooltipText;
            // Position tooltip relative to viewport (since it's fixed)
            const rect = label.getBoundingClientRect();
            const wrapRect = wrap.getBoundingClientRect();
            
            // Calculate position: to the left of the wrap, vertically centered on the label
            const topPosition = rect.top + (rect.height / 2);
            const leftPosition = wrapRect.left - 10; // 10px gap from the wrap
            
            tooltip.style.top = `${topPosition}px`;
            tooltip.style.left = `${leftPosition}px`;
            tooltip.style.transform = `translateX(-100%) translateY(-50%)`;
            tooltip.classList.add("visible");
        });

        label.addEventListener("mouseleave", () => {
            tooltip.classList.remove("visible");
        });

        return label;
    };

    // Scrollable content area for toggles
    const scrollableContent = document.createElement("div");
    scrollableContent.className = "jbh-content-scrollable";
    
    scrollableContent.appendChild(createToggle(LS_KEY_ONLY_ZERO, "Edit $0 Commissions Only", "Only adjust products sold with $0 commission. \n\nUseful for fixing missed commissions without overwriting the existing commission values."));
    scrollableContent.appendChild(createToggle(LS_KEY_CALC, "Add Formula/Calculation", "Add the math formula used to the reason/comment field. \n\n(e.g., 0.5% * $1000 = $5.00)"));
    scrollableContent.appendChild(createToggle(LS_KEY_REASON, "Add Reason", "Add the explanation note to the reason/comment field. \n\n(e.g., 'IPS Multiplier', 'Main Product with attach/AC')"));
    
    content.appendChild(scrollableContent);

    // Button container that sticks to bottom
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "jbh-button-container";
    const btn = document.createElement("button");
    btn.id = "jbh-auto-btn";
    btn.textContent = "Run Adjustment";
    btn.addEventListener("click", autoFixZeros);
    buttonContainer.appendChild(btn);
    content.appendChild(buttonContainer);

    const resizeHandles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    resizeHandles.forEach(direction => {
      const handle = document.createElement("div");
      handle.className = `jbh-resize-handle ${direction}`;
      wrap.appendChild(handle);
    });

    // Drag functionality
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    dragHandle.addEventListener("mousedown", (e) => {
      if (e.target.closest('.jbh-resize-handle')) return;
      isDragging = true;
      wrap.classList.add("dragging");
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = wrap.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (isDragging) {
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        const newLeft = initialLeft + deltaX;
        const newTop = initialTop + deltaY;
        
        // Keep within viewport bounds
        const maxLeft = window.innerWidth - wrap.offsetWidth;
        const maxTop = window.innerHeight - wrap.offsetHeight;
        
        wrap.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
        wrap.style.top = `${Math.max(0, Math.min(newTop, maxTop))}px`;
        wrap.style.right = "auto";
        wrap.style.bottom = "auto";
      }
    });

    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        wrap.classList.remove("dragging");
        // Save position
        const rect = wrap.getBoundingClientRect();
        localStorage.setItem("jbh-wrap-position", JSON.stringify({
          left: `${rect.left}px`,
          top: `${rect.top}px`
        }));
      }
    });

    // Resize functionality
    let isResizing = false;
    let resizeDirection = "";
    let resizeStartX = 0;
    let resizeStartY = 0;
    let initialWidth = 0;
    let initialHeight = 0;
    let initialLeftResize = 0;
    let initialTopResize = 0;

    resizeHandles.forEach(direction => {
      const handle = wrap.querySelector(`.jbh-resize-handle.${direction}`);
      handle.addEventListener("mousedown", (e) => {
        isResizing = true;
        resizeDirection = direction;
        wrap.classList.add("resizing");
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        const rect = wrap.getBoundingClientRect();
        initialWidth = rect.width;
        initialHeight = rect.height;
        initialLeftResize = rect.left;
        initialTopResize = rect.top;
        e.preventDefault();
        e.stopPropagation();
      });
    });

    document.addEventListener("mousemove", (e) => {
      if (isResizing) {
        const deltaX = e.clientX - resizeStartX;
        const deltaY = e.clientY - resizeStartY;
        let newWidth = initialWidth;
        let newHeight = initialHeight;
        let newLeft = initialLeftResize;
        let newTop = initialTopResize;

        if (resizeDirection.includes('e')) {
          newWidth = initialWidth + deltaX;
        }
        if (resizeDirection.includes('w')) {
          newWidth = initialWidth - deltaX;
          newLeft = initialLeftResize + deltaX;
        }
        if (resizeDirection.includes('s')) {
          newHeight = initialHeight + deltaY;
        }
        if (resizeDirection.includes('n')) {
          newHeight = initialHeight - deltaY;
          newTop = initialTopResize + deltaY;
        }

        // Apply constraints
        const minWidth = 200;
        const minHeight = 150;
        const maxWidth = window.innerWidth;
        const maxHeight = window.innerHeight;

        newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
        newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

        // Adjust position if resizing from left or top
        if (resizeDirection.includes('w')) {
          const widthDelta = newWidth - initialWidth;
          const adjustedLeft = initialLeftResize - widthDelta;
          if (adjustedLeft >= 0 && adjustedLeft + newWidth <= window.innerWidth) {
            wrap.style.left = `${adjustedLeft}px`;
            wrap.style.right = "auto";
          } else {
            newWidth = initialWidth;
          }
        }
        if (resizeDirection.includes('n')) {
          const heightDelta = newHeight - initialHeight;
          const adjustedTop = initialTopResize - heightDelta;
          if (adjustedTop >= 0 && adjustedTop + newHeight <= window.innerHeight) {
            wrap.style.top = `${adjustedTop}px`;
            wrap.style.bottom = "auto";
          } else {
            newHeight = initialHeight;
          }
        }

        wrap.style.width = `${newWidth}px`;
        wrap.style.height = `${newHeight}px`;
      }
    });

    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        wrap.classList.remove("resizing");
        // Save size
        const rect = wrap.getBoundingClientRect();
        localStorage.setItem("jbh-wrap-size", JSON.stringify({
          width: `${rect.width}px`,
          height: `${rect.height}px`
        }));
      }
    });

    document.body.appendChild(wrap);
    updateUIState();
  }

  addUIIfMissing();
  const obs = new MutationObserver(() => {
    addUIIfMissing();
    injectRowInfo();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();

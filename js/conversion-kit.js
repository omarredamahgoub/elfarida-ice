/**
 * js/conversion-kit.js
 * ------------------------------------------------------------------
 * Site-wide conversion layer. Loaded on every page after site-shell.js.
 *
 * Responsibilities (each degrades to a no-op if its prerequisites are absent):
 *   1. Persistent contact dock  — WhatsApp + click-to-call on every page.
 *   2. Header phone link        — click-to-call inside the rendered header.
 *   3. Contact-intent tracking  — every tel:/wa.me click reported to GA4 as a
 *                                 `contact_click` conversion event, so the
 *                                 channel that actually closes deals stops
 *                                 being invisible in analytics.
 *   4. Calculator capture       — turns the thermal-load result into a
 *                                 pre-filled WhatsApp message plus an inline
 *                                 three-field lead form posted to /api/quote.
 *
 * All contact data is read from /lib/site.config.json — never hardcoded here,
 * so a number change is a one-line edit in that file and nowhere else.
 *
 * No dependencies. Classic script, defer-loaded. Styles are injected once by
 * this module so a page only needs the single <script> tag.
 */
(function () {
  "use strict";

  if (window.__efiConversionKit) return;
  window.__efiConversionKit = true;

  var CONFIG_URL = "/lib/site.config.json";
  var QUOTE_ENDPOINT = "/api/quote";
  var EVENT_ENDPOINT = "/api/contact-event";

  /* ─────────────────── contact reference code ─────────────────── */

  /**
   * A short code minted once per page view and embedded in every pre-filled
   * WhatsApp message sent from that page.
   *
   * A WhatsApp tap is otherwise anonymous: the owner sees a message arrive with
   * no idea which page produced it. Because the visitor's own message carries
   * this code, the owner can look it up in the admin panel and recover the
   * page, the moment and the context (a calculator result, for example).
   *
   * Alphabet excludes 0/O/1/I/L so a code read aloud or retyped is unambiguous.
   */
  var REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

  var pageRef = (function () {
    var out = "";
    try {
      var buf = new Uint8Array(4);
      crypto.getRandomValues(buf);
      for (var i = 0; i < 4; i++) out += REF_ALPHABET[buf[i] % REF_ALPHABET.length];
    } catch (_) {
      for (var j = 0; j < 4; j++) {
        out += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
      }
    }
    return "EFI-" + out;
  })();

  /* ─────────────────────────── helpers ─────────────────────────── */

  function lang() {
    return (document.documentElement.lang || "ar").toLowerCase().indexOf("en") === 0
      ? "en"
      : "ar";
  }

  function t(ar, en) {
    return lang() === "en" ? en : ar;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function gtagPush() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
  }

  /**
   * Reports a contact-intent click to GA4. Fires for phone and WhatsApp alike
   * so the two channels can be compared against form submissions.
   * @param {string} channel  "whatsapp" | "phone"
   * @param {string} location where on the page the click happened
   */
  function trackContact(channel, location) {
    try {
      gtagPush("event", "contact_click", {
        contact_channel: channel,
        contact_location: location,
        contact_ref: pageRef,
        page_path: window.location.pathname,
        page_language: lang(),
      });
      if (channel === "whatsapp" || channel === "phone") {
        gtagPush("event", "generate_lead", {
          lead_source: channel,
          lead_location: location,
          page_path: window.location.pathname,
        });
      }
    } catch (_) {
      /* analytics must never break a contact action */
    }

    recordContactEvent(channel, location);
  }

  /**
   * Persists the tap to the site's own database, so the owner can read it in
   * /admin/leads rather than only as an aggregate count in GA4.
   *
   * `sendBeacon` is used because the browser is already navigating to WhatsApp
   * or the dialer: a normal fetch would be cancelled mid-flight. It queues the
   * request with the browser, which delivers it regardless. `fetch` with
   * keepalive is the fallback for the few engines without sendBeacon.
   */
  function recordContactEvent(channel, location) {
    var payload = {
      channel: channel,
      location: location || "inline",
      ref: pageRef,
      page: window.location.pathname,
      pageTitle: (document.title || "").split("|")[0].trim(),
      lang: lang(),
      context: lastCalcContext || "",
    };

    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(EVENT_ENDPOINT, new Blob([body], { type: "application/json" }));
        return;
      }
      fetch(EVENT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch (_) {
      /* never block the visitor's click */
    }
  }

  /**
   * The most recent calculator result on this page, carried into the contact
   * record so a WhatsApp tap from the calculator is stored with the numbers the
   * visitor was looking at.
   */
  var lastCalcContext = "";

  /**
   * Appends the page's reference code to every outgoing WhatsApp message.
   * The visitor sends it without thinking about it; the owner reads it in the
   * received message and looks it up in the admin panel.
   */
  function withRef(message) {
    if (!message) return message;
    return message + "\n\n" + t("مرجع: ", "Ref: ") + pageRef;
  }

  function waLink(e164, message) {
    var text = withRef(message);
    return (
      "https://wa.me/" +
      String(e164).replace(/[^\d]/g, "") +
      (text ? "?text=" + encodeURIComponent(text) : "")
    );
  }

  /* ─────────────────────────── styles ─────────────────────────── */

  var CSS = [
    ".efi-dock{position:fixed;inset-block-end:16px;inset-inline-end:16px;z-index:9990;",
    "display:flex;flex-direction:column;gap:10px;align-items:flex-end}",
    ".efi-dock__btn{display:inline-flex;align-items:center;gap:9px;height:52px;padding:0 18px;",
    "border-radius:999px;font:600 14px/1 inherit;text-decoration:none;color:#fff;",
    "box-shadow:0 6px 20px -6px rgba(0,0,0,.45);transition:transform .18s ease,box-shadow .18s ease;",
    "white-space:nowrap;border:0;cursor:pointer;font-family:inherit}",
    ".efi-dock__btn:hover,.efi-dock__btn:focus-visible{transform:translateY(-2px);",
    "box-shadow:0 10px 26px -8px rgba(0,0,0,.55)}",
    ".efi-dock__btn:focus-visible{outline:3px solid #38bdf8;outline-offset:3px}",
    ".efi-dock__btn--wa{background:#25d366;color:#06301a}",
    ".efi-dock__btn--tel{background:#1e3a8a}",
    ".efi-dock__ico{width:20px;height:20px;flex:none;fill:currentColor}",
    "@media (max-width:520px){.efi-dock{inset-block-end:12px;inset-inline-end:12px;gap:8px}",
    ".efi-dock__btn{height:48px;padding:0 15px;font-size:13px}",
    ".efi-dock__btn--tel .efi-dock__label{display:none}",
    ".efi-dock__btn--tel{padding:0 14px}}",
    "@media (prefers-reduced-motion:reduce){.efi-dock__btn{transition:none}}",

    ".efi-hdr-tel{display:inline-flex;align-items:center;gap:7px;font-weight:700;",
    "text-decoration:none;color:inherit;padding:6px 10px;border-radius:8px;direction:ltr}",
    ".efi-hdr-tel:hover{background:rgba(30,58,138,.1)}",
    "@media (max-width:900px){.efi-hdr-tel{display:none}}",

    ".efi-calc-capture{margin-top:14px;padding:18px;border-radius:16px;",
    "background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.28);text-align:start}",
    ".efi-calc-capture h3{margin:0 0 6px;font-size:1rem;font-weight:800;color:inherit}",
    ".efi-calc-capture p{margin:0 0 14px;font-size:.83rem;opacity:.85;line-height:1.65}",
    ".efi-calc-actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}",
    ".efi-calc-actions a{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;",
    "border-radius:12px;font:700 .85rem/1 inherit;text-decoration:none;color:#fff}",
    ".efi-calc-actions a.wa{background:#25d366;color:#06301a}",
    ".efi-calc-actions a.tel{background:#1e3a8a}",
    ".efi-calc-form{display:grid;gap:9px}",
    ".efi-calc-form input,.efi-calc-form button{font-family:inherit;font-size:.85rem}",
    ".efi-calc-form input{padding:11px 13px;border-radius:10px;border:1px solid rgba(148,163,184,.4);",
    "background:rgba(255,255,255,.06);color:inherit;width:100%}",
    ".efi-calc-form input::placeholder{color:inherit;opacity:.5}",
    ".efi-calc-form button{padding:12px 16px;border-radius:10px;border:0;background:#dc2626;",
    "color:#fff;font-weight:800;cursor:pointer}",
    ".efi-calc-form button[disabled]{opacity:.6;cursor:progress}",
    ".efi-calc-msg{font-size:.82rem;margin:0;line-height:1.6}",
    ".efi-calc-msg.ok{color:#16a34a}.efi-calc-msg.err{color:#dc2626}",
    ".efi-hp{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);",
    "white-space:nowrap;border:0}",

    ".efi-capture{max-width:52rem;margin:48px auto 56px;padding:clamp(20px,4vw,32px);",
    "border-radius:18px;background:linear-gradient(150deg,#0b1c33 0%,#0d2748 60%,#123362 100%);",
    "border:1px solid rgba(56,189,248,.3);box-shadow:0 18px 50px -20px rgba(0,0,0,.6);",
    "color:#eef6ff;text-align:start}",
    ".efi-cap-title{margin:0 0 8px;font-size:clamp(1.15rem,3vw,1.5rem);font-weight:900;",
    "color:#fff;line-height:1.35;text-wrap:balance}",
    ".efi-cap-body{margin:0 0 18px;font-size:.9rem;line-height:1.75;color:#a8c8e8}",
    ".efi-cap-quick{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:18px}",
    ".efi-cap-wa,.efi-cap-tel{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;",
    "border-radius:12px;font-weight:800;font-size:.86rem;text-decoration:none}",
    ".efi-cap-wa{background:#25d366;color:#06301a}",
    ".efi-cap-tel{background:rgba(255,255,255,.1);color:#eef6ff;border:1px solid rgba(255,255,255,.22)}",
    ".efi-cap-link{font-size:.84rem;font-weight:700;color:#7dd3fc;text-decoration:none}",
    ".efi-cap-link:hover{text-decoration:underline}",
    ".efi-cap-form{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}",
    ".efi-cap-form input,.efi-cap-form button{font-family:inherit;font-size:.87rem}",
    ".efi-cap-form input{padding:12px 14px;border-radius:11px;border:1px solid rgba(148,163,184,.35);",
    "background:rgba(4,12,24,.6);color:#eef6ff;width:100%}",
    ".efi-cap-form input::placeholder{color:#7f9ec0}",
    ".efi-cap-form input:focus{outline:none;border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.16)}",
    ".efi-cap-form button{padding:12px 20px;border-radius:11px;border:0;background:#dc2626;",
    "color:#fff;font-weight:900;cursor:pointer;white-space:nowrap}",
    ".efi-cap-form button[disabled]{opacity:.6;cursor:progress}",
    ".efi-cap-msg{grid-column:1/-1;margin:0;font-size:.83rem;line-height:1.6;color:#a8c8e8}",
    ".efi-cap-msg.ok{color:#34d399}.efi-cap-msg.err{color:#fb7185}",
    "@media (max-width:520px){.efi-capture{margin-inline:16px}",
    ".efi-cap-form{grid-template-columns:1fr}}",

    ".efi-legal{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:center;",
    "padding:14px 16px 18px;font-size:.75rem;line-height:1.7;opacity:.72;text-align:center}",
    ".efi-legal span{white-space:nowrap}",
    "@media (max-width:600px){.efi-legal{font-size:.7rem;gap:4px 12px}",
    ".efi-legal span{white-space:normal}}",
  ].join("");

  function injectStyles() {
    if (document.getElementById("efi-conversion-kit-css")) return;
    var s = document.createElement("style");
    s.id = "efi-conversion-kit-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ─────────────────────────── icons ─────────────────────────── */

  var WA_PATH =
    "M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91C21.95 6.45 17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.71-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.84-.2-.48-.4-.42-.55-.43h-.47c-.16 0-.43.06-.65.31-.22.24-.85.83-.85 2.03s.88 2.35 1 2.51c.12.17 1.72 2.63 4.17 3.69.58.25 1.04.4 1.39.51.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29z";
  var TEL_PATH =
    "M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z";

  function icon(path) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "efi-dock__ico");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path);
    svg.appendChild(p);
    return svg;
  }

  /* ─────────────────── 1. persistent contact dock ─────────────────── */

  /**
   * Builds the WhatsApp message that opens with the visitor's actual context,
   * so the sales team receives a qualified message instead of a bare "hello".
   */
  function contextMessage() {
    var title = (document.title || "").split("|")[0].trim();
    return t(
      "السلام عليكم، أتواصل معكم بخصوص: " + title,
      "Hello, I'm contacting you regarding: " + title
    );
  }

  function buildDock(cfg) {
    if (document.querySelector(".efi-dock")) return;

    var wa = cfg.contact.phoneWhatsapp.e164;
    var tel = cfg.contact.phonePrimary.e164;

    var waBtn = el(
      "a",
      {
        class: "efi-dock__btn efi-dock__btn--wa",
        href: waLink(wa, contextMessage()),
        target: "_blank",
        rel: "noopener",
        "aria-label": t("تواصل عبر واتساب", "Contact us on WhatsApp"),
        "data-efi-contact": "whatsapp",
        "data-efi-location": "dock",
      },
      [icon(WA_PATH), el("span", { class: "efi-dock__label", text: t("واتساب", "WhatsApp") })]
    );

    var telBtn = el(
      "a",
      {
        class: "efi-dock__btn efi-dock__btn--tel",
        href: "tel:" + tel,
        "aria-label": t("اتصل بنا الآن", "Call us now"),
        "data-efi-contact": "phone",
        "data-efi-location": "dock",
      },
      [
        icon(TEL_PATH),
        el("span", {
          class: "efi-dock__label",
          text: cfg.contact.phonePrimary.display,
          dir: "ltr",
        }),
      ]
    );

    document.body.appendChild(
      el("div", { class: "efi-dock", role: "complementary", "aria-label": t("تواصل سريع", "Quick contact") }, [
        waBtn,
        telBtn,
      ])
    );
  }

  /* ─────────────────── 2. header click-to-call ─────────────────── */

  function buildHeaderPhone(cfg) {
    var nav = document.querySelector(".site-header__nav");
    if (!nav || nav.querySelector(".efi-hdr-tel")) return;

    var link = el(
      "a",
      {
        class: "efi-hdr-tel",
        href: "tel:" + cfg.contact.phonePrimary.e164,
        "aria-label": t("اتصل بنا", "Call us"),
        "data-efi-contact": "phone",
        "data-efi-location": "header",
      },
      [icon(TEL_PATH), el("span", { text: cfg.contact.phonePrimary.display, dir: "ltr" })]
    );

    var cta = nav.querySelector(".site-header__cta");
    if (cta) nav.insertBefore(link, cta);
    else nav.appendChild(link);
  }

  /* ─────────────────── 2b. legal identity bar ─────────────────── */

  /**
   * Saudi B2B buyers verify a supplier's Commercial Registration and VAT number
   * before they will request a quote, and finance departments require the VAT
   * number to raise a purchase order. Publishing both, plus the National Address,
   * removes the single largest trust objection on the site.
   */
  function buildLegalBar(cfg) {
    var reg = cfg.registration;
    if (!reg || !reg.commercialRegistration) return;

    var footer = document.getElementById("site-footer") || document.querySelector("footer");
    if (!footer || footer.querySelector(".efi-legal")) return;

    var l = lang();
    var na = reg.nationalAddress || {};
    var parts = [
      reg.registeredName ? reg.registeredName[l] : "",
      reg.legalForm ? reg.legalForm[l] : "",
      t("سجل تجاري: ", "CR: ") + reg.commercialRegistration,
      t("الرقم الضريبي: ", "VAT: ") + reg.vatNumber,
      na.shortAddress
        ? t("العنوان الوطني: ", "National Address: ") +
          na.shortAddress +
          " — " +
          (na.district ? na.district[l] + "، " : "") +
          (na.city ? na.city[l] : "") +
          " " +
          (na.postalCode || "")
        : "",
    ].filter(Boolean);

    var bar = el("div", { class: "efi-legal" });
    parts.forEach(function (p) {
      bar.appendChild(el("span", { text: p, dir: /^\d/.test(p) ? "ltr" : "auto" }));
    });

    footer.appendChild(bar);
  }

  /* ─────────────────── 3. contact-intent tracking ─────────────────── */

  /**
   * One delegated listener covers every tel:/wa.me link on the page, including
   * links rendered later by site-shell.js or by this module itself.
   */
  function bindTracking() {
    document.addEventListener(
      "click",
      function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
        if (!a) return;
        var href = a.getAttribute("href") || "";
        var channel = a.getAttribute("data-efi-contact");
        if (!channel) {
          if (href.indexOf("tel:") === 0) channel = "phone";
          else if (/wa\.me|api\.whatsapp\.com/.test(href)) channel = "whatsapp";
        }
        if (!channel) return;
        trackContact(channel, a.getAttribute("data-efi-location") || "inline");
      },
      true
    );
  }

  /* ─────────────────── 4. calculator lead capture ─────────────────── */

  function readCalcResult() {
    function txt(id) {
      var n = document.getElementById(id);
      return n ? n.textContent.trim() : "";
    }
    var kw = txt("result-kw");
    if (!kw) return null;
    return { kw: kw, rt: txt("result-rt"), vol: txt("result-vol") };
  }

  function calcMessage(r) {
    return t(
      "السلام عليكم، استخدمت حاسبة أحمال غرف التبريد لديكم والنتيجة:\n" +
        "• الحمل الحراري: " +
        r.kw +
        " kW\n" +
        "• طن التبريد: " +
        r.rt +
        "\n" +
        "• الحجم: " +
        r.vol +
        "\nأرجو تزويدي بعرض سعر هندسي.",
      "Hello, I used your cold room load calculator and got:\n" +
        "• Thermal load: " +
        r.kw +
        " kW\n" +
        "• Refrigeration tons: " +
        r.rt +
        "\n" +
        "• Volume: " +
        r.vol +
        "\nPlease send me an engineering quote."
    );
  }

  function buildCalcCapture(cfg, host) {
    var result = readCalcResult();
    if (!result) return;

    // Carried into the stored contact event, so a tap from here is recorded
    // together with the load the visitor had just calculated.
    lastCalcContext = result.kw + " kW / " + result.rt + " / " + result.vol;

    var existing = host.querySelector(".efi-calc-capture");
    if (existing) {
      var waNode = existing.querySelector("a.wa");
      if (waNode) waNode.href = waLink(cfg.contact.phoneWhatsapp.e164, calcMessage(result));
      var payload = existing.querySelector('input[name="calc_result"]');
      if (payload) payload.value = result.kw + " kW / " + result.rt + " / " + result.vol;
      return;
    }

    var box = el("div", { class: "efi-calc-capture" });

    box.appendChild(
      el("h3", {
        text: t("حوّل هذه النتيجة إلى عرض سعر", "Turn this result into a quote"),
      })
    );
    box.appendChild(
      el("p", {
        text: t(
          "أرسل نتيجة الحساب لمهندسينا مباشرة، أو اترك رقمك ونتصل بك خلال " +
            (cfg.responsePromise && cfg.responsePromise.callbackMinutes
              ? cfg.responsePromise.callbackMinutes
              : 15) +
            " دقيقة في أوقات العمل.",
          "Send this result straight to our engineers, or leave your number and we will call you back within " +
            (cfg.responsePromise && cfg.responsePromise.callbackMinutes
              ? cfg.responsePromise.callbackMinutes
              : 15) +
            " minutes during working hours."
        ),
      })
    );

    var actions = el("div", { class: "efi-calc-actions" }, [
      el(
        "a",
        {
          class: "wa",
          href: waLink(cfg.contact.phoneWhatsapp.e164, calcMessage(result)),
          target: "_blank",
          rel: "noopener",
          "data-efi-contact": "whatsapp",
          "data-efi-location": "calculator-result",
        },
        [icon(WA_PATH), el("span", { text: t("أرسل النتيجة على واتساب", "Send result on WhatsApp") })]
      ),
      el(
        "a",
        {
          class: "tel",
          href: "tel:" + cfg.contact.phonePrimary.e164,
          "data-efi-contact": "phone",
          "data-efi-location": "calculator-result",
        },
        [icon(TEL_PATH), el("span", { text: t("تحدث مع مهندس الآن", "Talk to an engineer now") })]
      ),
    ]);
    box.appendChild(actions);

    var msg = el("p", { class: "efi-calc-msg", role: "status", "aria-live": "polite" });

    var form = el("form", { class: "efi-calc-form", novalidate: "novalidate" });
    var nameInput = el("input", {
      type: "text",
      name: "name",
      id: "efi-calc-name",
      required: "required",
      autocomplete: "name",
      placeholder: t("الاسم أو اسم المنشأة", "Name or company"),
      "aria-label": t("الاسم أو اسم المنشأة", "Name or company"),
    });
    var phoneInput = el("input", {
      type: "tel",
      name: "phone",
      id: "efi-calc-phone",
      required: "required",
      inputmode: "tel",
      autocomplete: "tel",
      dir: "ltr",
      placeholder: t("رقم الجوال", "Mobile number"),
      "aria-label": t("رقم الجوال", "Mobile number"),
    });
    var hpInput = el("input", {
      type: "text",
      name: "botcheck",
      id: "efi-calc-botcheck",
      class: "efi-hp",
      tabindex: "-1",
      autocomplete: "off",
      "aria-hidden": "true",
    });
    var payloadInput = el("input", {
      type: "hidden",
      name: "calc_result",
      id: "efi-calc-payload",
      value: result.kw + " kW / " + result.rt + " / " + result.vol,
    });
    var subjectInput = el("input", {
      type: "hidden",
      name: "subject",
      id: "efi-calc-subject",
      value: t("طلب عرض سعر من حاسبة الأحمال", "Quote request from load calculator"),
    });
    var submit = el("button", {
      type: "submit",
      id: "efi-calc-submit",
      text: t("اتصلوا بي", "Call me back"),
    });

    [nameInput, phoneInput, hpInput, payloadInput, subjectInput, submit, msg].forEach(function (n) {
      form.appendChild(n);
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!nameInput.value.trim() || !phoneInput.value.trim()) {
        msg.className = "efi-calc-msg err";
        msg.textContent = t(
          "يرجى إدخال الاسم ورقم الجوال.",
          "Please enter your name and mobile number."
        );
        return;
      }
      submit.disabled = true;
      msg.className = "efi-calc-msg";
      msg.textContent = t("جارٍ الإرسال…", "Sending…");

      var body = {
        name: nameInput.value.trim(),
        phone: phoneInput.value.trim(),
        subject: subjectInput.value,
        calc_result: payloadInput.value,
        botcheck: hpInput.value,
        source: "cold-room-calculator",
        page: window.location.pathname,
      };

      fetch(QUOTE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return { success: res.ok };
          });
        })
        .then(function (json) {
          if (json && json.success) {
            msg.className = "efi-calc-msg ok";
            msg.textContent = t(
              "تم الاستلام. سيتصل بك مهندس قريباً.",
              "Received. An engineer will call you shortly."
            );
            form.reset();
            if (!hpInput.value) {
              gtagPush("event", "generate_lead", {
                lead_source: "calculator_form",
                page_path: window.location.pathname,
              });
            }
          } else {
            msg.className = "efi-calc-msg err";
            msg.textContent =
              (json && json.message) ||
              t("تعذّر الإرسال. جرّب واتساب أعلاه.", "Could not send. Try WhatsApp above.");
          }
        })
        .catch(function () {
          msg.className = "efi-calc-msg err";
          msg.textContent = t(
            "تعذّر الاتصال بالخادم. جرّب واتساب أعلاه.",
            "Could not reach the server. Try WhatsApp above."
          );
        })
        .then(function () {
          submit.disabled = false;
        });
    });

    box.appendChild(form);
    host.appendChild(box);
  }

  /**
   * The calculator's own script reveals #result-cta by removing `hidden`.
   * Watching that attribute keeps this module fully decoupled from the
   * calculator's internals, and works on both the Arabic and English pages.
   */
  function watchCalculator(cfg) {
    var host = document.getElementById("result-cta");
    if (!host) return;

    function sync() {
      if (!host.classList.contains("hidden")) buildCalcCapture(cfg, host);
    }

    new MutationObserver(sync).observe(host, {
      attributes: true,
      attributeFilter: ["class"],
    });
    sync();
  }

  /* ─────────────── 5. contextual lead capture ─────────────── */

  /**
   * Cities addressed by the /cold-rooms-<slug>.html landing pages, so a city
   * page can offer a quote that names the visitor's own city.
   */
  var CITIES = {
    riyadh: { ar: "الرياض", en: "Riyadh" },
    jeddah: { ar: "جدة", en: "Jeddah" },
    dammam: { ar: "الدمام", en: "Dammam" },
    khobar: { ar: "الخبر", en: "Khobar" },
    jubail: { ar: "الجبيل", en: "Jubail" },
    makkah: { ar: "مكة المكرمة", en: "Makkah" },
    medina: { ar: "المدينة المنورة", en: "Medina" },
    abha: { ar: "أبها", en: "Abha" },
    tabuk: { ar: "تبوك", en: "Tabuk" },
    hail: { ar: "حائل", en: "Hail" },
    buraidah: { ar: "بريدة", en: "Buraydah" },
    "al-ahsa": { ar: "الأحساء", en: "Al-Ahsa" },
    "hafr-al-batin": { ar: "حفر الباطن", en: "Hafr Al-Batin" },
    qatif: { ar: "القطيف", en: "Qatif" },
  };

  /**
   * A generic "contact us" block converts far worse than an offer that answers
   * the exact problem the visitor was reading about. These map the highest-value
   * article slugs onto the commercial service that solves that problem.
   */
  var ARTICLE_OFFERS = {
    "bitzer-maintenance": {
      ar: ["ضاغط Bitzer لديك يحتاج فحصاً؟", "احجز فحص ضاغط ميدانياً، أو اطلب عرض عقد صيانة سنوي يغطي الضاغط بالكامل."],
      en: ["Does your Bitzer compressor need inspection?", "Book an on-site compressor inspection, or request an annual contract that covers it fully."],
      cta: "maintenance",
    },
    "condensing-unit-maintenance": {
      ar: ["وحدة تكثيف تحتاج صيانة؟", "زيارة فحص ميدانية تحدد حالة الوحدة وتكلفة الإصلاح قبل أن تلتزم بشيء."],
      en: ["A condensing unit due for service?", "An on-site visit establishes condition and repair cost before you commit to anything."],
      cta: "maintenance",
    },
    "chiller-preventive-maintenance": {
      ar: ["تشغّل مبرداً صناعياً؟", "عقد صيانة وقائية للمبردات بزيارات مجدولة وزمن استجابة ملزم."],
      en: ["Running an industrial chiller?", "A preventive chiller contract with scheduled visits and a binding response time."],
      cta: "maintenance",
    },
    "danfoss-controller-setting": {
      ar: ["متحكماتك تحتاج معايرة؟", "مهندس يضبط متحكمات Danfoss ودورات الديفروست في موقعك — وغالباً ما يخفض الفاتورة فوراً."],
      en: ["Controllers need calibrating?", "An engineer tunes your Danfoss controllers and defrost cycles on site — usually cutting the bill immediately."],
      cta: "quote",
    },
    "refrigeration-gas-leak": {
      ar: ["تشك في تسريب غاز التبريد؟", "كشف تسريب ميداني بأجهزة معايرة — قبل أن يتحول إلى عطل كامل."],
      en: ["Suspect a refrigerant leak?", "On-site leak detection with calibrated instruments — before it becomes a full failure."],
      cta: "quote",
    },
    "energy-saving-tips": {
      ar: ["فاتورة الكهرباء مرتفعة؟", "تدقيق طاقة لغرفتك القائمة يحدد أين يضيع الاستهلاك وكم يمكن توفيره."],
      en: ["Electricity bill too high?", "An energy audit of your existing room shows where consumption leaks and how much is recoverable."],
      cta: "quote",
    },
    "cold-room-load-calculation": {
      ar: ["تخطط لغرفة تبريد؟", "أرسل أبعادك ويصلك حساب حمل حراري ودراسة هندسية من مهندس مختص."],
      en: ["Planning a cold room?", "Send your dimensions and receive a thermal load calculation and engineering study from a specialist."],
      cta: "quote",
    },
    "iqf-technology-guide": {
      ar: ["تدرس نظام تجميد صاعق؟", "دراسة IQF لمنتجك تحدد السعة والزمن والقدرة المطلوبة قبل الاستثمار."],
      en: ["Evaluating a blast freezing system?", "An IQF study for your product sets capacity, cycle time and required power before you invest."],
      cta: "quote",
    },
    "ammonia-refrigeration-systems": {
      ar: ["تفكر في نظام أمونيا NH3؟", "دراسة جدوى فنية لأنظمة الأمونيا مع خطة الالتزام بمعايير السلامة."],
      en: ["Considering an NH3 ammonia system?", "A technical feasibility study for ammonia systems with a safety-compliance plan."],
      cta: "quote",
    },
    "sandwich-panel-specs": {
      ar: ["تختار مواصفة العزل؟", "مهندس يحدد سماكة PIR/PUR المناسبة لدرجة حرارتك المستهدفة ويصدر عرض سعر."],
      en: ["Choosing insulation specs?", "An engineer sets the right PIR/PUR thickness for your target temperature and issues a quote."],
      cta: "quote",
    },
  };

  var DEFAULTS = {
    article: {
      ar: ["تحتاج مهندساً بدل مقال؟", "اترك رقمك ويتواصل معك مهندس تبريد صناعي لمناقشة حالتك تحديداً."],
      en: ["Need an engineer, not an article?", "Leave your number and an industrial refrigeration engineer will call to discuss your specific case."],
      cta: "quote",
    },
    city: {
      ar: ["عرض سعر لمشروعك في {city}", "اترك رقمك ويصلك عرض سعر هندسي لغرفة تبريد أو تجميد في {city}."],
      en: ["A quote for your project in {city}", "Leave your number and receive an engineering quote for a cold or freezer room in {city}."],
      cta: "quote",
    },
    industry: {
      ar: ["حلول تبريد لقطاعك", "اترك رقمك ويتواصل معك مهندس يعرف متطلبات قطاعك ودرجات الحرارة المطلوبة فيه."],
      en: ["Refrigeration built for your sector", "Leave your number and an engineer familiar with your sector's temperature requirements will call."],
      cta: "quote",
    },
    generic: {
      ar: ["اطلب عرض سعر هندسي", "اترك رقمك ويتواصل معك مهندس خلال أوقات العمل."],
      en: ["Request an engineering quote", "Leave your number and an engineer will contact you during working hours."],
      cta: "quote",
    },
  };

  /** Classifies the current page so the injected offer matches what is on it. */
  function pageContext() {
    var p = window.location.pathname;
    var l = lang();

    var city = p.match(/cold-rooms-([a-z-]+?)(?:-en)?\.html/);
    if (city && CITIES[city[1]]) {
      var name = CITIES[city[1]][l];
      var d = DEFAULTS.city;
      return {
        kind: "city",
        slug: city[1],
        title: d[l][0].replace("{city}", name),
        body: d[l][1].replace("{city}", name),
        cta: d.cta,
      };
    }

    var art = p.match(/\/assets\/articles\/([a-z0-9-]+?)(?:-ar|-en)?\.html/);
    if (art) {
      var o = ARTICLE_OFFERS[art[1]] || DEFAULTS.article;
      return { kind: "article", slug: art[1], title: o[l][0], body: o[l][1], cta: o.cta };
    }

    if (/\/industries\//.test(p)) {
      return { kind: "industry", slug: "industry", title: DEFAULTS.industry[l][0], body: DEFAULTS.industry[l][1], cta: DEFAULTS.industry.cta };
    }

    return { kind: "page", slug: "generic", title: DEFAULTS.generic[l][0], body: DEFAULTS.generic[l][1], cta: DEFAULTS.generic.cta };
  }

  /**
   * Posts a mini-form to the same /api/quote endpoint the main forms use, so
   * every lead lands in one D1 table regardless of which page produced it.
   */
  function wireMiniForm(form, ctx) {
    var msg = form.querySelector(".efi-cap-msg");
    var submit = form.querySelector("button[type=submit]");
    var fields = {
      name: form.querySelector('[name="name"]'),
      phone: form.querySelector('[name="phone"]'),
      need: form.querySelector('[name="need"]'),
      hp: form.querySelector('[name="botcheck"]'),
    };

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!fields.name.value.trim() || !fields.phone.value.trim()) {
        msg.className = "efi-cap-msg err";
        msg.textContent = t("يرجى إدخال الاسم ورقم الجوال.", "Please enter your name and mobile number.");
        return;
      }
      submit.disabled = true;
      msg.className = "efi-cap-msg";
      msg.textContent = t("جارٍ الإرسال…", "Sending…");

      fetch(QUOTE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.name.value.trim(),
          phone: fields.phone.value.trim(),
          need: fields.need ? fields.need.value.trim() : "",
          subject: t("طلب من ", "Request from ") + document.title.split("|")[0].trim(),
          source: ctx.kind + ":" + ctx.slug,
          page: window.location.pathname,
          botcheck: fields.hp.value,
        }),
      })
        .then(function (r) { return r.json().catch(function () { return { success: r.ok }; }); })
        .then(function (json) {
          if (json && json.success) {
            msg.className = "efi-cap-msg ok";
            msg.textContent = t(
              "تم الاستلام. سيتواصل معك مهندس قريباً.",
              "Received. An engineer will contact you shortly."
            );
            form.reset();
            if (!fields.hp.value) {
              gtagPush("event", "generate_lead", {
                lead_source: "inline_capture",
                lead_context: ctx.kind + ":" + ctx.slug,
                page_path: window.location.pathname,
              });
            }
          } else {
            msg.className = "efi-cap-msg err";
            msg.textContent =
              (json && json.message) || t("تعذّر الإرسال. جرّب واتساب.", "Could not send. Try WhatsApp.");
          }
        })
        .catch(function () {
          msg.className = "efi-cap-msg err";
          msg.textContent = t("تعذّر الاتصال بالخادم. جرّب واتساب.", "Could not reach the server. Try WhatsApp.");
        })
        .then(function () { submit.disabled = false; });
    });
  }

  /**
   * Injects the capture block on any page that has no form of its own — which,
   * before this module existed, was 120 of the site's 124 pages.
   */
  function buildCapture(cfg) {
    if (document.querySelector(".efi-capture")) return;
    if (document.querySelector("form:not(.efi-calc-form)")) return; // page already converts

    var main = document.querySelector("main") || document.body;
    if (!main) return;

    var ctx = pageContext();
    var waNum = String(cfg.contact.phoneWhatsapp.e164).replace(/\D/g, "");
    var waText = t(
      "السلام عليكم، بخصوص: " + document.title.split("|")[0].trim(),
      "Hello, regarding: " + document.title.split("|")[0].trim()
    );

    var box = el("section", { class: "efi-capture", "aria-labelledby": "efi-cap-title" });
    box.appendChild(el("h2", { id: "efi-cap-title", class: "efi-cap-title", text: ctx.title }));
    box.appendChild(el("p", { class: "efi-cap-body", text: ctx.body }));

    var quick = el("div", { class: "efi-cap-quick" }, [
      el("a", {
        class: "efi-cap-wa",
        href: waLink(waNum, waText),
        target: "_blank",
        rel: "noopener",
        "data-efi-contact": "whatsapp",
        "data-efi-location": "inline-capture",
        text: t("واتساب فوري", "WhatsApp now"),
      }),
      el("a", {
        class: "efi-cap-tel",
        href: "tel:" + cfg.contact.phonePrimary.e164,
        "data-efi-contact": "phone",
        "data-efi-location": "inline-capture",
        text: t("اتصل: ", "Call: ") + cfg.contact.phonePrimary.display,
        dir: "auto",
      }),
    ]);
    if (ctx.cta === "maintenance") {
      quick.appendChild(
        el("a", {
          class: "efi-cap-link",
          href: lang() === "en" ? "/maintenance-contracts-en.html" : "/maintenance-contracts.html",
          text: t("باقات عقود الصيانة ←", "Maintenance plans →"),
        })
      );
    }
    box.appendChild(quick);

    var form = el("form", { class: "efi-cap-form", novalidate: "novalidate" });
    var uid = "efi-cap-";
    form.appendChild(el("input", {
      type: "text", name: "name", id: uid + "name", autocomplete: "organization",
      placeholder: t("الاسم أو اسم المنشأة", "Name or company"),
      "aria-label": t("الاسم أو اسم المنشأة", "Name or company"),
    }));
    form.appendChild(el("input", {
      type: "tel", name: "phone", id: uid + "phone", inputmode: "tel", autocomplete: "tel", dir: "ltr",
      placeholder: t("رقم الجوال", "Mobile number"),
      "aria-label": t("رقم الجوال", "Mobile number"),
    }));
    form.appendChild(el("input", {
      type: "text", name: "need", id: uid + "need",
      placeholder: t("ما الذي تحتاجه؟ (اختياري)", "What do you need? (optional)"),
      "aria-label": t("ما الذي تحتاجه؟", "What do you need?"),
    }));
    form.appendChild(el("input", {
      type: "text", name: "botcheck", id: uid + "botcheck", class: "efi-hp",
      tabindex: "-1", autocomplete: "off", "aria-hidden": "true",
    }));
    form.appendChild(el("button", {
      type: "submit", id: uid + "submit",
      text: t("اتصلوا بي", "Call me back"),
    }));
    form.appendChild(el("p", { class: "efi-cap-msg", role: "status", "aria-live": "polite" }));

    box.appendChild(form);
    wireMiniForm(form, ctx);
    main.appendChild(box);
  }

  /* ─────────────────────────── bootstrap ─────────────────────────── */

  function start(cfg) {
    if (!cfg || !cfg.contact || !cfg.contact.phonePrimary) return;
    injectStyles();
    buildDock(cfg);
    buildHeaderPhone(cfg);
    buildLegalBar(cfg);
    buildCapture(cfg);
    watchCalculator(cfg);

    // site-shell.js renders the header and footer asynchronously; retry until
    // both exist, then stop. Bounded so a page without a shell never spins.
    var tries = 0;
    var timer = setInterval(function () {
      buildHeaderPhone(cfg);
      buildLegalBar(cfg);
      var done = document.querySelector(".efi-hdr-tel") && document.querySelector(".efi-legal");
      if (++tries > 20 || done) clearInterval(timer);
    }, 250);
  }

  function boot() {
    bindTracking();
    fetch(CONFIG_URL, { credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("config " + res.status);
        return res.json();
      })
      .then(start)
      .catch(function () {
        /* no config → dock is skipped; delegated tracking still works */
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

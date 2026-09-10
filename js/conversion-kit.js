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
    return (document.documentElement.lang || "ar").toLowerCase().indexOf("en") === 0 ? "en" : "ar";
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

  /* ─────────────────────────── icons ─────────────────────────── */

  var WA_PATH =
    "M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91C21.95 6.45 17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.71-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.84-.2-.48-.4-.42-.55-.43h-.47c-.16 0-.43.06-.65.31-.22.24-.85.83-.85 2.03s.88 2.35 1 2.51c.12.17 1.72 2.63 4.17 3.69.58.25 1.04.4 1.39.51.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29z";
  var TEL_PATH =
    "M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z";

  function icon(path) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    // Explicit dimensions, not only CSS: if a stylesheet ever fails to apply,
    // an SVG with no intrinsic size expands to fill its container. That is
    // exactly how these icons once rendered 746px tall on the live site.
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path);
    svg.appendChild(p);
    return svg;
  }

  /* ─────────────────── 1. the site's own WhatsApp button ─────────────────── */

  /**
   * site-shell.js already renders a floating WhatsApp button (.wa-fab) with its
   * own balloon and badge. This module must not add a second one — it enhances
   * the existing button instead:
   *
   *   - rewrites its href so the outgoing message carries the page reference
   *     code, the same code the admin panel indexes;
   *   - tags it so the delegated click listener records the tap with a precise
   *     location instead of the generic "inline".
   *
   * The delegated listener already matches any wa.me link, so tracking works
   * even if this runs before site-shell has rendered; this only improves the
   * detail. Bounded retries cover the async render.
   */
  function enhanceSiteWhatsApp() {
    var fab = document.querySelector("a.wa-fab");
    if (!fab || fab.getAttribute("data-efi-contact")) return true;

    var href = fab.getAttribute("href") || "";
    if (/wa\.me|api\.whatsapp\.com/.test(href)) {
      var base = href.split("?")[0];
      var existing = "";
      var qs = href.indexOf("?text=");
      if (qs > -1) {
        try {
          existing = decodeURIComponent(href.slice(qs + 6));
        } catch (_) {
          existing = "";
        }
      }
      // Never stack the reference twice if this runs again.
      if (existing.indexOf(pageRef) === -1) {
        var message = withRef(existing || contextMessage());
        fab.setAttribute("href", base + "?text=" + encodeURIComponent(message));
      }
    }

    fab.setAttribute("data-efi-contact", "whatsapp");
    fab.setAttribute("data-efi-location", "floating-button");
    return true;
  }

  /* ─────────────── 1b. floating click-to-call button ─────────────── */

  /**
   * Adds a click-to-call button as a sibling of the existing WhatsApp button,
   * inside the same `#wa-widget` stack.
   *
   * Rationale: roughly half of this site's traffic is mobile, where a phone
   * number rendered as text is not a call — it is a number the visitor must
   * memorise, leave the page for, and retype. The header link added by
   * buildHeaderPhone scrolls out of view within one screen, so on every page
   * below the fold the site offered exactly one contact channel. Buyers who
   * will not open WhatsApp with a supplier they have not met had no way to
   * reach the company without leaving.
   *
   * It is injected into the existing widget rather than into a stack of its
   * own so the two buttons share one flex column, one gap and one z-index —
   * a second fixed container is what produced the overlapping controls the
   * owner reported previously.
   */
  function buildCallFab(cfg) {
    var widget = document.getElementById("wa-widget");
    if (!widget || widget.querySelector(".efi-call-fab")) return false;

    var fab = widget.querySelector("a.wa-fab");
    var link = el(
      "a",
      {
        class: "efi-call-fab",
        href: "tel:" + cfg.contact.phonePrimary.e164,
        "aria-label": t("اتصل بنا هاتفيًّا: ", "Call us: ") + cfg.contact.phonePrimary.display,
        "data-efi-contact": "phone",
        "data-efi-location": "floating-button",
      },
      [icon(TEL_PATH)]
    );

    // Above the WhatsApp button: the bottom slot stays with the channel that
    // already carries the traffic, and no existing tap target moves.
    if (fab) widget.insertBefore(link, fab);
    else widget.appendChild(link);
    return true;
  }

  /** Fallback message when the site button carries no pre-filled text. */
  function contextMessage() {
    var title = (document.title || "").split("|")[0].trim();
    return t(
      "السلام عليكم، أتواصل معكم بخصوص: " + title,
      "Hello, I'm contacting you regarding: " + title
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

    /**
     * Each entry is either plain text, or a label plus a registry number.
     * The number is wrapped in <bdi> so the bidirectional algorithm isolates
     * it: without that, Latin digits sitting next to Arabic run together and
     * read as one string ("7028430937الرقم الضريبي").
     */
    var items = [
      { text: reg.registeredName ? reg.registeredName[l] : "" },
      { text: reg.legalForm ? reg.legalForm[l] : "" },
      { label: t("سجل تجاري", "CR"), value: reg.commercialRegistration },
      { label: t("الرقم الضريبي", "VAT"), value: reg.vatNumber },
    ];

    if (na.shortAddress) {
      items.push({
        label: t("العنوان الوطني", "National Address"),
        value: na.shortAddress,
        after:
          " — " +
          (na.district ? na.district[l] + "، " : "") +
          (na.city ? na.city[l] : "") +
          (na.postalCode ? " " + na.postalCode : ""),
      });
    }

    var bar = el("div", { class: "efi-legal" });

    items.forEach(function (item) {
      if (!item.text && !item.value) return;
      var span = el("span", { class: "efi-legal__item" });

      if (item.text) {
        span.appendChild(document.createTextNode(item.text));
      } else {
        span.appendChild(document.createTextNode(item.label + ": "));
        var bdi = document.createElement("bdi");
        bdi.textContent = item.value;
        span.appendChild(bdi);
        if (item.after) span.appendChild(document.createTextNode(item.after));
      }

      bar.appendChild(span);
    });

    footer.appendChild(bar);
  }

  /* ─────────────────── 2c. contact details panel ─────────────────── */

  var DAY_NAMES = {
    Sunday: { ar: "الأحد", en: "Sunday" },
    Monday: { ar: "الاثنين", en: "Monday" },
    Tuesday: { ar: "الثلاثاء", en: "Tuesday" },
    Wednesday: { ar: "الأربعاء", en: "Wednesday" },
    Thursday: { ar: "الخميس", en: "Thursday" },
    Friday: { ar: "الجمعة", en: "Friday" },
    Saturday: { ar: "السبت", en: "Saturday" },
  };

  /** "Sunday–Thursday 08:00–17:00" from one openingHours entry. */
  function hoursLine(entry) {
    var l = lang();
    var days = entry.dayOfWeek || [];
    var label =
      days.length > 1
        ? DAY_NAMES[days[0]][l] + " – " + DAY_NAMES[days[days.length - 1]][l]
        : days.length === 1
          ? DAY_NAMES[days[0]][l]
          : "";
    return { days: label, time: entry.opens + " – " + entry.closes };
  }

  /** Registered company name in the active language, with a trailing space. */
  function orgName(cfg, l) {
    var org = cfg.organization || {};
    var name = l === "en" ? org.legalNameEn : org.legalNameAr;
    return name ? name + " " : "";
  }

  /** Postal-address string used both for display and for the map query. */
  function addressLine(cfg) {
    var na = (cfg.registration && cfg.registration.nationalAddress) || {};
    var l = lang();
    var parts = [];
    if (na.buildingNumber) parts.push(na.buildingNumber);
    if (na.district) parts.push(na.district[l]);
    if (na.city) parts.push(na.city[l]);
    if (na.postalCode) parts.push(na.postalCode);
    parts.push(t("المملكة العربية السعودية", "Saudi Arabia"));
    // The Arabic comma is a different character; using it on the English page
    // rendered the address in a script the reader does not expect.
    return parts.join(t("، ", ", "));
  }

  /**
   * Renders the company's address, hours and every contact channel into the
   * `[data-efi-contact-panel]` placeholder on the contact pages.
   *
   * Rationale: the contact page carried a quote form and nothing else — no
   * address, no working hours, no phone, no e-mail. For a Saudi B2B buyer that
   * reads as a company that cannot be visited or called, which is the single
   * cheapest objection to remove before a purchase order is raised. It is
   * rendered from lib/site.config.json rather than written into the two HTML
   * files so the Arabic and English pages can never drift apart.
   *
   * The map is a link, not an embedded frame: the site's CSP allows frames only
   * from challenges.cloudflare.com, and an iframe would also load third-party
   * scripts on the page that must convert fastest.
   */
  function buildContactPanel(cfg) {
    var host = document.querySelector("[data-efi-contact-panel]");
    if (!host || host.querySelector(".efi-contact-panel")) return false;

    var l = lang();
    var address = addressLine(cfg);
    var na = (cfg.registration && cfg.registration.nationalAddress) || {};
    var mapHref =
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(orgName(cfg, l) + address);

    var panel = el("section", {
      class: "efi-contact-panel",
      "aria-labelledby": "efi-contact-panel-title",
    });

    panel.appendChild(
      el("h2", {
        id: "efi-contact-panel-title",
        text: t("بيانات التواصل والزيارة", "Contact & visiting details"),
      })
    );

    var list = el("ul", { class: "efi-contact-list" });

    function row(label, node) {
      var li = el("li");
      li.appendChild(el("span", { class: "efi-contact-label", text: label }));
      li.appendChild(node);
      list.appendChild(li);
    }

    /**
     * Latin text inside an Arabic row.
     *
     * The value goes in a <bdi> rather than on a `dir="ltr"` anchor: `dir`
     * makes the anchor itself an LTR block, so as a grid item on narrow
     * screens it aligned its text to the left while every label stayed on the
     * right. <bdi> isolates the number for the bidirectional algorithm without
     * touching the row's own direction.
     */
    function ltr(text) {
      var bdi = document.createElement("bdi");
      bdi.textContent = text;
      return bdi;
    }

    row(
      t("الهاتف", "Phone"),
      el(
        "a",
        {
          href: "tel:" + cfg.contact.phonePrimary.e164,
          "data-efi-contact": "phone",
          "data-efi-location": "contact-panel",
        },
        [ltr(cfg.contact.phonePrimary.display)]
      )
    );

    row(
      t("واتساب", "WhatsApp"),
      el(
        "a",
        {
          href: waLink(cfg.contact.phoneWhatsapp.e164, contextMessage()),
          target: "_blank",
          rel: "noopener",
          "data-efi-contact": "whatsapp",
          "data-efi-location": "contact-panel",
        },
        [ltr(cfg.contact.phoneWhatsapp.display)]
      )
    );

    row(
      t("البريد الإلكتروني", "E-mail"),
      el("a", { href: "mailto:" + cfg.contact.email }, [ltr(cfg.contact.email)])
    );

    var addrWrap = el("span", { class: "efi-contact-value" });
    addrWrap.appendChild(document.createTextNode(address));
    if (na.shortAddress) {
      addrWrap.appendChild(el("br"));
      var short = el("small");
      short.appendChild(
        document.createTextNode(t("العنوان الوطني المختصر: ", "Short national address: "))
      );
      var bdi = document.createElement("bdi");
      bdi.textContent = na.shortAddress;
      short.appendChild(bdi);
      addrWrap.appendChild(short);
    }
    addrWrap.appendChild(el("br"));
    addrWrap.appendChild(
      el("a", {
        class: "efi-contact-map",
        href: mapHref,
        target: "_blank",
        rel: "noopener",
        text: t("افتح الموقع على خرائط جوجل ←", "Open in Google Maps →"),
      })
    );
    row(t("العنوان", "Address"), addrWrap);

    var hours = cfg.openingHours || [];
    if (hours.length) {
      var hoursWrap = el("span", { class: "efi-contact-value" });
      hours.forEach(function (entry, i) {
        var line = hoursLine(entry);
        if (i) hoursWrap.appendChild(el("br"));
        hoursWrap.appendChild(document.createTextNode(line.days + ": "));
        var b = document.createElement("bdi");
        b.textContent = line.time;
        hoursWrap.appendChild(b);
      });
      row(t("أوقات العمل", "Working hours"), hoursWrap);
    }

    if (cfg.emergency && cfg.emergency.enabled && cfg.emergency.label) {
      row(
        t("الطوارئ", "Emergency"),
        el("span", { class: "efi-contact-value", text: cfg.emergency.label[l] })
      );
    }

    panel.appendChild(list);

    if (cfg.responsePromise && cfg.responsePromise.quoteHours) {
      panel.appendChild(
        el("p", {
          class: "efi-contact-promise",
          text: t(
            "نرد على طلبات عروض الأسعار خلال " +
              cfg.responsePromise.quoteHours +
              " ساعة عمل، والعروض الهندسية خلال " +
              cfg.responsePromise.engineeringQuoteHours +
              " ساعة.",
            "Quote requests are answered within " +
              cfg.responsePromise.quoteHours +
              " working hours; engineering quotes within " +
              cfg.responsePromise.engineeringQuoteHours +
              " hours."
          ),
        })
      );
    }

    host.appendChild(panel);
    return true;
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
        [
          icon(WA_PATH),
          el("span", { text: t("أرسل النتيجة على واتساب", "Send result on WhatsApp") }),
        ]
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
      ar: [
        "ضاغط Bitzer لديك يحتاج فحصاً؟",
        "احجز فحص ضاغط ميدانياً، أو اطلب عرض عقد صيانة سنوي يغطي الضاغط بالكامل.",
      ],
      en: [
        "Does your Bitzer compressor need inspection?",
        "Book an on-site compressor inspection, or request an annual contract that covers it fully.",
      ],
      cta: "maintenance",
    },
    "condensing-unit-maintenance": {
      ar: [
        "وحدة تكثيف تحتاج صيانة؟",
        "زيارة فحص ميدانية تحدد حالة الوحدة وتكلفة الإصلاح قبل أن تلتزم بشيء.",
      ],
      en: [
        "A condensing unit due for service?",
        "An on-site visit establishes condition and repair cost before you commit to anything.",
      ],
      cta: "maintenance",
    },
    "chiller-preventive-maintenance": {
      ar: ["تشغّل مبرداً صناعياً؟", "عقد صيانة وقائية للمبردات بزيارات مجدولة وزمن استجابة ملزم."],
      en: [
        "Running an industrial chiller?",
        "A preventive chiller contract with scheduled visits and a binding response time.",
      ],
      cta: "maintenance",
    },
    "danfoss-controller-setting": {
      ar: [
        "متحكماتك تحتاج معايرة؟",
        "مهندس يضبط متحكمات Danfoss ودورات الديفروست في موقعك — وغالباً ما يخفض الفاتورة فوراً.",
      ],
      en: [
        "Controllers need calibrating?",
        "An engineer tunes your Danfoss controllers and defrost cycles on site — usually cutting the bill immediately.",
      ],
      cta: "quote",
    },
    "refrigeration-gas-leak": {
      ar: [
        "تشك في تسريب غاز التبريد؟",
        "كشف تسريب ميداني بأجهزة معايرة — قبل أن يتحول إلى عطل كامل.",
      ],
      en: [
        "Suspect a refrigerant leak?",
        "On-site leak detection with calibrated instruments — before it becomes a full failure.",
      ],
      cta: "quote",
    },
    "energy-saving-tips": {
      ar: [
        "فاتورة الكهرباء مرتفعة؟",
        "تدقيق طاقة لغرفتك القائمة يحدد أين يضيع الاستهلاك وكم يمكن توفيره.",
      ],
      en: [
        "Electricity bill too high?",
        "An energy audit of your existing room shows where consumption leaks and how much is recoverable.",
      ],
      cta: "quote",
    },
    "cold-room-load-calculation": {
      ar: ["تخطط لغرفة تبريد؟", "أرسل أبعادك ويصلك حساب حمل حراري ودراسة هندسية من مهندس مختص."],
      en: [
        "Planning a cold room?",
        "Send your dimensions and receive a thermal load calculation and engineering study from a specialist.",
      ],
      cta: "quote",
    },
    "iqf-technology-guide": {
      ar: [
        "تدرس نظام تجميد صاعق؟",
        "دراسة IQF لمنتجك تحدد السعة والزمن والقدرة المطلوبة قبل الاستثمار.",
      ],
      en: [
        "Evaluating a blast freezing system?",
        "An IQF study for your product sets capacity, cycle time and required power before you invest.",
      ],
      cta: "quote",
    },
    "ammonia-refrigeration-systems": {
      ar: [
        "تفكر في نظام أمونيا NH3؟",
        "دراسة جدوى فنية لأنظمة الأمونيا مع خطة الالتزام بمعايير السلامة.",
      ],
      en: [
        "Considering an NH3 ammonia system?",
        "A technical feasibility study for ammonia systems with a safety-compliance plan.",
      ],
      cta: "quote",
    },
    "sandwich-panel-specs": {
      ar: [
        "تختار مواصفة العزل؟",
        "مهندس يحدد سماكة PIR/PUR المناسبة لدرجة حرارتك المستهدفة ويصدر عرض سعر.",
      ],
      en: [
        "Choosing insulation specs?",
        "An engineer sets the right PIR/PUR thickness for your target temperature and issues a quote.",
      ],
      cta: "quote",
    },
  };

  var DEFAULTS = {
    article: {
      ar: [
        "تحتاج مهندساً بدل مقال؟",
        "اترك رقمك ويتواصل معك مهندس تبريد صناعي لمناقشة حالتك تحديداً.",
      ],
      en: [
        "Need an engineer, not an article?",
        "Leave your number and an industrial refrigeration engineer will call to discuss your specific case.",
      ],
      cta: "quote",
    },
    city: {
      ar: [
        "عرض سعر لمشروعك في {city}",
        "اترك رقمك ويصلك عرض سعر هندسي لغرفة تبريد أو تجميد في {city}.",
      ],
      en: [
        "A quote for your project in {city}",
        "Leave your number and receive an engineering quote for a cold or freezer room in {city}.",
      ],
      cta: "quote",
    },
    industry: {
      ar: [
        "حلول تبريد لقطاعك",
        "اترك رقمك ويتواصل معك مهندس يعرف متطلبات قطاعك ودرجات الحرارة المطلوبة فيه.",
      ],
      en: [
        "Refrigeration built for your sector",
        "Leave your number and an engineer familiar with your sector's temperature requirements will call.",
      ],
      cta: "quote",
    },
    generic: {
      ar: ["اطلب عرض سعر هندسي", "اترك رقمك ويتواصل معك مهندس خلال أوقات العمل."],
      en: [
        "Request an engineering quote",
        "Leave your number and an engineer will contact you during working hours.",
      ],
      cta: "quote",
    },
  };

  /** Classifies the current page so the injected offer matches what is on it. */
  function pageContext() {
    var p = window.location.pathname;
    var l = lang();

    // Cloudflare Pages serves this site with extensionless URLs: a visitor on
    // /cold-rooms-dammam.html is redirected to /cold-rooms-dammam, so
    // location.pathname carries no ".html" in production. Requiring it here
    // made every page fall through to the generic offer — the city and article
    // blocks that exist precisely to name the visitor's own problem were never
    // shown to a single real visitor. The extension is therefore optional and
    // the pattern is anchored at the end of the path.
    var city = p.match(/cold-rooms-([a-z-]+?)(?:-en)?(?:\.html)?$/);
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

    var art = p.match(/\/assets\/articles\/([a-z0-9-]+?)(?:-ar|-en)?(?:\.html)?$/);
    if (art) {
      var o = ARTICLE_OFFERS[art[1]] || DEFAULTS.article;
      return { kind: "article", slug: art[1], title: o[l][0], body: o[l][1], cta: o.cta };
    }

    if (/\/industries\//.test(p)) {
      return {
        kind: "industry",
        slug: "industry",
        title: DEFAULTS.industry[l][0],
        body: DEFAULTS.industry[l][1],
        cta: DEFAULTS.industry.cta,
      };
    }

    return {
      kind: "page",
      slug: "generic",
      title: DEFAULTS.generic[l][0],
      body: DEFAULTS.generic[l][1],
      cta: DEFAULTS.generic.cta,
    };
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
        msg.textContent = t(
          "يرجى إدخال الاسم ورقم الجوال.",
          "Please enter your name and mobile number."
        );
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
        .then(function (r) {
          return r.json().catch(function () {
            return { success: r.ok };
          });
        })
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
              (json && json.message) ||
              t("تعذّر الإرسال. جرّب واتساب.", "Could not send. Try WhatsApp.");
          }
        })
        .catch(function () {
          msg.className = "efi-cap-msg err";
          msg.textContent = t(
            "تعذّر الاتصال بالخادم. جرّب واتساب.",
            "Could not reach the server. Try WhatsApp."
          );
        })
        .then(function () {
          submit.disabled = false;
        });
    });
  }

  /**
   * True when the page already carries a lead form of its own, in which case a
   * second one only splits the visitor's attention.
   *
   * Two forms are explicitly NOT lead forms and must never suppress the block:
   * the newsletter subscription that site-shell.js renders into the footer of
   * every page, and the calculator's own mini-form. Counting the footer form
   * suppressed the capture block site-wide, and since the footer renders
   * asynchronously the outcome also depended on which script finished first.
   *
   * The homepage's hero form sits outside <main>, so this deliberately looks at
   * the whole document rather than at the content container.
   */
  function pageHasLeadForm() {
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      if (f.classList.contains("efi-calc-form") || f.classList.contains("efi-cap-form")) continue;
      if (f.id === "footer-updates-form") continue;
      if (f.closest && f.closest(".site-footer, #site-footer, footer")) continue;
      return true;
    }
    return false;
  }

  /**
   * The container the capture block is appended to.
   *
   * The article pages have no <main>; they wrap their body in <article>. Falling
   * back to document.body would place the block after the footer, so the last
   * resort inserts it before the footer instead.
   */
  function captureHost() {
    return (
      document.querySelector("main") ||
      document.querySelector("article.article-body") ||
      document.querySelector("article") ||
      document.getElementById("main-content") ||
      document.body ||
      null
    );
  }

  /** Appends the block, keeping it above the footer when the host is <body>. */
  function placeCapture(host, box) {
    if (host === document.body) {
      var footer = document.getElementById("site-footer") || document.querySelector("footer");
      if (footer && footer.parentNode === host) {
        host.insertBefore(box, footer);
        return;
      }
    }
    host.appendChild(box);
  }

  /**
   * Injects the capture block on any page that has no lead form of its own —
   * which, before this module existed, was 120 of the site's 124 pages.
   */
  function buildCapture(cfg) {
    if (document.querySelector(".efi-capture")) return;
    if (pageHasLeadForm()) return;

    var main = captureHost();
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
    form.appendChild(
      el("input", {
        type: "text",
        name: "name",
        id: uid + "name",
        autocomplete: "organization",
        placeholder: t("الاسم أو اسم المنشأة", "Name or company"),
        "aria-label": t("الاسم أو اسم المنشأة", "Name or company"),
      })
    );
    form.appendChild(
      el("input", {
        type: "tel",
        name: "phone",
        id: uid + "phone",
        inputmode: "tel",
        autocomplete: "tel",
        dir: "ltr",
        placeholder: t("رقم الجوال", "Mobile number"),
        "aria-label": t("رقم الجوال", "Mobile number"),
      })
    );
    form.appendChild(
      el("input", {
        type: "text",
        name: "need",
        id: uid + "need",
        placeholder: t("ما الذي تحتاجه؟ (اختياري)", "What do you need? (optional)"),
        "aria-label": t("ما الذي تحتاجه؟", "What do you need?"),
      })
    );
    form.appendChild(
      el("input", {
        type: "text",
        name: "botcheck",
        id: uid + "botcheck",
        class: "efi-hp",
        tabindex: "-1",
        autocomplete: "off",
        "aria-hidden": "true",
      })
    );
    form.appendChild(
      el("button", {
        type: "submit",
        id: uid + "submit",
        text: t("اتصلوا بي", "Call me back"),
      })
    );
    form.appendChild(el("p", { class: "efi-cap-msg", role: "status", "aria-live": "polite" }));

    box.appendChild(form);
    wireMiniForm(form, ctx);
    placeCapture(main, box);
  }

  /* ─────────────── 5b. Turnstile failure fallback ─────────────── */

  /**
   * Hides the Turnstile widget when it fails to render.
   *
   * The widget loads from a third-party origin with `async`. When that request
   * is blocked or times out — a content blocker, a corporate proxy, a bad
   * mobile connection — Cloudflare paints a red "can't reach the site /
   * troubleshoot" box directly above the submit button. A buyer who has just
   * filled in their name and number sees an error on the company's own form
   * and leaves. The Worker no longer rejects a request that carries no token,
   * so nothing is lost by removing the broken box: honeypot, payload cap and
   * per-IP rate limit still apply.
   *
   * A widget that renders normally is untouched, and its token is still sent
   * and still verified.
   */
  function guardTurnstile() {
    var boxes = document.querySelectorAll(".cf-turnstile");
    if (!boxes.length) return;

    var deadline = Date.now() + 7000;
    var timer = setInterval(function () {
      var pending = 0;
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        if (box.hidden) continue;
        var frame = box.querySelector("iframe");
        // A rendered widget owns an iframe with a measurable height.
        if (frame && frame.getBoundingClientRect().height > 20) continue;
        if (Date.now() >= deadline) box.hidden = true;
        else pending++;
      }
      if (!pending || Date.now() >= deadline) clearInterval(timer);
    }, 500);
  }

  /* ─────────────── 6. post-submission next steps ─────────────── */

  /**
   * Appends a "what happens next" strip to whatever success state a form shows.
   *
   * Every form on the site ended at a single green line — "تم إرسال طلبك".
   * That is the moment of highest intent in the whole session, and the site
   * did three things wrong with it: it never said when anyone would call back,
   * so the visitor had no reason to stop shopping; it offered no way to reach
   * a human immediately, for the buyer whose need is urgent; and it left the
   * page with nothing to do next. The promise comes from
   * lib/site.config.json, so it can never contradict what the rest of the site
   * claims.
   *
   * Implemented as an observer rather than by editing each form's own bundle:
   * three of the four forms ship minified, and the two languages would drift.
   */
  function watchSuccess(cfg) {
    var watchers = [];

    ["hero-success", "success", "form-success"].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      watchers.push({
        node: node,
        host: node,
        done: function () {
          return !node.hidden && !node.classList.contains("hidden");
        },
      });
    });

    // contact.html replaces the entire form with its own confirmation, so the
    // signal is the submit button going away rather than a class flipping.
    var quote = document.getElementById("quote-form");
    if (quote) {
      watchers.push({
        node: quote,
        host: quote,
        done: function () {
          return !quote.querySelector('button[type="submit"]');
        },
      });
    }

    if (!watchers.length) return;

    watchers.forEach(function (w) {
      var check = function () {
        if (!w.done() || w.host.querySelector(".efi-next")) return;
        w.host.appendChild(buildNextSteps(cfg));
        observer.disconnect();
      };
      var observer = new MutationObserver(check);
      observer.observe(w.node, {
        attributes: true,
        attributeFilter: ["class", "hidden"],
        childList: true,
        subtree: true,
      });
      check();
    });
  }

  function buildNextSteps(cfg) {
    var promise = cfg.responsePromise || {};
    var hours = promise.quoteHours || 24;
    var minutes = promise.callbackMinutes || 15;

    var box = el("div", { class: "efi-next", role: "status", "aria-live": "polite" });
    box.appendChild(
      el("p", { class: "efi-next__title", text: t("ماذا يحدث الآن؟", "What happens next?") })
    );

    var steps = el("ol", { class: "efi-next__steps" });
    [
      t(
        "وصل طلبك إلى فريقنا ومعه تفاصيل صفحتك.",
        "Your request reached our team with the details from this page."
      ),
      t(
        "يراجعه مهندس تبريد ويجهّز العرض المناسب لحالتك.",
        "A refrigeration engineer reviews it and prepares a quote for your case."
      ),
      t(
        "نتواصل معك خلال " + hours + " ساعة عمل — وغالباً خلال " + minutes + " دقيقة.",
        "We contact you within " +
          hours +
          " working hours — usually within " +
          minutes +
          " minutes."
      ),
    ].forEach(function (s) {
      steps.appendChild(el("li", { text: s }));
    });
    box.appendChild(steps);

    box.appendChild(
      el("p", {
        class: "efi-next__urgent",
        text: t("أمرك عاجل؟ تحدّث مع مهندس الآن:", "Urgent? Talk to an engineer now:"),
      })
    );

    box.appendChild(
      el("div", { class: "efi-next__actions" }, [
        el(
          "a",
          {
            class: "wa",
            href: waLink(cfg.contact.phoneWhatsapp.e164, contextMessage()),
            target: "_blank",
            rel: "noopener",
            "data-efi-contact": "whatsapp",
            "data-efi-location": "post-submit",
          },
          [icon(WA_PATH), el("span", { text: t("واتساب الآن", "WhatsApp now") })]
        ),
        el(
          "a",
          {
            class: "tel",
            href: "tel:" + cfg.contact.phonePrimary.e164,
            "data-efi-contact": "phone",
            "data-efi-location": "post-submit",
          },
          [icon(TEL_PATH), el("span", { text: t("اتصال مباشر", "Call directly") })]
        ),
      ])
    );

    return box;
  }

  /* ─────────────────────────── bootstrap ─────────────────────────── */

  function start(cfg) {
    if (!cfg || !cfg.contact || !cfg.contact.phonePrimary) return;
    enhanceSiteWhatsApp();
    buildCallFab(cfg);
    buildHeaderPhone(cfg);
    buildLegalBar(cfg);
    buildContactPanel(cfg);
    buildCapture(cfg);
    watchCalculator(cfg);
    watchSuccess(cfg);
    guardTurnstile();

    // site-shell.js renders the header, footer and WhatsApp widget
    // asynchronously; retry until all exist, then stop. Bounded so a page
    // without a shell never spins.
    var tries = 0;
    var timer = setInterval(function () {
      enhanceSiteWhatsApp();
      buildCallFab(cfg);
      buildHeaderPhone(cfg);
      buildLegalBar(cfg);
      var done =
        document.querySelector(".efi-hdr-tel") &&
        document.querySelector(".efi-legal") &&
        document.querySelector(".efi-call-fab") &&
        document.querySelector("a.wa-fab[data-efi-contact]");
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

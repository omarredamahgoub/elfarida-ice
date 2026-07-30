/**
 * js/ads-conversion-bridge.js
 * ------------------------------------------------------------------
 * Bridges the site's existing GA4-shaped "generate_lead" dataLayer event
 * (pushed by js/lead-tracking-lib.js via SiteShell.postLead(), see
 * js/site-shell.js) into a real Google Ads conversion event.
 *
 * This file — not js/lead-tracking-lib.js — is deliberately the only
 * place in the codebase that knows about the Google Ads conversion ID
 * and label, so that lead-tracking-lib.js keeps its stated design of
 * having no dependency on `window.gtag` (see its own header comment).
 *
 * Must load before any form on the page can be submitted, i.e. as early
 * as possible in <head>. Only included on pages whose forms call
 * `SiteShell.postLead()` (index.html, index-en.html, contact.html,
 * contact-en.html) — those are the only pages that ever push a
 * "generate_lead" event to dataLayer.
 */
(function () {
  "use strict";

  var ADS_CONVERSION_ID = "AW-18308312937";
  var ADS_CONVERSION_LABEL = "jUnDCKr-k84cEOneippE";
  var LEAD_EVENT_NAME = "generate_lead";

  window.dataLayer = window.dataLayer || [];

  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = window.gtag || gtag;

  gtag("js", new Date());
  gtag("config", ADS_CONVERSION_ID);

  // Load the base Google tag library asynchronously (standard gtag.js
  // bootstrap — see https://support.google.com/tagmanager/answer/12326985).
  var tagScript = document.createElement("script");
  tagScript.async = true;
  tagScript.src = "https://www.googletagmanager.com/gtag/js?id=" + ADS_CONVERSION_ID;
  document.head.appendChild(tagScript);

  // Intercept every dataLayer push; whenever the existing lead-tracking
  // infrastructure reports a successful "generate_lead" event, fire the
  // matching Google Ads conversion. Works regardless of push timing
  // relative to gtag.js finishing its own async load, because gtag()
  // itself is nothing more than a dataLayer.push wrapper.
  var originalPush = window.dataLayer.push.bind(window.dataLayer);
  window.dataLayer.push = function () {
    for (var i = 0; i < arguments.length; i++) {
      var item = arguments[i];
      if (item && typeof item === "object" && item.event === LEAD_EVENT_NAME) {
        gtag("event", "conversion", {
          send_to: ADS_CONVERSION_ID + "/" + ADS_CONVERSION_LABEL,
          currency: "SAR",
          value: 1.0,
        });
      }
    }
    return originalPush.apply(window.dataLayer, arguments);
  };
})();

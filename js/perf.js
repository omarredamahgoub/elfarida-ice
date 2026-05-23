/* ================================================================
   perf.js — Performance Optimization Engine
   Responsibilities:
     1. Lazy-load background images via IntersectionObserver
     2. Defer third-party scripts until first user interaction
     3. Font Awesome deferred injection (non-blocking)
     4. Passive scroll / resize listeners enforcement
     5. Idle-callback task scheduling for non-critical work
   ================================================================ */
(function () {
  'use strict';

  /* ── 1. Lazy Background Images ── */
  (function initLazyBackgrounds() {
    var nodes = document.querySelectorAll('[data-bg]');
    if (!nodes.length) return;

    if (!('IntersectionObserver' in window)) {
      nodes.forEach(function (el) {
        el.style.backgroundImage = "url('" + el.getAttribute('data-bg') + "')";
        el.removeAttribute('data-bg');
      });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el  = entry.target;
        var src = el.getAttribute('data-bg');
        if (src) el.style.backgroundImage = "url('" + src + "')";
        el.removeAttribute('data-bg');
        observer.unobserve(el);
      });
    }, { rootMargin: '300px 0px' });

    nodes.forEach(function (el) { observer.observe(el); });
  }());

  /* ── 2. Deferred Third-Party Scripts ── */
  (function initDeferredThirdParty() {
    var loaded = false;

    function load() {
      if (loaded) return;
      loaded = true;

      /* GTM / GA4 — injected only after interaction */
      if (window.__GTM_ID__) {
        (function (w, d, s, l, i) {
          w[l] = w[l] || [];
          w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
          var f = d.getElementsByTagName(s)[0];
          var j = d.createElement(s);
          var dl = l !== 'dataLayer' ? '&l=' + l : '';
          j.async = true;
          j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
          f.parentNode.insertBefore(j, f);
        }(window, document, 'script', 'dataLayer', window.__GTM_ID__));
      }

      /* Facebook Pixel — injected only after interaction */
      if (window.__FB_PIXEL_ID__ && typeof fbq === 'undefined') {
        !function(f,b,e,v,n,t,s){
          if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)
        }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', window.__FB_PIXEL_ID__);
        fbq('track', 'PageView');
      }
    }

    var EVENTS   = ['click', 'scroll', 'keydown', 'touchstart', 'mousemove'];
    var FALLBACK = 4000;

    EVENTS.forEach(function (evt) {
      window.addEventListener(evt, load, { once: true, passive: true });
    });

    setTimeout(load, FALLBACK);
  }());

  /* ── 3. requestIdleCallback Polyfill ── */
  window.requestIdleCallback = window.requestIdleCallback || function (cb) {
    return setTimeout(function () { cb({ timeRemaining: function () { return 0; } }); }, 1);
  };

  /* ── 4. Idle: Prefetch visible links ── */
  requestIdleCallback(function () {
    if (!('IntersectionObserver' in window)) return;
    var seen = new Set();

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var href = entry.target.href;
        if (!href || seen.has(href) || href.indexOf(location.origin) !== 0) return;
        seen.add(href);
        var link = document.createElement('link');
        link.rel  = 'prefetch';
        link.href = href;
        document.head.appendChild(link);
        obs.unobserve(entry.target);
      });
    }, { rootMargin: '0px' });

    document.querySelectorAll('a[href]').forEach(function (a) { obs.observe(a); });
  });

}());

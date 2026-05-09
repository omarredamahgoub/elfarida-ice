/* ================================================================
   company-profile.js — Page-exclusive logic for company-profile.html
   Depends on: shared.js (AOS, WhatsApp, Newsletter, MobileMenu)
   This file handles only page-specific behaviour.
   ================================================================ */

(function () {
  'use strict';

  /* ── PDF download tracking ── */
  function initPdfTracking() {
    var links = document.querySelectorAll('a[download]');
    links.forEach(function (link) {
      link.addEventListener('click', function () {
        if (typeof gtag !== 'undefined') {
          gtag('event', 'file_download', {
            event_category: 'engagement',
            event_label: 'company-profile-pdf',
            file_name: 'AL-FARIDA-ICE-Profile-2026.pdf'
          });
        }
        if (typeof fbq !== 'undefined') {
          fbq('track', 'Lead', { content_name: 'company-profile-pdf' });
        }
      });
    });
  }

  /* ── CTA phone tracking ── */
  function initPhoneTracking() {
    var phoneLinks = document.querySelectorAll('a[href^="tel:"]');
    phoneLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        if (typeof gtag !== 'undefined') {
          gtag('event', 'phone_click', {
            event_category: 'engagement',
            event_label: window.location.pathname
          });
        }
      });
    });
  }

  function init() {
    initPdfTracking();
    initPhoneTracking();
  }

  if (window.SiteShell && typeof window.SiteShell.ready === 'function') {
    window.SiteShell.ready(init);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); }, { once: true });
  } else {
    setTimeout(init, 0);
  }

}());

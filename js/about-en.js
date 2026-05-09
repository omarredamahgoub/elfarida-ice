/* ================================================================
   about-en.js — JavaScript specific to about-en page (English)
   All shared logic resides in js/shared.js
   ================================================================ */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof AOS !== 'undefined') {
      AOS.init({ duration: 1000, once: true });
    }
  });
}());

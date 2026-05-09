/* ================================================================
   projects-en.js — JavaScript specific to projects-en page (English)
   All shared logic resides in js/shared.js
   ================================================================ */

(function () {
  'use strict';

  /**
   * Filter project cards by category and update active state on filter buttons.
   *
   * @param {string} category - Category identifier ('all' | 'mech' | 'insul' | 'units')
   */
  function filterProjects(category) {
    var cards   = document.querySelectorAll('.project-card');
    var buttons = document.querySelectorAll('.filter-btn');

    buttons.forEach(function (btn) {
      btn.classList.remove('active', 'bg-blue-600', 'text-white');
      btn.classList.add('bg-white', 'text-slate-600');
    });

    var activeBtn = document.querySelector('.filter-btn[onclick*="' + category + '"]');
    if (activeBtn) {
      activeBtn.classList.add('active', 'bg-blue-600', 'text-white');
      activeBtn.classList.remove('bg-white', 'text-slate-600');
    }

    cards.forEach(function (card) {
      var match = category === 'all' || card.getAttribute('data-category') === category;
      card.style.display = match ? 'block' : 'none';
    });
  }

  /* Export to global scope for inline onclick handlers */
  window.filterProjects = filterProjects;

  /* Initialise AOS after DOM is ready */
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof AOS !== 'undefined') {
      AOS.init({ duration: 800, once: true });
    }
  });
}());

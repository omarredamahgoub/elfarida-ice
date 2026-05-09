/* ================================================================
   projects.js — JavaScript خاص بصفحة projects (عربي)
   جميع المنطق المشترك منقول إلى js/shared.js
   ================================================================ */

(function () {
  'use strict';

  /**
   * فلترة بطاقات المشاريع حسب الفئة وتحديث الحالة النشطة على أزرار الفلتر.
   *
   * @param {string} category - معرّف الفئة ('all' | 'mech' | 'insul' | 'units')
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

  /* تصدير الدالة إلى النطاق العالمي لضمان استدعائها من onclick */
  window.filterProjects = filterProjects;

  /* تهيئة AOS بعد اكتمال تحميل DOM */
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof AOS !== 'undefined') {
      AOS.init({ duration: 800, once: true });
    }
  });
}());

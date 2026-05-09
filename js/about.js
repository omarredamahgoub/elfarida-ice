/* ================================================================
   about.js — JavaScript خاص بصفحة about
   جميع المنطق المشترك منقول إلى js/shared.js
   ================================================================ */

/* ── IntersectionObserver — بديل AOS خفيف ── */
(function () {
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var delay = parseInt(entry.target.getAttribute('data-aos-delay') || '0', 10);
        setTimeout(function () {
          entry.target.classList.add('aos-animate');
        }, delay);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('[data-aos]').forEach(function (el) {
    observer.observe(el);
  });
})();

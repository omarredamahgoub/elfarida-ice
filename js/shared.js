/* ================================================================
   shared.js — دوال JavaScript المشتركة بين جميع صفحات الموقع
   ════════════════════════════════════════════════════════════════
   مصدر الحقيقة الوحيد (Single Source of Truth) لـ:
     1. قائمة الجوال   — يدعم style API و Tailwind classes
     2. النشرة البريدية
     3. واتساب (بالون + تتبع)
     4. AOS (IntersectionObserver محلي)

   ملاحظة معمارية حرجة:
     site-shell.js يُحمَّل بـ defer ويُنشئ DOM الفوتر ديناميكياً.
     لذلك يجب أن يعمل shared.js بعد اكتمال defer scripts — عبر
     تسجيل نفسه في SiteShell.ready() إن وُجد، أو عبر الانتظار
     حتى DOMContentLoaded ثم تأجيل التهيئة بـ setTimeout(0).
   ================================================================ */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     الدالة المركزية — تُشغَّل بعد اكتمال site-shell.js
     ══════════════════════════════════════════════════════════════ */
  function initAll() {
    initMobileMenu();
    initNewsletter();
    initWhatsApp();
    initAOS();
  }

  /* ──────────────────────────────────────────────────────────────
     نقطة الإطلاق: إذا SiteShell موجود فاستخدم ready()،
     وإلا انتظر DOMContentLoaded ثم أجِّل بـ setTimeout(0)
     لضمان تنفيذ جميع defer scripts أولاً.
     ────────────────────────────────────────────────────────────── */
  function bootstrap() {
    if (window.SiteShell && typeof window.SiteShell.ready === 'function') {
      window.SiteShell.ready(initAll);
    } else {
      /* SiteShell لم يُعرَّف بعد — انتظر defer scripts */
      setTimeout(initAll, 0);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }

  /* ══════════════════════════════════════════════════════════════
     1. قائمة الجوال
     يدعم نمطين:
       أ) Tailwind classes  (max-h-0 / opacity-0)
       ب) data-open attribute  (site-shell.js pattern)
     ══════════════════════════════════════════════════════════════ */
  function initMobileMenu() {
    var btn  = document.getElementById('site-mobile-menu-btn');
    var menu = document.getElementById('site-mobile-menu');
    if (!btn || !menu) return;

    /* تجنب التسجيل المزدوج إذا site-shell.js سبق وسجّل المستمعين */
    if (btn.dataset.sharedBound) return;
    btn.dataset.sharedBound = '1';

    var isTailwindMenu = menu.classList.contains('max-h-0') ||
                         menu.classList.contains('opacity-0');
    var isDataOpenMenu = menu.hasAttribute('data-open');

    /* إذا كان site-shell.js يُدير القائمة عبر data-open فلا نتدخل */
    if (isDataOpenMenu) return;

    function openMenu() {
      if (isTailwindMenu) {
        menu.classList.remove('max-h-0', 'opacity-0', 'pointer-events-none');
        menu.classList.add('opacity-100');
        menu.style.maxHeight     = '640px';
        menu.style.opacity       = '1';
        menu.style.pointerEvents = 'auto';
      } else {
        menu.style.maxHeight     = menu.scrollHeight + 'px';
        menu.style.opacity       = '1';
        menu.style.pointerEvents = 'auto';
      }
      btn.setAttribute('aria-expanded', 'true');
      var icon = btn.querySelector('i');
      if (icon) { icon.classList.remove('fa-bars'); icon.classList.add('fa-times'); }
    }

    function closeMenu() {
      if (isTailwindMenu) {
        menu.classList.remove('opacity-100');
        menu.style.maxHeight     = '0px';
        menu.style.opacity       = '0';
        menu.style.pointerEvents = 'none';
        var onEnd = function () {
          menu.classList.add('max-h-0', 'opacity-0', 'pointer-events-none');
          menu.style.maxHeight = menu.style.opacity = menu.style.pointerEvents = '';
          menu.removeEventListener('transitionend', onEnd);
        };
        menu.addEventListener('transitionend', onEnd);
      } else {
        menu.style.maxHeight     = '0px';
        menu.style.opacity       = '0';
        menu.style.pointerEvents = 'none';
      }
      btn.setAttribute('aria-expanded', 'false');
      var icon = btn.querySelector('i');
      if (icon) { icon.classList.remove('fa-times'); icon.classList.add('fa-bars'); }
    }

    btn.addEventListener('click', function () {
      btn.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu();
    });

    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMenu();
    });
  }

  /* ══════════════════════════════════════════════════════════════
     2. النشرة البريدية — Footer
     يدعم كلا النمطين:
       أ) hidden boolean attribute  (site-shell.js)
       ب) Tailwind hidden class     (article-shell.js / partials)
     ══════════════════════════════════════════════════════════════ */
  function initNewsletter() {
    var form      = document.getElementById('footer-newsletter-form');
    var input     = document.getElementById('footer-email-input');
    var btn       = document.getElementById('footer-newsletter-btn');
    var errInline = document.getElementById('footer-email-error');
    var successEl = document.getElementById('footer-success');
    var errorEl   = document.getElementById('footer-error');

    if (!form || !input || !btn) return;

    /* تجنب التسجيل المزدوج (site-shell.js يُسجّل مستمعاً مستقلاً) */
    if (form.dataset.sharedBound) return;
    form.dataset.sharedBound = '1';

    var isAr         = document.documentElement.lang !== 'en';
    var labelSubmit  = isAr ? 'اشترك الآن'      : 'Subscribe now';
    var labelLoading = isAr ? 'جاري الإرسال...' : 'Sending...';
    var EMAIL_RE     = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

    /* ── helpers مُوحَّدة للإخفاء / الإظهار تعمل مع كلا النمطين ── */
    function hide(el) {
      if (!el) return;
      if ('hidden' in el) { el.hidden = true; }
      el.classList.add('hidden');
    }
    function show(el) {
      if (!el) return;
      if ('hidden' in el) { el.hidden = false; }
      el.classList.remove('hidden');
    }
    function isHidden(el) {
      if (!el) return true;
      return el.hidden || el.classList.contains('hidden');
    }

    input.addEventListener('input', function () {
      this.value = this.value.replace(/[^\x00-\x7F]/g, '');
    });

    input.addEventListener('blur', function () {
      var v = this.value.trim();
      if (v && !EMAIL_RE.test(v)) { show(errInline); }
      else { hide(errInline); }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!EMAIL_RE.test(v)) { show(errInline); input.focus(); return; }
      hide(errInline);
      hide(successEl);
      hide(errorEl);

      btn.disabled    = true;
      btn.textContent = labelLoading;

      var obj = {};
      new FormData(form).forEach(function (val, key) { obj[key] = val; });

      fetch('https://api.web3forms.com/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify(obj)
      })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r && r.success) { show(successEl); form.reset(); input.value = ''; }
          else { show(errorEl); }
        })
        .catch(function () { show(errorEl); })
        .finally(function () { btn.disabled = false; btn.textContent = labelSubmit; });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     3. واتساب — بالون وتتبع
     ══════════════════════════════════════════════════════════════ */
  function initWhatsApp() {
    var balloon = document.getElementById('wa-balloon');
    var widget  = document.getElementById('wa-widget');
    if (!balloon) return;

    /* إذا كان site-shell.js أنشأ الويدجت وربطه، لا نتدخل */
    if (balloon.dataset.sharedBound) return;
    balloon.dataset.sharedBound = '1';

    var dismissed    = false;
    var balloonShown = false;

    function showBalloon() {
      if (dismissed) return;
      balloon.style.opacity       = '1';
      balloon.style.transform     = 'translateX(0) scale(1)';
      balloon.style.pointerEvents = 'auto';
    }

    window.dismissBalloon = function () {
      dismissed = true;
      balloon.style.opacity       = '0';
      balloon.style.transform     = 'translateX(16px) scale(0.95)';
      balloon.style.pointerEvents = 'none';
      setTimeout(function () { balloon.style.display = 'none'; }, 350);
    };

    window.trackWA = function () {
      dismissed = true;
      if (typeof gtag !== 'undefined') {
        gtag('event', 'whatsapp_click', {
          event_category: 'engagement',
          event_label: window.location.pathname
        });
      }
      if (typeof fbq !== 'undefined') {
        fbq('track', 'Contact', { method: 'WhatsApp' });
      }
    };

    setTimeout(function () { if (!dismissed) showBalloon(); }, 8000);

    function onScrollCheck() {
      if (dismissed || balloonShown) return;
      var scrollTop  = window.scrollY || document.documentElement.scrollTop || 0;
      var scrollable = document.documentElement.scrollHeight -
                       (window.innerHeight || document.documentElement.clientHeight);
      if (scrollable <= 0) return;
      if ((scrollTop / scrollable) * 100 > 60) {
        balloonShown = true;
        showBalloon();
      }
    }

    window.addEventListener('scroll', onScrollCheck, { passive: true });

    if (widget) {
      widget.addEventListener('mouseleave', function () {
        if (!dismissed) {
          setTimeout(function () { if (!dismissed) window.dismissBalloon(); }, 4000);
        }
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════
     4. AOS — Animate On Scroll (بديل محلي)
     ══════════════════════════════════════════════════════════════ */
  function initAOS() {
    /* إذا site-shell.js سبق وهيّأ AOS، لا نُعيد التسجيل */
    if (window.AOS && window.AOS._sharedInit) return;

    window.AOS = { init: function () {}, _sharedInit: true };

    var nodes = document.querySelectorAll('[data-aos]');
    if (!nodes.length) return;

    if (!('IntersectionObserver' in window)) {
      nodes.forEach(function (el) { el.classList.add('aos-animate'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el    = entry.target;
        var delay = parseInt(el.getAttribute('data-aos-delay') || '0', 10);
        setTimeout(function () { el.classList.add('aos-animate'); }, delay);
        observer.unobserve(el);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    nodes.forEach(function (el) { observer.observe(el); });
  }

}());

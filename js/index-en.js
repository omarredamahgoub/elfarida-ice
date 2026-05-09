/* ================================================================
   index-en.js — scripts for index-en page
   All shared logic (mobile menu, newsletter, WhatsApp, AOS)
   resides in js/shared.js — single source of truth
   ================================================================ */

(function () {
  'use strict';

  /* ── 1. Logo carousel ── */
  function initLogoCarousel(config) {
    var track         = document.getElementById(config.trackId);
    var prevBtn       = document.getElementById(config.prevBtnId);
    var nextBtn       = document.getElementById(config.nextBtnId);
    var dotsContainer = document.getElementById(config.dotsId);
    if (!track || !prevBtn || !nextBtn || !dotsContainer || !track.children.length) return;

    var GAP_PX        = 30;
    var AUTO_MS       = 1200;
    var TRANS_MS      = 900;
    var SWIPE_PX      = 56;

    var slides = Array.from(track.children);
    var total  = slides.length;

    slides.forEach(function (s) { track.appendChild(s.cloneNode(true)); });
    slides = Array.from(track.children);

    var idx = 0, timer, touchX = 0, touchDX = 0;

    function stepW() { return slides[0].getBoundingClientRect().width + GAP_PX; }

    function renderDots() {
      dotsContainer.innerHTML = '';
      for (var i = 0; i < total; i++) {
        (function (i) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'carousel-dot';
          dot.setAttribute('aria-label', 'Slide ' + (i + 1));
          if (i === idx % total) dot.classList.add('active');
          dot.addEventListener('click', function () { idx = i; render(); resetAuto(); });
          dotsContainer.appendChild(dot);
        })(i);
      }
    }

    function render(anim) {
      if (anim === undefined) anim = true;
      track.style.transition = anim ? 'transform ' + TRANS_MS + 'ms linear' : 'none';
      track.style.transform  = 'translateX(-' + (idx * stepW()) + 'px)';
      dotsContainer.querySelectorAll('.carousel-dot').forEach(function (d, i) {
        d.classList.toggle('active', i === idx % total);
      });
    }

    function prev() { idx = idx <= 0 ? total - 1 : idx - 1; render(); }
    function next() {
      idx++;
      render();
      if (idx >= total) setTimeout(function () { idx = 0; render(false); }, TRANS_MS);
    }
    function resetAuto() { clearInterval(timer); timer = setInterval(next, AUTO_MS); }

    prevBtn.addEventListener('click', function () { prev(); resetAuto(); });
    nextBtn.addEventListener('click', function () { next(); resetAuto(); });

    var host = track.parentElement;
    host.addEventListener('mouseenter', function () { clearInterval(timer); });
    host.addEventListener('mouseleave', resetAuto);

    track.addEventListener('touchstart', function (e) {
      touchX = e.touches[0].clientX; touchDX = 0; track.style.transition = 'none';
    }, { passive: true });
    track.addEventListener('touchmove', function (e) {
      touchDX = e.touches[0].clientX - touchX;
      track.style.transform = 'translateX(-' + (idx * stepW() - touchDX) + 'px)';
    }, { passive: true });
    track.addEventListener('touchend', function () {
      if      (touchDX >  SWIPE_PX) prev();
      else if (touchDX < -SWIPE_PX) next();
      else                          render();
      resetAuto();
    });

    window.addEventListener('resize', function () {
      slides = Array.from(track.children);
      renderDots();
      render(false);
    });

    renderDots();
    render(false);
    resetAuto();
  }

  initLogoCarousel({ trackId: 'partnersTrack', prevBtnId: 'partnersPrevBtn', nextBtnId: 'partnersNextBtn', dotsId: 'partnersDots' });
  initLogoCarousel({ trackId: 'clientsTrack',  prevBtnId: 'clientsPrevBtn',  nextBtnId: 'clientsNextBtn',  dotsId: 'clientsDots'  });

  /* ── 2. Service dropdown ── */
  (function () {
    var dropdown   = document.getElementById('svc-dropdown');
    var trigger    = document.getElementById('svc-trigger');
    var label      = document.getElementById('svc-label');
    var serviceVal = document.getElementById('hero-service-val');
    if (!dropdown || !trigger) return;

    function openDropdown()  { dropdown.classList.add('open');    trigger.setAttribute('aria-expanded', 'true');  }
    function closeDropdown() { dropdown.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.contains('open') ? closeDropdown() : openDropdown();
    });

    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target)) closeDropdown();
    });

    document.querySelectorAll('.svc-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        var value = this.dataset.value;
        if (serviceVal) serviceVal.value = value;
        if (label) { label.textContent = this.textContent; label.style.color = '#ffffff'; }
        document.querySelectorAll('.svc-option').forEach(function (o) { o.classList.remove('selected'); });
        this.classList.add('selected');
        closeDropdown();
        var errEl = document.getElementById('err-service');
        if (errEl) errEl.classList.add('hidden');
      });
    });
  })();

  /* ── 3. Hero quick-form ── */
  (function () {
    var form       = document.getElementById('hero-quick-form');
    var btnSubmit  = document.getElementById('hero-submit-btn');
    var nameInput  = document.getElementById('hero-name');
    var phoneInput = document.getElementById('hero-phone');
    var serviceVal = document.getElementById('hero-service-val');
    var successMsg = document.getElementById('hero-success');
    var errorMsg   = document.getElementById('hero-error');
    if (!form || !btnSubmit || !nameInput || !phoneInput) return;

    var nameRegex  = /^[\u0600-\u06FFa-zA-Z\s]{3,60}$/;
    var phoneRegex = /^(\+966|00966|0)5[0-9]{8}$/;

    function showErr(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
    function hideErr(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }

    nameInput.addEventListener('input', function () {
      this.value = this.value.replace(/[0-9\u0660-\u0669!@#$%^&*()\-_+=\[\]{};':"\\|,.<>/?]/g, '');
      var v = this.value.trim();
      if (v.length === 0)          hideErr('err-name');
      else if (nameRegex.test(v))  hideErr('err-name');
      else                         showErr('err-name');
    });

    phoneInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^\d+]/g, '');
      var v = this.value.trim();
      if (v.length === 0)           hideErr('err-phone');
      else if (phoneRegex.test(v))  hideErr('err-phone');
      else if (v.length > 3)        showErr('err-phone');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nameVal = nameInput.value.trim();
      var phoneVal = phoneInput.value.trim();
      var svc     = serviceVal ? serviceVal.value : '';
      var valid   = true;

      if (!nameRegex.test(nameVal))   { showErr('err-name');    valid = false; } else hideErr('err-name');
      if (!phoneRegex.test(phoneVal)) { showErr('err-phone');   valid = false; } else hideErr('err-phone');
      if (!svc)                       { showErr('err-service'); valid = false; } else hideErr('err-service');
      if (!valid) return;

      successMsg.classList.add('hidden');
      errorMsg.classList.add('hidden');
      btnSubmit.disabled    = true;
      btnSubmit.textContent = 'Sending\u2026';

      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });

      fetch('https://api.web3forms.com/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify(data)
      })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (r.success) { successMsg.classList.remove('hidden'); form.reset(); }
        else           { errorMsg.classList.remove('hidden'); }
      })
      .catch(function () { errorMsg.classList.remove('hidden'); })
      .finally(function () { btnSubmit.disabled = false; btnSubmit.textContent = 'Send request'; });
    });
  })();

})();

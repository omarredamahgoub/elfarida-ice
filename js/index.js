/* ================================================================
   index.js — JavaScript خاص بصفحة index
   جميع المنطق المشترك (قائمة الجوال، النشرة، واتساب، AOS)
   موجود في js/shared.js — مصدر الحقيقة الوحيد
   ================================================================ */

(function () {
  'use strict';

  /* ── 1. الكاروسيل العام (مُصحَّح أكاديمياً) ── */
  function initLogoCarousel(config) {
    var track         = document.getElementById(config.trackId);
    var prevBtn       = document.getElementById(config.prevBtnId);
    var nextBtn       = document.getElementById(config.nextBtnId);
    var dotsContainer = document.getElementById(config.dotsId);

    if (!track || !prevBtn || !nextBtn || !dotsContainer || !track.children.length) return;

    var GAP_PX          = 30;
    var AUTO_PLAY_MS    = 3500;
    var TRANSITION_MS   = 600;
    var SWIPE_THRESHOLD = 56;

    var originalSlides = Array.from(track.children);
    var originalCount  = originalSlides.length;
    originalSlides.forEach(function (slide) {
      track.appendChild(slide.cloneNode(true));
    });

    var currentIndex    = 0;
    var autoPlayTimer   = null;
    var touchStartX     = 0;
    var touchDeltaX     = 0;
    var isTransitioning = false;

    function getSlideStepWidth() {
      var firstSlide = track.children[0];
      if (!firstSlide) return 0;
      return firstSlide.getBoundingClientRect().width + GAP_PX;
    }

    function applyTransform(withTransition) {
      var offset = currentIndex * getSlideStepWidth();
      track.style.transition = withTransition
        ? 'transform ' + TRANSITION_MS + 'ms cubic-bezier(0.25, 0.8, 0.25, 1)'
        : 'none';
      track.style.transform = 'translateX(-' + offset + 'px)';
    }

    function updateDots() {
      var activeDot = currentIndex % originalCount;
      dotsContainer.querySelectorAll('.carousel-dot').forEach(function (dot, idx) {
        dot.classList.toggle('active', idx === activeDot);
      });
    }

    function renderDots() {
      dotsContainer.innerHTML = '';
      for (var i = 0; i < originalCount; i++) {
        (function (i) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'carousel-dot';
          dot.setAttribute('aria-label', 'الشريحة ' + (i + 1));
          if (i === 0) dot.classList.add('active');
          dot.addEventListener('click', function () {
            if (isTransitioning) return;
            currentIndex = i;
            applyTransform(true);
            updateDots();
            resetAutoPlay();
          });
          dotsContainer.appendChild(dot);
        })(i);
      }
    }

    function nextSlide() {
      if (isTransitioning) return;
      isTransitioning = true;
      currentIndex++;
      applyTransform(true);
      updateDots();
      setTimeout(function () {
        if (currentIndex >= originalCount) {
          currentIndex = 0;
          applyTransform(false);
          updateDots();
        }
        isTransitioning = false;
      }, TRANSITION_MS);
    }

    function prevSlide() {
      if (isTransitioning) return;
      isTransitioning = true;
      if (currentIndex <= 0) {
        currentIndex = originalCount;
        applyTransform(false);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            currentIndex--;
            applyTransform(true);
            updateDots();
            setTimeout(function () { isTransitioning = false; }, TRANSITION_MS);
          });
        });
      } else {
        currentIndex--;
        applyTransform(true);
        updateDots();
        setTimeout(function () { isTransitioning = false; }, TRANSITION_MS);
      }
    }

    function resetAutoPlay() {
      clearInterval(autoPlayTimer);
      autoPlayTimer = setInterval(nextSlide, AUTO_PLAY_MS);
    }

    prevBtn.addEventListener('click', function () { prevSlide(); resetAutoPlay(); });
    nextBtn.addEventListener('click', function () { nextSlide(); resetAutoPlay(); });

    prevBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); prevSlide(); resetAutoPlay(); }
    });
    nextBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextSlide(); resetAutoPlay(); }
    });

    var wrapper = track.parentElement;
    wrapper.addEventListener('mouseenter', function () { clearInterval(autoPlayTimer); });
    wrapper.addEventListener('mouseleave', function () { resetAutoPlay(); });

    track.addEventListener('touchstart', function (e) {
      touchStartX = e.touches[0].clientX;
      touchDeltaX = 0;
      track.style.transition = 'none';
    }, { passive: true });

    track.addEventListener('touchmove', function (e) {
      touchDeltaX = e.touches[0].clientX - touchStartX;
      var baseOffset = currentIndex * getSlideStepWidth();
      track.style.transform = 'translateX(-' + (baseOffset - touchDeltaX) + 'px)';
    }, { passive: true });

    track.addEventListener('touchend', function () {
      if      (touchDeltaX >  SWIPE_THRESHOLD) prevSlide();
      else if (touchDeltaX < -SWIPE_THRESHOLD) nextSlide();
      else                                     applyTransform(true);
      resetAutoPlay();
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { applyTransform(false); }, 120);
    });

    renderDots();
    applyTransform(false);
    resetAutoPlay();
  }

  initLogoCarousel({
    trackId:   'partnersTrack',
    prevBtnId: 'partnersPrevBtn',
    nextBtnId: 'partnersNextBtn',
    dotsId:    'partnersDots',
  });

  initLogoCarousel({
    trackId:   'clientsTrack',
    prevBtnId: 'clientsPrevBtn',
    nextBtnId: 'clientsNextBtn',
    dotsId:    'clientsDots',
  });

  /* ── 2. نموذج الهيرو السريع ── */
  (function () {
    var form       = document.getElementById('hero-quick-form');
    var btnSubmit  = document.getElementById('hero-submit-btn');
    var nameInput  = document.getElementById('hero-name');
    var phoneInput = document.getElementById('hero-phone');
    var serviceEl  = document.getElementById('hero-service-val');
    var successMsg = document.getElementById('hero-success');
    var errorMsg   = document.getElementById('hero-error');
    if (!form || !btnSubmit) return;

    var nameRe  = /^[\u0600-\u06FFa-zA-Z\s]{3,60}$/;
    var phoneRe = /^(\+966|00966|0)5[0-9]{8}$/;

    function showErr(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
    function hideErr(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }

    nameInput.addEventListener('input', function () {
      this.value = this.value.replace(/[0-9\u0660-\u0669!@#$%^&*()\-_+=\[\]{};':"\\|,.<>\/?]/g, '');
      var v = this.value.trim();
      if (v.length === 0)      hideErr('err-name');
      else if (nameRe.test(v)) hideErr('err-name');
      else                     showErr('err-name');
    });

    phoneInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^\d+]/g, '');
      var v = this.value.trim();
      if (v.length === 0)       hideErr('err-phone');
      else if (phoneRe.test(v)) hideErr('err-phone');
      else if (v.length > 3)    showErr('err-phone');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nameVal    = nameInput.value.trim();
      var phoneVal   = phoneInput.value.trim();
      var serviceVal = serviceEl ? serviceEl.value : '';
      var valid      = true;

      if (!nameRe.test(nameVal))   { showErr('err-name');    valid = false; } else hideErr('err-name');
      if (!phoneRe.test(phoneVal)) { showErr('err-phone');   valid = false; } else hideErr('err-phone');
      if (!serviceVal)             { showErr('err-service'); valid = false; } else hideErr('err-service');
      if (!valid) return;

      successMsg.classList.add('hidden');
      errorMsg.classList.add('hidden');
      btnSubmit.disabled    = true;
      btnSubmit.textContent = 'جاري الإرسال...';

      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });

      fetch('https://api.web3forms.com/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(data),
      })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r.success) { successMsg.classList.remove('hidden'); form.reset(); }
          else           { errorMsg.classList.remove('hidden'); }
        })
        .catch(function () { errorMsg.classList.remove('hidden'); })
        .finally(function () {
          btnSubmit.disabled    = false;
          btnSubmit.textContent = 'أرسل الطلب';
        });
    });
  })();

  /* ── 3. قائمة الخدمات المنسدلة ── */
  (function () {
    var trigger  = document.getElementById('svc-trigger');
    var list     = document.getElementById('svc-list');
    var labelEl  = document.getElementById('svc-label');
    var hiddenEl = document.getElementById('hero-service-val');
    if (!trigger || !list) return;

    trigger.addEventListener('click', function () {
      var isOpen = list.classList.contains('open');
      list.classList.toggle('open', !isOpen);
      trigger.classList.toggle('open', !isOpen);
      trigger.setAttribute('aria-expanded', String(!isOpen));
    });

    list.querySelectorAll('.svc-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        var val = this.getAttribute('data-value');
        if (hiddenEl) hiddenEl.value = val;
        if (labelEl)  { labelEl.textContent = this.textContent.trim(); labelEl.style.color = 'white'; }
        list.querySelectorAll('.svc-option').forEach(function (o) { o.classList.remove('selected'); });
        this.classList.add('selected');
        list.classList.remove('open');
        trigger.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        var errEl = document.getElementById('err-service');
        if (errEl) errEl.classList.add('hidden');
      });
    });

    document.addEventListener('click', function (e) {
      var dd = document.getElementById('svc-dropdown');
      if (dd && !dd.contains(e.target)) {
        list.classList.remove('open');
        trigger.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  })();

})();

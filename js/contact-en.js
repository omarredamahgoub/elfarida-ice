/* ================================================================
   contact-en.js — JavaScript specific to contact-en page
   All shared logic (newsletter footer, WhatsApp balloon) resides in js/shared.js
   ================================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────────
   § 1  AOS initialisation
   ──────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  if (typeof AOS !== 'undefined') {
    AOS.init({ duration: 1000, once: true });
  }
});

/* ────────────────────────────────────────────────────────────────
   § 2  Project counter animation
   ──────────────────────────────────────────────────────────────── */
(function () {
  var BASE = 550;

  function animateValue(el, from, to, ms) {
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / ms, 1);
      el.textContent = Math.floor(p * (to - from) + from);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function handleProjectCounter(isNewOrder) {
    var el = document.getElementById('project-counter');
    if (!el) return;

    var prefersReduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) { el.textContent = String(BASE); return; }

    if (isNewOrder) {
      el.classList.add('animate__animated', 'animate__bounceIn');
      animateValue(el, BASE, BASE + 1, 500);
    } else {
      new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { animateValue(el, 0, BASE, 2000); obs.unobserve(el); }
        });
      }, { threshold: 0.5 }).observe(el);
    }
  }

  window._handleProjectCounter = handleProjectCounter;
  handleProjectCounter(false);
})();

/* ────────────────────────────────────────────────────────────────
   § 3  Cities dropdown
   ──────────────────────────────────────────────────────────────── */
(function () {
  var cities = {
    'Eastern Region':  ['Dammam','Khobar','Dhahran','Al Ahsa','Jubail','Qatif','Hafar Al-Batin','Khafji','Ras Tanura','Buqayq','Al Nuairiyah','Qaryat Al Ulya'],
    'Riyadh Region':   ['Riyadh','Al Kharj','Al Majmaah','Diriyah','Dawadmi','Al Zulfi','Shaqra','Wadi Ad-Dawasir','Al Quwayiyah','Al Aflaj','Afif','Al Ghat'],
    'Makkah Region':   ['Jeddah','Makkah','Taif','Rabigh','Al Lith','Al Qunfudhah','Khulays','Turbah','Khurma','Ranyah'],
    'Madinah Region':  ['Madinah','Yanbu','Al Ula','Badr','Al Mahd','Al Hanakiyah'],
    'Qassim Region':   ['Buraidah','Unaizah','Ar Rass','Al Mithnab','Al Bukayriyah','Al Badayea'],
    'Asir Region':     ['Abha','Khamis Mushait','Ahad Rafidah','Muhayil','Bisha','Al Namas'],
    'Other Regions':   ['Tabuk','Hail','Jazan','Najran','Sakaka','Arar','Al Bahah'],
    'International':   ['Outside Saudi Arabia']
  };

  var sel = document.getElementById('city-dropdown');
  if (!sel) return;

  Object.keys(cities).forEach(function (region) {
    var grp = document.createElement('optgroup');
    grp.label = region;
    cities[region].forEach(function (city) {
      var opt = document.createElement('option');
      opt.value = opt.textContent = city;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });
})();

/* ────────────────────────────────────────────────────────────────
   § 4  Input sanitisation + phone validation (10–16 digits)
   ──────────────────────────────────────────────────────────────── */
(function () {
  var emailInput = document.getElementById('email-input');
  if (emailInput) {
    emailInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^\x00-\x7F]/g, '');
    });
  }

  var tel = document.getElementById('tel-input');
  if (!tel) return;

  function validateTel() {
    var digits = tel.value.replace(/^\+/, '').replace(/\D/g, '');
    if (digits.length < 10)      tel.setCustomValidity('Phone number must be at least 10 digits');
    else if (digits.length > 16) tel.setCustomValidity('Phone number must not exceed 16 digits');
    else                         tel.setCustomValidity('');
  }

  tel.addEventListener('input', function () {
    this.value = this.value.replace(/(?!^\+)\D/g, '');
    validateTel();
  });
  tel.addEventListener('blur', validateTel);

  window._validateTel = function () { validateTel(); return tel.checkValidity(); };
})();

/* ────────────────────────────────────────────────────────────────
   § 5  Engineering calculator
   ──────────────────────────────────────────────────────────────── */
(function () {
  var quoteForm = document.getElementById('quote-form');
  if (!quoteForm) return;

  /* Enforce minimum 1 m on dimension fields */
  ['dim-l', 'dim-w', 'dim-h'].forEach(function (id) {
    var inp = document.getElementById(id);
    if (!inp) return;
    function enforceMin() {
      var v = parseFloat(inp.value);
      if (!isNaN(v) && v < 1) {
        inp.value = '1';
        inp.setCustomValidity('Minimum value is 1 metre');
        inp.reportValidity();
      } else {
        inp.setCustomValidity('');
      }
    }
    inp.addEventListener('change', enforceMin);
    inp.addEventListener('blur',   enforceMin);
  });

  function recalculate() {
    var l        = parseFloat(document.getElementById('dim-l').value) || 0;
    var w        = parseFloat(document.getElementById('dim-w').value) || 0;
    var h        = parseFloat(document.getElementById('dim-h').value) || 0;
    var hasFloor = document.getElementById('floor-toggle').value === 'yes';

    if (l < 1 || w < 1 || h < 1) return;

    var perimeter      = 2 * (l + w);
    var wallPanelCount = Math.ceil(perimeter);
    var larger         = Math.max(l, w);
    var smaller        = Math.min(l, w);
    var hzPanelCount   = Math.ceil(larger);
    var wallArea       = perimeter * h;
    var roofArea       = l * w;
    var totalArea      = wallArea + roofArea + (hasFloor ? roofArea : 0);
    var volume         = l * w * h;
    var normalAngles   = hasFloor ? perimeter : 0;
    var decorAngles    = perimeter + h * 4;

    var floorLine = hasFloor
      ? ' | Floor panels: ' + hzPanelCount + ' panel — length ' + smaller.toFixed(2) + ' m'
      : '';

    document.getElementById('calc-area').value   = totalArea.toFixed(2) + ' m²';
    document.getElementById('calc-volume').value = volume.toFixed(2)    + ' m³';
    document.getElementById('calc-details').value =
      'U-Channel: '        + perimeter.toFixed(2)    + ' m' +
      ' | Standard angles: ' + normalAngles.toFixed(2) + ' m' +
      ' | Deco angles: '     + decorAngles.toFixed(2)  + ' m' +
      ' | Floor: '           + (hasFloor ? 'Panel' : 'Concrete') +
      ' | Wall panels: '     + wallPanelCount + ' panel — length ' + h.toFixed(2)      + ' m' +
      ' | Roof panels: '     + hzPanelCount   + ' panel — length ' + smaller.toFixed(2) + ' m' +
      floorLine;
  }

  quoteForm.addEventListener('input', recalculate);

  /* ────────────────────────────────────────────────────────────────
     § 5b  Door size ± buttons (width: min 70 cm | height: min 170 cm)
     ──────────────────────────────────────────────────────────────── */
  (function () {
    var STEP     = 10;
    var doorW    = 70;
    var doorH    = 170;
    var wDisplay = document.getElementById('door-width-display');
    var hDisplay = document.getElementById('door-height-display');

    function render() {
      if (wDisplay) wDisplay.value = doorW + ' cm';
      if (hDisplay) hDisplay.value = doorH + ' cm';
      var decW = document.getElementById('door-w-dec');
      var decH = document.getElementById('door-h-dec');
      if (decW) decW.disabled = (doorW <= 70);
      if (decH) decH.disabled = (doorH <= 170);
    }

    var wInc = document.getElementById('door-w-inc');
    var wDec = document.getElementById('door-w-dec');
    var hInc = document.getElementById('door-h-inc');
    var hDec = document.getElementById('door-h-dec');

    if (wInc) wInc.addEventListener('click', function () { doorW += STEP; render(); });
    if (wDec) wDec.addEventListener('click', function () { if (doorW > 70)  { doorW -= STEP; render(); } });
    if (hInc) hInc.addEventListener('click', function () { doorH += STEP; render(); });
    if (hDec) hDec.addEventListener('click', function () { if (doorH > 170) { doorH -= STEP; render(); } });

    render();
  })();

  /* ────────────────────────────────────────────────────────────────
     § 5c  Quote form submission
     ──────────────────────────────────────────────────────────────── */
  quoteForm.addEventListener('submit', function (e) {
    e.preventDefault();

    if (window._validateTel && !window._validateTel()) {
      document.getElementById('tel-input').reportValidity();
      return;
    }

    recalculate();

    var orderID =
      'AF-' + new Date().getFullYear().toString().slice(-2) +
      Math.floor(1000 + Math.random() * 9000);

    var btn = quoteForm.querySelector('button[type="submit"]');
    btn.disabled  = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending your request\u2026';

    var obj = { 'Order_ID': orderID };
    new FormData(quoteForm).forEach(function (v, k) {
      if (k === 'email' && String(v).trim() === '') return;
      obj[k] = v;
    });

    fetch('https://api.web3forms.com/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify(obj)
    })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.success) throw new Error(res.message || 'Submission failed');

      if (window._handleProjectCounter) window._handleProjectCounter(true);
      window.scrollTo({ top: quoteForm.offsetTop - 100, behavior: 'smooth' });

      quoteForm.innerHTML =
        '<div class="text-center py-20 animate__animated animate__zoomIn">' +
          '<div class="bg-blue-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 border border-blue-100 shadow-inner">' +
            '<i class="fas fa-check text-4xl text-blue-600"></i>' +
          '</div>' +
          '<h3 class="text-3xl font-black text-slate-900 mb-4">Request received successfully!</h3>' +
          '<div class="bg-slate-50 border-2 border-dashed border-slate-200 inline-block px-12 py-6 rounded-[2rem] mb-10">' +
            '<span class="block text-xs font-bold text-slate-400 mb-1">Your reference number</span>' +
            '<span class="text-4xl font-black text-blue-900 tracking-widest">' + orderID + '</span>' +
          '</div>' +
          '<div class="flex flex-col gap-4 max-w-xs mx-auto">' +
            '<button onclick="location.reload()" class="text-slate-400 font-bold hover:text-slate-600 transition-all">Submit another request</button>' +
          '</div>' +
        '</div>';
    })
    .catch(function () {
      var errEl = quoteForm.querySelector('.form-submit-error');
      if (!errEl) {
        errEl = document.createElement('p');
        errEl.className = 'form-submit-error text-red-600 text-sm font-bold text-center mt-3';
        var btnEl = quoteForm.querySelector('button[type="submit"]');
        if (btnEl) btnEl.parentNode.insertBefore(errEl, btnEl.nextSibling);
        else quoteForm.appendChild(errEl);
      }
      errEl.textContent = 'Sorry, an error occurred. Please try again.';
      btn.disabled  = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Quote Request';
    });
  });
})();

/* ────────────────────────────────────────────────────────────────
   § 6  Services JS initialisation — AOS (reused pattern)
   ──────────────────────────────────────────────────────────────── */
(function () {
  if (typeof AOS !== 'undefined' && !AOS.refreshHard) return; // already initialised
})();

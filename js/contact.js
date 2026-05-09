/* ================================================================
   contact.js — صفحة contact | الفريدة آيس
   جميع المنطق المشترك (قائمة الجوال، النشرة، واتساب، AOS)
   موجود في js/shared.js — مصدر الحقيقة الوحيد
   ================================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────────
   § 1  عداد المشاريع
   ──────────────────────────────────────────────────────────────── */
function animateValue(el, from, to, ms) {
  var t0 = null;
  function step(ts) {
    if (!t0) t0 = ts;
    var p = Math.min((ts - t0) / ms, 1);
    el.innerHTML = Math.floor(p * (to - from) + from);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function handleProjectCounter(isNew) {
  var el   = document.getElementById('project-counter');
  if (!el) return;
  var base = 550;

  var prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) { el.innerHTML = String(base); return; }

  if (isNew) {
    el.classList.add('animate__animated', 'animate__bounceIn');
    animateValue(el, base, base + 1, 500);
  } else {
    /* نحتفظ بقيمة base في الـ HTML حتى يظهر العنصر في الـ viewport
     * — هذا يضمن أن textContent() يُعيد 550 عند تحميل الصفحة
     * — الأنيميشن تبدأ فقط بعد ظهور العنصر للمستخدم لأول مرة   */
    el.setAttribute('data-final', String(base));
    new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          obs.unobserve(el);
          /* نؤجل إعادة الضبط إلى 0 حتى بعد أول frame مرئي */
          requestAnimationFrame(function () {
            animateValue(el, 0, base, 2000);
          });
        }
      });
    }, { threshold: 0.5 }).observe(el);
  }
}
handleProjectCounter(false);

/* ────────────────────────────────────────────────────────────────
   § 2  قائمة المدن
   ──────────────────────────────────────────────────────────────── */
(function () {
  var cities = {
    'المنطقة الشرقية':      ['الدمام','الخبر','الظهران','الأحساء','الجبيل','القطيف','حفر الباطن','الخفجي','رأس تنورة','بقيق','النعيرية','قرية العليا'],
    'منطقة الرياض':         ['الرياض','الخرج','المجمعة','الدرعية','الدوادمي','الزلفي','شقراء','وادي الدواسر','القويعية','الأفلاج','عفيف','الغاط'],
    'منطقة مكة المكرمة':    ['جدة','مكة المكرمة','الطائف','رابغ','الليث','القنفذة','خليص','تربة','خرمة','رنية'],
    'منطقة المدينة المنورة': ['المدينة المنورة','ينبع','العلا','بدر','المهد','الحناكية'],
    'منطقة القصيم':         ['بريدة','عنيزة','الرس','المذنب','البكيرية','البدائع'],
    'منطقة عسير':           ['أبها','خميس مشيط','أحد رفيدة','محايل عسير','بيشة','النماص'],
    'باقي المناطق':         ['تبوك','حائل','جازان','نجران','سكاكا','عرعر','الباحة'],
    'طلبات دولية':          ['خارج المملكة العربية السعودية']
  };
  var sel = document.getElementById('city-dropdown');
  if (!sel) return;
  Object.keys(cities).forEach(function (region) {
    var grp = document.createElement('optgroup');
    grp.label = region;
    cities[region].forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = opt.textContent = c;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });
})();

/* ────────────────────────────────────────────────────────────────
   § 3  تنقية حقول الإدخال + التحقق من الجوال (10–16 رقماً)
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

  function validate() {
    var digits = tel.value.replace(/^\+/, '').replace(/\D/g, '');
    if (digits.length < 10)      tel.setCustomValidity('رقم الجوال يجب أن يحتوي على 10 أرقام على الأقل');
    else if (digits.length > 16) tel.setCustomValidity('رقم الجوال لا يجب أن يتجاوز 16 رقماً');
    else                         tel.setCustomValidity('');
  }

  tel.addEventListener('input', function () {
    this.value = this.value.replace(/(?!^\+)\D/g, '');
    validate();
  });
  tel.addEventListener('blur', validate);

  window._validateTel = function () { validate(); return tel.checkValidity(); };
})();

/* ────────────────────────────────────────────────────────────────
   § 4  المحرك الهندسي — حساب الألواح والمساحات
   ──────────────────────────────────────────────────────────────── */
var quoteForm = document.getElementById('quote-form');

['dim-l', 'dim-w', 'dim-h'].forEach(function (id) {
  var inp = document.getElementById(id);
  if (!inp) return;
  function enforceMin() {
    var v = parseFloat(inp.value);
    if (!isNaN(v) && v < 1) {
      inp.value = '1';
      inp.setCustomValidity('الحد الأدنى للإدخال هو 1 متر');
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
    ? ' | الواح الارضية: ' + hzPanelCount + ' لوح - طول ' + smaller.toFixed(2) + 'م'
    : '';

  document.getElementById('calc-area').value   = totalArea.toFixed(2) + ' م2';
  document.getElementById('calc-volume').value = volume.toFixed(2)    + ' م3';
  document.getElementById('calc-details').value =
    'اليو شانل: '       + perimeter.toFixed(2)    + 'م' +
    ' | زوايا عادية: '  + normalAngles.toFixed(2) + 'م' +
    ' | زوايا ديكور: '  + decorAngles.toFixed(2)  + 'م' +
    ' | الارضية: '      + (hasFloor ? 'بانل' : 'خرسانة') +
    ' | الواح الجدران: ' + wallPanelCount + ' لوح - طول ' + h.toFixed(2)      + 'م' +
    ' | الواح السقف: '  + hzPanelCount   + ' لوح - طول ' + smaller.toFixed(2) + 'م' +
    floorLine;
}

if (quoteForm) quoteForm.addEventListener('input', recalculate);

/* ────────────────────────────────────────────────────────────────
   § 4b  أزرار مقاسات الباب (± 10سم | عرض: min 70 | ارتفاع: min 170)
   ──────────────────────────────────────────────────────────────── */
(function () {
  var STEP     = 10;
  var doorW    = 70;
  var doorH    = 170;
  var wDisplay = document.getElementById('door-width-display');
  var hDisplay = document.getElementById('door-height-display');
  if (!wDisplay || !hDisplay) return;

  function render() {
    wDisplay.value = doorW + ' سم';
    hDisplay.value = doorH + ' سم';
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
   § 5  إرسال نموذج عرض السعر
   ──────────────────────────────────────────────────────────────── */
if (quoteForm) {
  quoteForm.addEventListener('submit', function (e) {
    e.preventDefault();

    if (window._validateTel && !window._validateTel()) {
      document.getElementById('tel-input').reportValidity();
      return;
    }

    recalculate();

    var orderID = 'AF-' + new Date().getFullYear().toString().slice(-2) +
                  Math.floor(1000 + Math.random() * 9000);

    var btn = quoteForm.querySelector('button[type="submit"]');
    btn.disabled  = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري إرسال طلبك...';

    var obj = { 'رقم_الطلب': orderID };
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
      if (!res.success) throw new Error(res.message || 'فشل الإرسال');
      handleProjectCounter(true);
      window.scrollTo({ top: quoteForm.offsetTop - 100, behavior: 'smooth' });
      quoteForm.innerHTML =
        '<div class="text-center py-20 animate__animated animate__zoomIn">' +
          '<div class="bg-blue-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 border border-blue-100 shadow-inner">' +
            '<i class="fas fa-check text-4xl text-blue-600"></i>' +
          '</div>' +
          '<h3 class="text-3xl font-black text-slate-900 mb-4">تم استلام طلبك بنجاح!</h3>' +
          '<div class="bg-slate-50 border-2 border-dashed border-slate-200 inline-block px-12 py-6 rounded-[2rem] mb-10">' +
            '<span class="block text-xs font-bold text-slate-400 mb-1">رقم المرجع الخاص بك</span>' +
            '<span class="text-4xl font-black text-blue-900 tracking-widest">' + orderID + '</span>' +
          '</div>' +
          '<div class="flex flex-col gap-4 max-w-xs mx-auto">' +
            '<button onclick="location.reload()" class="text-slate-400 font-bold hover:text-slate-600 transition-all">إرسال طلب لغرفة أخرى</button>' +
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
      errEl.textContent = 'عذراً، حدث خطأ أثناء الإرسال. يرجى المحاولة مرة أخرى.';
      btn.disabled  = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال طلب عرض السعر';
    });
  });
}

/* ================================================================
   article-shell.js — يُحقن في كل صفحات المقالات
   يُضيف: النافبار الكامل + الفوتر الكامل + واتساب + شريط التقدم
   ================================================================ */

(function () {
  'use strict';

  /* ─── 0. تحديد المسار النسبي لجذر الموقع ─── */
  const ROOT = '../../';

  /* ─── 1. شريط تقدم القراءة ─── */
  (function initReadingProgress() {
    const bar = document.getElementById('readingProgress');
    if (!bar) return;
    window.addEventListener('scroll', function () {
      const scrolled  = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (maxScroll > 0 ? (scrolled / maxScroll) * 100 : 0) + '%';
    }, { passive: true });
  }());

  /* ─── 2. حقن النافبار الكامل ─── */
  (function injectNav() {
    const placeholder = document.getElementById('article-nav-placeholder');
    if (!placeholder) return;

    /* تحديد الرابط النشط الحالي */
    const currentFile = window.location.pathname.split('/').pop();

    function navLink(href, label, extraClasses) {
      const isActive = currentFile && href.includes(currentFile);
      const cls = isActive
        ? 'text-blue-700 border-b-2 border-blue-700 hover:text-blue-600 transition'
        : 'hover:text-blue-600 transition';
      return '<a href="' + href + '" class="' + cls + (extraClasses ? ' ' + extraClasses : '') + '">' + label + '</a>';
    }

    placeholder.outerHTML = [
      '<nav class="sticky top-0 z-[100] bg-white border-b border-slate-200 shadow-sm" role="navigation" aria-label="القائمة الرئيسية">',
        '<div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">',

          /* الشعار */
          '<a href="' + ROOT + 'index.html" class="flex items-center gap-3 transition-transform hover:scale-[1.02]" aria-label="الصفحة الرئيسية — الفريدة آيس">',
            '<img src="' + ROOT + 'assets/ace-logos/elfaridaice.webp" alt="الفريدة آيس للتبريد الصناعي" width="80" height="80" class="h-16 md:h-20 w-auto" loading="eager">',
            '<div class="hidden sm:block">',
              '<span class="block text-2xl font-black text-blue-900 leading-none">الفريدة آيس</span>',
              '<span class="text-[13px] font-bold text-red-600 tracking-wide">للتبريد والتجميد الصناعي</span>',
            '</div>',
          '</a>',

          /* روابط سطح المكتب */
          '<div class="hidden lg:flex items-center gap-5 xl:gap-6 font-extrabold text-slate-700 text-sm xl:text-base">',
            navLink(ROOT + 'index.html',    'الرئيسية'),
            navLink(ROOT + 'services.html', 'خدماتنا'),
            navLink(ROOT + 'projects.html', 'مشاريعنا'),
            navLink(ROOT + 'brands.html',   'شركاؤنا'),
            navLink(ROOT + 'about.html',    'من نحن'),
            '<a href="' + ROOT + 'blog.html" class="text-blue-700 border-b-2 border-blue-700 hover:text-blue-600 transition">المدونة</a>',
            '<a href="' + ROOT + 'contact.html" class="bg-blue-800 text-white px-7 py-3 rounded-xl hover:bg-red-600 transition shadow-lg transform hover:-translate-y-0.5 whitespace-nowrap">لطلب عرض سعر</a>',
            '<a href="' + ROOT + 'blog-en.html" class="text-sm font-black text-slate-600 hover:text-blue-700 transition rounded-full px-3 py-1.5 border border-slate-200/60 bg-white/60" aria-label="English version">EN</a>',
          '</div>',

          /* زر الجوال */
          '<button id="site-mobile-menu-btn"',
            'class="lg:hidden text-2xl text-blue-900 p-2 rounded-xl hover:bg-slate-100 transition"',
            'aria-label="فتح القائمة" aria-expanded="false" aria-controls="site-mobile-menu">',
            '<i class="fas fa-bars" aria-hidden="true"></i>',
          '</button>',
        '</div>',

        /* قائمة الجوال */
        '<div id="site-mobile-menu"',
             'class="lg:hidden max-h-0 opacity-0 pointer-events-none overflow-hidden transition-all duration-300 ease-out bg-white/95 backdrop-blur-md border-b border-slate-200/60"',
             'role="menu">',
          '<a href="' + ROOT + 'index.html"    class="block px-4 py-3 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition font-bold">الرئيسية</a>',
          '<a href="' + ROOT + 'services.html" class="block px-4 py-3 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition font-bold">خدماتنا</a>',
          '<a href="' + ROOT + 'projects.html" class="block px-4 py-3 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition font-bold">مشاريعنا</a>',
          '<a href="' + ROOT + 'brands.html"   class="block px-4 py-3 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition font-bold">شركاؤنا</a>',
          '<a href="' + ROOT + 'about.html"    class="block px-4 py-3 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition font-bold">من نحن</a>',
          '<a href="' + ROOT + 'blog.html"     class="block px-4 py-3 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 font-bold">المدونة</a>',
          '<a href="' + ROOT + 'contact.html"  class="block px-4 py-3 mx-4 rounded-xl bg-blue-800 text-white text-center hover:bg-red-600 transition font-extrabold mt-1">لطلب عرض سعر</a>',
          '<a href="' + ROOT + 'blog-en.html"  class="block px-4 py-3 mx-4 mb-4 rounded-xl text-center font-bold text-blue-700 bg-white border border-slate-200/60 hover:bg-blue-50 transition mt-2" aria-label="English version">EN</a>',
        '</div>',
      '</nav>',
    ].join('');
  }());

  /* ─── 3. حقن الفوتر الكامل ─── */
  (function injectFooter() {
    const placeholder = document.getElementById('article-footer-placeholder');
    if (!placeholder) return;

    placeholder.outerHTML = [
      '<footer class="bg-slate-950 text-white pt-16 pb-8" role="contentinfo">',
        '<div class="max-w-7xl mx-auto px-4 grid md:grid-cols-4 gap-12 text-right">',

          /* عمود 1: الشعار */
          '<div class="space-y-6">',
            '<img src="' + ROOT + 'assets/ace-logos/logo elfarida (1).webp"',
                 'width="200" height="128" loading="lazy"',
                 'class="h-20 md:h-32 brightness-200 -mt-1"',
                 'alt="الفريدة آيس - شركة التبريد الصناعي">',
            '<p class="text-slate-400 text-sm leading-relaxed">',
              'الفريدة آيس.. نبتكر حلول التبريد الهندسي لحماية استثماراتكم في كافة أنحاء المملكة.',
            '</p>',
          '</div>',

          /* عمود 2: روابط */
          '<nav aria-label="روابط الموقع">',
            '<h3 class="text-lg font-bold mb-6 border-r-4 border-blue-600 pr-3">روابط هامة</h3>',
            '<ul class="space-y-3 text-slate-400 text-sm">',
              '<li><a href="' + ROOT + 'services.html" class="hover:text-blue-400 transition">خدمات التبريد</a></li>',
              '<li><a href="' + ROOT + 'projects.html" class="hover:text-blue-400 transition">سجل المشاريع</a></li>',
              '<li><a href="' + ROOT + 'brands.html"   class="hover:text-blue-400 transition">شركاؤنا</a></li>',
              '<li><a href="' + ROOT + 'about.html"    class="hover:text-blue-400 transition">من نحن</a></li>',
              '<li><a href="' + ROOT + 'blog.html"     class="hover:text-blue-400 transition">المدونة</a></li>',
              '<li><a href="' + ROOT + 'contact.html"  class="hover:text-blue-400 transition">اطلب استشارة</a></li>',
            '</ul>',
          '</nav>',

          /* عمود 3: تواصل */
          '<div>',
            '<h3 class="text-lg font-bold mb-6 border-r-4 border-blue-600 pr-3">تواصل معنا</h3>',
            '<div class="text-slate-400 text-sm space-y-4">',
              '<p><i class="fas fa-phone-alt ml-2 text-blue-500" aria-hidden="true"></i> 0598366214</p>',
              '<p><i class="fas fa-envelope ml-2 text-blue-500" aria-hidden="true"></i> <a href="mailto:info@elfaridaice.com" class="hover:text-blue-400 transition">info@elfaridaice.com</a></p>',
              '<a href="https://maps.app.goo.gl/4xEzGMmeBQXy9wa3A" target="_blank" rel="noopener noreferrer" class="flex items-start hover:text-white transition">',
                '<i class="fas fa-map-marker-alt ml-2 mt-1 text-blue-500" aria-hidden="true"></i>',
                '<span>الدمام، حي البادية، المملكة العربية السعودية</span>',
              '</a>',
              '<a href="https://maps.app.goo.gl/UwLW2S4e4BVHhKfd9" target="_blank" rel="noopener noreferrer" class="flex items-start hover:text-white transition">',
                '<i class="fas fa-map-marker-alt ml-2 mt-1 text-blue-500" aria-hidden="true"></i>',
                '<span>الدمام، الخضرية، المملكة العربية السعودية</span>',
              '</a>',
              '<a href="https://maps.app.goo.gl/CykzikzhA1j5RUgE8" target="_blank" rel="noopener noreferrer" class="flex items-start hover:text-white transition">',
                '<i class="fas fa-map-marker-alt ml-2 mt-1 text-blue-500" aria-hidden="true"></i>',
                '<span>الرياض، السلي، المملكة العربية السعودية</span>',
              '</a>',
              '<div class="flex gap-3 mt-4 justify-end">',
                '<a href="https://www.facebook.com/alfaridaice.sa/"      target="_blank" rel="noopener noreferrer" aria-label="فيسبوك"   class="bg-white/10 hover:bg-blue-600   w-9 h-9 rounded-full flex items-center justify-center transition-all hover:-translate-y-1"><i class="fab fa-facebook-f  text-sm" aria-hidden="true"></i></a>',
                '<a href="https://www.instagram.com/alfaridaice_sa/"     target="_blank" rel="noopener noreferrer" aria-label="انستجرام" class="bg-white/10 hover:bg-pink-600   w-9 h-9 rounded-full flex items-center justify-center transition-all hover:-translate-y-1"><i class="fab fa-instagram   text-sm" aria-hidden="true"></i></a>',
                '<a href="https://x.com/EngMoha64468185"                 target="_blank" rel="noopener noreferrer" aria-label="تويتر X"  class="bg-white/10 hover:bg-black      w-9 h-9 rounded-full flex items-center justify-center transition-all hover:-translate-y-1"><i class="fab fa-x-twitter  text-sm" aria-hidden="true"></i></a>',
                '<a href="https://www.tiktok.com/@alfaridaice_sa"        target="_blank" rel="noopener noreferrer" aria-label="تيك توك"  class="bg-white/10 hover:bg-black      w-9 h-9 rounded-full flex items-center justify-center transition-all hover:-translate-y-1"><i class="fab fa-tiktok     text-sm" aria-hidden="true"></i></a>',
                '<a href="https://www.snapchat.com/@alfaridaice_sa"      target="_blank" rel="noopener noreferrer" aria-label="سناب شات" class="bg-white/10 hover:bg-yellow-400 w-9 h-9 rounded-full flex items-center justify-center transition-all hover:-translate-y-1"><i class="fab fa-snapchat   text-sm" aria-hidden="true"></i></a>',
                '<a href="https://sa.linkedin.com/company/al-farida-ice" target="_blank" rel="noopener noreferrer" aria-label="لينكد إن" class="bg-white/10 hover:bg-blue-700   w-9 h-9 rounded-full flex items-center justify-center transition-all hover:-translate-y-1"><i class="fab fa-linkedin-in text-sm" aria-hidden="true"></i></a>',
              '</div>',
            '</div>',
          '</div>',

          /* عمود 4: النشرة البريدية */
          '<div>',
            '<h3 class="text-lg font-bold mb-6 border-r-4 border-blue-600 pr-3">النشرة البريدية</h3>',
            '<p class="text-slate-400 text-xs mb-4">اشترك ليصلك جديد مشاريعنا وعروضنا.</p>',
            '<form action="https://api.web3forms.com/submit" method="POST" class="space-y-3" id="footer-newsletter-form">',
              '<input type="hidden" name="access_key"  value="770521ce-1959-4e16-9147-597d9e5bf3e8">',
              '<input type="hidden" name="subject"     value="اشتراك في النشرة البريدية - الفريدة آيس">',
              '<input type="hidden" name="from_name"   value="موقع الفريدة آيس">',
              '<input type="hidden" name="ملاحظات"     value="اشتراك من صفحة مقال">',
              '<input type="email" name="Email" id="footer-email-input"',
                     'placeholder="بريدك الإلكتروني" required dir="ltr" autocomplete="off"',
                     'class="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 text-left">',
              '<p id="footer-email-error" class="text-red-400 text-xs hidden">يرجى إدخال بريد إلكتروني صحيح</p>',
              '<input type="checkbox" name="botcheck" aria-label="حقل مخفي" aria-hidden="true" style="display:none">',
              '<button type="submit" id="footer-newsletter-btn"',
                      'class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg">',
                'اشترك الآن',
              '</button>',
              '<div id="footer-success" class="hidden text-green-400 text-sm text-center py-2">✅ تم الاشتراك بنجاح!</div>',
              '<div id="footer-error"   class="hidden text-red-400   text-sm text-center py-2">❌ حدث خطأ، حاول مرة أخرى</div>',
            '</form>',
          '</div>',

        '</div>',

        /* حقوق الملكية */
        '<div class="max-w-7xl mx-auto px-4 mt-16 pt-8 border-t border-slate-800 text-center">',
          '<p class="text-slate-500 text-sm font-bold">جميع الحقوق محفوظة &copy; 2026 شركة الفريدة آيس</p>',
        '</div>',
      '</footer>',
    ].join('');
  }());

  /* ─── 4. حقن زر واتساب ─── */
  (function injectWhatsApp() {
    if (document.getElementById('wa-widget')) return;

    var widget = document.createElement('div');
    widget.id  = 'wa-widget';
    widget.innerHTML = [
      '<div id="wa-balloon" style="opacity:0;transform:translateX(16px) scale(0.95);transition:all 0.35s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;max-width:240px;">',
        '<div style="background:#fff;border-radius:16px 16px 4px 16px;padding:12px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.13);position:relative;">',
          '<button id="wa-close" style="position:absolute;top:6px;left:8px;background:none;border:none;cursor:pointer;color:#94a3b8;font-size:14px;padding:0;line-height:1;" aria-label="إغلاق">✕</button>',
          '<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#0f172a;">هل مشروعك يحتاج تبريد؟ ❄️</p>',
          '<p style="margin:0;font-size:12px;color:#475569;line-height:1.5;">احصل على استشارة مجانية الآن — نرد خلال دقائق</p>',
          '<div style="position:absolute;bottom:-8px;right:18px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid #fff;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.08));"></div>',
        '</div>',
      '</div>',
      '<div style="position:relative;">',
        '<span style="position:absolute;inset:0;border-radius:50%;background:rgba(37,211,102,0.35);animation:wa-pulse 2s ease-out infinite;"></span>',
        '<span style="position:absolute;inset:0;border-radius:50%;background:rgba(37,211,102,0.2);animation:wa-pulse 2s ease-out infinite 0.5s;"></span>',
        '<span id="wa-badge" style="position:absolute;top:-4px;right:-4px;background:#dc2626;color:#fff;font-size:10px;font-weight:700;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;animation:wa-badge-in 0.4s cubic-bezier(0.34,1.56,0.64,1) 3s both;">5</span>',
        '<a href="https://wa.me/966598366214?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%D8%8C%20%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%A7%D8%B3%D8%AA%D8%B4%D8%A7%D8%B1%D8%A9%20%D9%85%D8%AC%D8%A7%D9%86%D9%8A%D8%A9%20%D8%AD%D9%88%D9%84%20%D9%85%D8%B4%D8%B1%D9%88%D8%B9%20%D8%A7%D9%84%D8%AA%D8%A8%D8%B1%D9%8A%D8%AF"',
           'target="_blank" rel="noopener noreferrer" id="wa-btn"',
           'aria-label="تواصل معنا على واتساب — استشارة مجانية"',
           'style="position:relative;width:60px;height:60px;background:#25d366;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(37,211,102,0.5);text-decoration:none;transition:transform 0.2s,box-shadow 0.2s;"',
           'onmouseenter="this.style.transform=\'scale(1.1)\';this.style.boxShadow=\'0 6px 28px rgba(37,211,102,0.65)\'"',
           'onmouseleave="this.style.transform=\'scale(1)\';this.style.boxShadow=\'0 4px 20px rgba(37,211,102,0.5)\'"',
           '>',
          '<svg width="30" height="30" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
        '</a>',
      '</div>',
    ].join('');

    document.body.appendChild(widget);

    /* بالون الترحيب */
    setTimeout(function () {
      var balloon = document.getElementById('wa-balloon');
      if (balloon) {
        balloon.style.opacity    = '1';
        balloon.style.transform  = 'translateX(0) scale(1)';
        balloon.style.pointerEvents = 'auto';
      }
    }, 8000);

    var closeBtn = document.getElementById('wa-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        var balloon = document.getElementById('wa-balloon');
        if (balloon) {
          balloon.style.opacity    = '0';
          balloon.style.transform  = 'translateX(16px) scale(0.95)';
          balloon.style.pointerEvents = 'none';
        }
      });
    }
  }());

  /* ─── 5. قائمة الجوال (مشتركة مع shared.js) ─── */
  (function initMobileMenu() {
    var btn  = document.getElementById('site-mobile-menu-btn');
    var menu = document.getElementById('site-mobile-menu');
    if (!btn || !menu) return;

    function openMenu() {
      menu.classList.remove('max-h-0', 'opacity-0', 'pointer-events-none');
      menu.classList.add('max-h-[600px]', 'opacity-100', 'pointer-events-auto');
      btn.setAttribute('aria-expanded', 'true');
      var icon = btn.querySelector('i');
      if (icon) { icon.classList.remove('fa-bars'); icon.classList.add('fa-times'); }
    }

    function closeMenu() {
      menu.classList.remove('max-h-[600px]', 'opacity-100', 'pointer-events-auto');
      menu.classList.add('max-h-0', 'opacity-0', 'pointer-events-none');
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
  }());

  /* ─── 6. نشرة بريدية في الفوتر ─── */
  (function initNewsletter() {
    var form    = document.getElementById('footer-newsletter-form');
    var input   = document.getElementById('footer-email-input');
    var btn     = document.getElementById('footer-newsletter-btn');
    var errMsg  = document.getElementById('footer-email-error');
    var success = document.getElementById('footer-success');
    var error   = document.getElementById('footer-error');
    if (!form || !input || !btn) return;

    var EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (errMsg) errMsg.classList.add('hidden');
      if (!EMAIL_RE.test(input.value.trim())) {
        if (errMsg) errMsg.classList.remove('hidden');
        return;
      }

      btn.disabled   = true;
      btn.textContent = 'جاري الإرسال...';

      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: new FormData(form),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.success) {
            if (success) success.classList.remove('hidden');
            form.reset();
          } else {
            if (error) error.classList.remove('hidden');
          }
        })
        .catch(function () {
          if (error) error.classList.remove('hidden');
        })
        .finally(function () {
          btn.disabled    = false;
          btn.textContent = 'اشترك الآن';
        });
    });
  }());

}());

'use strict';
/**
 * faq-schema-injector.js — حاقن FAQ Schema للصفحات الرئيسية
 * يُحقن كـ <script type="application/ld+json"> ويُعرض كـ section مرئي
 */
(function () {
  'use strict';

  // خريطة: نوع الصفحة → فئات FAQ من faq-data.json
  const FAQ_PAGE_MAP = {
    'index': ['general', 'pricing', 'geographic'],
    'services': ['technical', 'pricing', 'general'],
    'contact': ['general', 'pricing'],
    'about': ['general'],
    'industries': ['industries'],
    'projects': ['general', 'comparison']
  };

  function getPageType() {
    const path = (location.pathname || '').toLowerCase();
    if (path === '/' || path.endsWith('/index.html') || path.endsWith('/index-en.html')) return 'index';
    if (/services(-en)?\.html/.test(path)) return 'services';
    if (/contact(-en)?\.html/.test(path)) return 'contact';
    if (/about(-en)?\.html/.test(path)) return 'about';
    if (/industries(-en)?\.html/.test(path) && !/\/industries\//.test(path)) return 'industries';
    if (/projects(-en)?\.html/.test(path)) return 'projects';
    return null;
  }

  function isArabic() {
    return (document.documentElement.lang || '').toLowerCase().indexOf('ar') === 0;
  }

  function injectSchema(faqs) {
    if (!faqs || !faqs.length) return;
    const existing = document.querySelector('script[data-faq-injected="true"]');
    if (existing) return;
    const data = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqs.map(function (f) {
        return {
          "@type": "Question",
          "name": f.q_ar,
          "acceptedAnswer": { "@type": "Answer", "text": f.a_ar }
        };
      })
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-faq-injected', 'true');
    script.textContent = JSON.stringify(data, null, 2);
    document.head.appendChild(script);
  }

  function injectSection(faqs) {
    if (!faqs || !faqs.length) return;
    if (document.getElementById('auto-faq-section')) return;

    const isAr = isArabic();
    const section = document.createElement('section');
    section.id = 'auto-faq-section';
    section.className = 'py-20 bg-gradient-to-br from-slate-50 to-blue-50';
    section.setAttribute('aria-labelledby', 'auto-faq-heading');

    const html = [
      '<div class="max-w-4xl mx-auto px-4">',
      '<div class="text-center mb-12">',
      '<span class="text-blue-600 font-black text-sm uppercase tracking-widest">' + (isAr ? 'الأسئلة الشائعة' : 'Frequently Asked Questions') + '</span>',
      '<h2 id="auto-faq-heading" class="text-4xl font-black text-slate-900 mt-2 mb-4">' + (isAr ? 'إجابات على أكثر استفساراتكم' : 'Answers to your most common questions') + '</h2>',
      '</div>',
      '<div class="space-y-4">'
    ];

    faqs.forEach(function (f, i) {
      html.push(
        '<details class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition">' +
          '<summary class="p-6 cursor-pointer font-black text-slate-900 hover:bg-blue-50 transition flex items-center justify-between">' +
            '<span class="flex-1">' + escapeHtml(f.q_ar) + '</span>' +
            '<span class="text-blue-600 text-2xl flex-shrink-0 ' + (isAr ? 'mr-4' : 'ml-4') + '">+</span>' +
          '</summary>' +
          '<div class="px-6 pb-6 text-slate-700 leading-relaxed border-t border-slate-100 pt-4">' + escapeHtml(f.a_ar) + '</div>' +
        '</details>'
      );
    });

    html.push('</div></div>');
    section.innerHTML = html.join('');

    const footer = document.querySelector('footer[role="contentinfo"]') || document.querySelector('footer');
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(section, footer);
    } else {
      document.body.appendChild(section);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadAndInject() {
    const pageType = getPageType();
    if (!pageType) return;

    fetch('/lib/faq-data.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.categories) return;
        const allowedCategories = FAQ_PAGE_MAP[pageType] || [];
        const collected = [];
        for (let i = 0; i < allowedCategories.length; i++) {
          const cat = data.categories[allowedCategories[i]];
          if (cat && cat.questions) {
            for (let j = 0; j < cat.questions.length; j++) {
              collected.push(cat.questions[j]);
              if (collected.length >= 8) break;
            }
            if (collected.length >= 8) break;
          }
        }
        if (!collected.length) return;
        injectSchema(collected);
        injectSection(collected);
      })
      .catch(function () { /* silent — non-blocking */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndInject);
  } else {
    loadAndInject();
  }
})();

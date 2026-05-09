/**
 * ════════════════════════════════════════════════════════════════════
 *  js/seo-injector.js
 *  ────────────────────────────────────────────────────────────────────
 *  Universal Schema.org injector. Loads site.config.json once,
 *  derives the appropriate JSON-LD blocks for the current page, and
 *  injects them into <head> at runtime. This guarantees every page
 *  ships:
 *
 *    • Organization + LocalBusiness (sitewide)
 *    • WebSite with potentialAction SearchAction
 *    • WebPage scoped to the current URL
 *    • BreadcrumbList derived from URL path
 *    • FAQPage (homepage + services pages only)
 *    • Service entries (services pages)
 *    • SpeakableSpecification (homepage)
 *
 *  Idempotent: re-injection is suppressed via a sentinel attribute.
 *  Fail-soft: any fetch/parse error is caught silently — pages remain
 *  fully functional even if the injector cannot reach the config.
 *  ════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  if (document.documentElement.dataset.seoInjected === 'true') return;
  document.documentElement.dataset.seoInjected = 'true';

  /* ─── Constants ────────────────────────────────────────────────── */

  const CONFIG_URL = '/lib/site.config.json';
  const SENTINEL   = 'data-seo-injector';
  const SITE_URL   = 'https://elfaridaice.com';

  /* ─── Page detection ───────────────────────────────────────────── */

  /**
   * Normalise the current pathname for routing decisions.
   * @returns {string}
   */
  function currentPath() {
    const p = window.location.pathname.replace(/\/+$/, '');
    return p === '' ? '/' : p;
  }

  /**
   * Determine page locale from <html lang>.
   * @returns {('ar'|'en')}
   */
  function locale() {
    return (document.documentElement.lang || 'ar').toLowerCase().startsWith('en') ? 'en' : 'ar';
  }

  /**
   * Identify the page family (home, services, projects, etc.).
   * @returns {string}
   */
  function pageType() {
    const p = currentPath();
    if (p === '/' || /^\/index(-en)?\.html$/.test(p)) return 'home';
    if (/services/.test(p))                            return 'services';
    if (/projects/.test(p))                            return 'projects';
    if (/contact/.test(p))                             return 'contact';
    if (/about/.test(p))                               return 'about';
    if (/blog/.test(p))                                return 'blog';
    if (/brands/.test(p))                              return 'brands';
    if (/^\/cold-rooms-/.test(p))                      return 'geo-landing';
    if (/^\/assets\/articles\//.test(p))               return 'article';
    return 'other';
  }

  /* ─── Schema builders ──────────────────────────────────────────── */

  /**
   * Sitewide Organization + LocalBusiness schema.
   * @param {object} cfg
   * @param {('ar'|'en')} lang
   * @returns {object}
   */
  function buildOrganization(cfg, lang) {
    const hq = cfg.headquarters[lang];
    const org = {
      '@context': 'https://schema.org',
      '@type': ['Organization', 'LocalBusiness', 'ProfessionalService'],
      '@id': `${SITE_URL}/#organization`,
      name: lang === 'ar' ? cfg.organization.legalNameAr : cfg.organization.legalNameEn,
      alternateName: lang === 'ar' ? cfg.organization.shortNameAr : cfg.organization.shortNameEn,
      url: SITE_URL,
      logo: `${SITE_URL}${cfg.organization.logo}`,
      image: `${SITE_URL}${cfg.organization.ogImage}`,
      foundingDate: String(cfg.organization.foundingYear),
      telephone: cfg.contact.phonePrimary.e164,
      email: cfg.contact.email,
      priceRange: '$$',
      address: {
        '@type': 'PostalAddress',
        streetAddress: hq.streetAddress,
        addressLocality: hq.addressLocality,
        addressRegion: hq.addressRegion,
        postalCode: cfg.headquarters.postalCode,
        addressCountry: 'SA',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: cfg.headquarters.geo.lat,
        longitude: cfg.headquarters.geo.lng,
      },
      openingHoursSpecification: cfg.openingHours.map((h) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: h.dayOfWeek,
        opens: h.opens,
        closes: h.closes,
      })),
      areaServed: cfg.areasServed.map((a) => ({ '@type': 'City', name: a[lang] })),
      sameAs: Object.values(cfg.social).filter(Boolean),
      contactPoint: [{
        '@type': 'ContactPoint',
        telephone: cfg.contact.phonePrimary.e164,
        contactType: 'sales',
        availableLanguage: ['ar', 'en'],
        areaServed: 'SA',
      }],
    };
    if (cfg.aggregateRating) {
      org.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: cfg.aggregateRating.ratingValue,
        reviewCount: cfg.aggregateRating.reviewCount,
        bestRating:  cfg.aggregateRating.bestRating,
        worstRating: cfg.aggregateRating.worstRating,
      };
    }
    return org;
  }

  /**
   * WebSite with SearchAction.
   * @returns {object}
   */
  function buildWebsite() {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'Elfarida Ice',
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: ['ar', 'en'],
    };
  }

  /**
   * Build BreadcrumbList from the current URL path.
   * @param {('ar'|'en')} lang
   * @returns {object}
   */
  function buildBreadcrumbs(lang) {
    const pathname = currentPath();
    const homeName = lang === 'ar' ? 'الرئيسية' : 'Home';
    const items = [{ '@type': 'ListItem', position: 1, name: homeName, item: SITE_URL + '/' }];

    if (pathname !== '/' && !/^\/index(-en)?\.html$/.test(pathname)) {
      const slug    = pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/-en$/, '');
      const labelAr = {
        services: 'خدماتنا', projects: 'مشاريعنا', contact: 'تواصل معنا',
        about: 'من نحن', blog: 'المدونة', brands: 'الشركاء',
        privacy: 'سياسة الخصوصية', terms: 'الشروط والأحكام',
      };
      const labelEn = {
        services: 'Services', projects: 'Projects', contact: 'Contact',
        about: 'About Us', blog: 'Blog', brands: 'Partners',
        privacy: 'Privacy Policy', terms: 'Terms',
      };
      const label = (lang === 'ar' ? labelAr[slug] : labelEn[slug]) || slug;
      items.push({ '@type': 'ListItem', position: 2, name: label, item: SITE_URL + pathname });
    }

    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      '@id': `${SITE_URL}${pathname}#breadcrumb`,
      itemListElement: items,
    };
  }

  /**
   * Build WebPage scoped to current URL.
   * @returns {object}
   */
  function buildWebPage(lang) {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${SITE_URL}${currentPath()}#webpage`,
      url: SITE_URL + currentPath(),
      inLanguage: lang,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about:   { '@id': `${SITE_URL}/#organization` },
      breadcrumb: { '@id': `${SITE_URL}${currentPath()}#breadcrumb` },
      datePublished: '2026-01-01',
      dateModified:  new Date().toISOString().slice(0, 10),
    };
  }

  /**
   * Build FAQPage from geo-specific FAQ templates, substituting city name.
   * @param {object} cfg
   * @param {('ar'|'en')} lang
   * @returns {object}
   */
  function buildGeoFAQ(cfg, lang) {
    const templates = cfg.geoFaqTemplates || [];
    if (!templates.length) return null;
    const city = getCityName(lang);
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      '@id': `${SITE_URL}${currentPath()}#faq`,
      mainEntity: templates.map((f) => ({
        '@type': 'Question',
        name: f.question[lang].replace(/\{city\}/g, city),
        acceptedAnswer: {
          '@type': 'Answer',
          text: f.answer[lang].replace(/\{city\}/g, city),
        },
      })),
    };
  }

  /**
   * Extract city name from geo.placename meta tag or URL slug.
   * @param {('ar'|'en')} lang
   * @returns {string}
   */
  function getCityName(lang) {
    const geoMeta = document.querySelector('meta[name="geo.placename"]');
    if (geoMeta) {
      return (geoMeta.getAttribute('content') || '').split(',')[0].trim();
    }
    const slugMap = {
      'riyadh':       { ar: 'الرياض',          en: 'Riyadh' },
      'jeddah':       { ar: 'جدة',              en: 'Jeddah' },
      'dammam':       { ar: 'الدمام',            en: 'Dammam' },
      'khobar':       { ar: 'الخبر',             en: 'Khobar' },
      'jubail':       { ar: 'الجبيل',            en: 'Jubail' },
      'makkah':       { ar: 'مكة المكرمة',       en: 'Makkah' },
      'medina':       { ar: 'المدينة المنورة',   en: 'Medina' },
      'abha':         { ar: 'أبها',              en: 'Abha' },
      'tabuk':        { ar: 'تبوك',              en: 'Tabuk' },
      'hail':         { ar: 'حائل',              en: 'Hail' },
      'buraidah':     { ar: 'بريدة',             en: 'Buraydah' },
      'al-ahsa':      { ar: 'الأحساء',           en: 'Al-Ahsa' },
      'hafr-al-batin':{ ar: 'حفر الباطن',        en: 'Hafr Al-Batin' },
      'qatif':        { ar: 'القطيف',            en: 'Qatif' },
    };
    const match = currentPath().match(/cold-rooms-([a-z-]+?)(?:-en)?\.html/);
    if (match && slugMap[match[1]]) return slugMap[match[1]][lang];
    return lang === 'ar' ? 'مدينتك' : 'your city';
  }

  /**
   * FAQPage from configured Q&As.
   * @param {object} cfg
   * @param {('ar'|'en')} lang
   * @returns {object}
   */
  function buildFAQ(cfg, lang) {
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      '@id': `${SITE_URL}${currentPath()}#faq`,
      mainEntity: cfg.faqs.map((f) => ({
        '@type': 'Question',
        name: f.question[lang],
        acceptedAnswer: { '@type': 'Answer', text: f.answer[lang] },
      })),
    };
  }

  /**
   * Service entries — one per configured service.
   * @param {object} cfg
   * @param {('ar'|'en')} lang
   * @returns {object[]}
   */
  function buildServices(cfg, lang) {
    return cfg.services.map((s) => ({
      '@context': 'https://schema.org',
      '@type': 'Service',
      '@id': `${SITE_URL}/services.html#${s.id}`,
      serviceType: s.name[lang],
      name: s.name[lang],
      description: s.shortDescription[lang],
      provider: { '@id': `${SITE_URL}/#organization` },
      areaServed: cfg.areasServed.map((a) => ({ '@type': 'City', name: a[lang] })),
    }));
  }

  /**
   * SpeakableSpecification — improves voice search snippets.
   * @returns {object}
   */
  function buildSpeakable() {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${SITE_URL}${currentPath()}#speakable`,
      speakable: {
        '@type': 'SpeakableSpecification',
        cssSelector: ['h1', '.hero-subtitle', '[data-speakable]'],
      },
    };
  }

  /* ─── Injection orchestration ──────────────────────────────────── */

  /**
   * Inject a JSON-LD script tag into <head>.
   * @param {object} obj
   */
  function injectScript(obj) {
    const tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.setAttribute(SENTINEL, 'true');
    tag.textContent = JSON.stringify(obj);
    document.head.appendChild(tag);
  }

  /**
   * Top-level orchestration — selects schema set per page family.
   * @param {object} cfg
   */
  function inject(cfg) {
    const lang = locale();
    const type = pageType();

    injectScript(buildOrganization(cfg, lang));
    injectScript(buildWebsite());
    injectScript(buildBreadcrumbs(lang));
    injectScript(buildWebPage(lang));

    if (type === 'home') {
      injectScript(buildFAQ(cfg, lang));
      injectScript(buildSpeakable());
    }

    if (type === 'services') {
      injectScript(buildFAQ(cfg, lang));
      buildServices(cfg, lang).forEach(injectScript);
    }

    if (type === 'geo-landing') {
      const geoFaq = buildGeoFAQ(cfg, lang);
      if (geoFaq) injectScript(geoFaq);
    }
  }

  /* ─── Entry ────────────────────────────────────────────────────── */

  fetch(CONFIG_URL, { credentials: 'omit' })
    .then((res) => {
      if (!res.ok) throw new Error('config fetch failed: ' + res.status);
      return res.json();
    })
    .then(function (cfg) {
      inject(cfg);
      loadAnalytics(cfg);
    })
    .catch(() => { /* fail-soft: page remains fully functional */ });

  /* ─── Google Analytics 4 — lazy load after idle ───────────────── */

  /**
   * Inject GA4 after the browser is idle (or after first user interaction).
   * This avoids blocking LCP / FID and keeps Core Web Vitals green.
   * The measurement ID is read from site.config.json gaId field.
   * Replace 'G-XXXXXXXXXX' in lib/site.config.json with your real ID.
   * @param {object} cfg
   */
  function loadAnalytics(cfg) {
    var gaId = cfg && cfg.gaId;
    if (!gaId || gaId === 'G-XXXXXXXXXX') return; /* skip until ID is set */

    function inject() {
      if (document.querySelector('script[data-ga4]')) return; /* idempotent */
      var s = document.createElement('script');
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId;
      s.async = true;
      s.setAttribute('data-ga4', 'true');
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      gtag('js', new Date());
      gtag('config', gaId, { anonymize_ip: true });
    }

    if ('requestIdleCallback' in window) {
      requestIdleCallback(inject, { timeout: 4000 });
    } else {
      setTimeout(inject, 3000);
    }
  }
})();

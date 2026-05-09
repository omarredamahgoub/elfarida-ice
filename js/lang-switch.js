/* ================================================================
   lang-switch.js — مصدر الحقيقة الوحيد لتبديل اللغة
   ════════════════════════════════════════════════════════════════
   يوفر window.LangSwitch.resolveHref() → href جاهز للاستخدام
   مباشرةً في خاصية href بدون أي معالجة إضافية.

   الخريطة تُعرِّف لكل صفحة: { counterpart, dir }
     - counterpart : اسم ملف اللغة المقابلة
     - dir         : المجلد النسبي من جذر المشروع ('' | 'industries/' | 'assets/articles/')

   منطق حساب href النهائي:
     1. استخراج مجلد الصفحة الحالية من window.location.pathname.
     2. حساب المسار النسبي من الصفحة الحالية إلى ملف اللغة المقابلة.
     3. إعادة href نسبي صحيح يعمل في أي مستوى عمق.
   ================================================================ */
(function (global) {
  'use strict';

  /*
   * الخريطة الكاملة:
   *   المفتاح  = اسم الملف بالأحرف الصغيرة
   *   القيمة   = { counterpart: string, dir: string }
   *
   * dir هو مسار المجلد الذي يحتوي الملف، منتهياً بـ '/'
   * أو سلسلة فارغة '' للملفات في جذر المشروع.
   */
  var MAP = {
    /* ── جذر الموقع ── */
    'index.html':                       { counterpart: 'index-en.html',                       dir: '' },
    'index-en.html':                    { counterpart: 'index.html',                           dir: '' },
    'about.html':                       { counterpart: 'about-en.html',                        dir: '' },
    'about-en.html':                    { counterpart: 'about.html',                           dir: '' },
    'services.html':                    { counterpart: 'services-en.html',                     dir: '' },
    'services-en.html':                 { counterpart: 'services.html',                        dir: '' },
    'services-technical.html':          { counterpart: 'services-technical-en.html',           dir: '' },
    'services-technical-en.html':       { counterpart: 'services-technical.html',              dir: '' },
    'projects.html':                    { counterpart: 'projects-en.html',                     dir: '' },
    'projects-en.html':                 { counterpart: 'projects.html',                        dir: '' },
    'brands.html':                      { counterpart: 'brands-en.html',                       dir: '' },
    'brands-en.html':                   { counterpart: 'brands.html',                          dir: '' },
    'blog.html':                        { counterpart: 'blog-en.html',                         dir: '' },
    'blog-en.html':                     { counterpart: 'blog.html',                            dir: '' },
    'contact.html':                     { counterpart: 'contact-en.html',                      dir: '' },
    'contact-en.html':                  { counterpart: 'contact.html',                         dir: '' },
    'faq.html':                         { counterpart: 'faq-en.html',                          dir: '' },
    'faq-en.html':                      { counterpart: 'faq.html',                             dir: '' },
    'glossary.html':                    { counterpart: 'glossary-en.html',                     dir: '' },
    'glossary-en.html':                 { counterpart: 'glossary.html',                        dir: '' },
    'industries.html':                  { counterpart: 'industries-en.html',                   dir: '' },
    'industries-en.html':               { counterpart: 'industries.html',                      dir: '' },
    'privacy.html':                     { counterpart: 'privacy-en.html',                      dir: '' },
    'privacy-en.html':                  { counterpart: 'privacy.html',                         dir: '' },
    'terms.html':                       { counterpart: 'terms-en.html',                        dir: '' },
    'terms-en.html':                    { counterpart: 'terms.html',                           dir: '' },
    'cold-room-calculator.html':        { counterpart: 'cold-room-calculator-en.html',         dir: '' },
    'cold-room-calculator-en.html':     { counterpart: 'cold-room-calculator.html',            dir: '' },
    '404.html':                         { counterpart: '404-en.html',                          dir: '' },
    '404-en.html':                      { counterpart: '404.html',                             dir: '' },
    'digital-portfolio.html':           { counterpart: 'digital-portfolio.html',               dir: '' },

    /* ── صفحات المدن ── */
    'cold-rooms-abha.html':             { counterpart: 'cold-rooms-abha-en.html',             dir: '' },
    'cold-rooms-abha-en.html':          { counterpart: 'cold-rooms-abha.html',                dir: '' },
    'cold-rooms-al-ahsa.html':          { counterpart: 'cold-rooms-al-ahsa-en.html',          dir: '' },
    'cold-rooms-al-ahsa-en.html':       { counterpart: 'cold-rooms-al-ahsa.html',             dir: '' },
    'cold-rooms-buraidah.html':         { counterpart: 'cold-rooms-buraidah-en.html',         dir: '' },
    'cold-rooms-buraidah-en.html':      { counterpart: 'cold-rooms-buraidah.html',            dir: '' },
    'cold-rooms-dammam.html':           { counterpart: 'cold-rooms-dammam-en.html',           dir: '' },
    'cold-rooms-dammam-en.html':        { counterpart: 'cold-rooms-dammam.html',              dir: '' },
    'cold-rooms-hafr-al-batin.html':    { counterpart: 'cold-rooms-hafr-al-batin-en.html',   dir: '' },
    'cold-rooms-hafr-al-batin-en.html': { counterpart: 'cold-rooms-hafr-al-batin.html',      dir: '' },
    'cold-rooms-hail.html':             { counterpart: 'cold-rooms-hail-en.html',             dir: '' },
    'cold-rooms-hail-en.html':          { counterpart: 'cold-rooms-hail.html',                dir: '' },
    'cold-rooms-jeddah.html':           { counterpart: 'cold-rooms-jeddah-en.html',           dir: '' },
    'cold-rooms-jeddah-en.html':        { counterpart: 'cold-rooms-jeddah.html',              dir: '' },
    'cold-rooms-jubail.html':           { counterpart: 'cold-rooms-jubail-en.html',           dir: '' },
    'cold-rooms-jubail-en.html':        { counterpart: 'cold-rooms-jubail.html',              dir: '' },
    'cold-rooms-khobar.html':           { counterpart: 'cold-rooms-khobar-en.html',           dir: '' },
    'cold-rooms-khobar-en.html':        { counterpart: 'cold-rooms-khobar.html',              dir: '' },
    'cold-rooms-makkah.html':           { counterpart: 'cold-rooms-makkah-en.html',           dir: '' },
    'cold-rooms-makkah-en.html':        { counterpart: 'cold-rooms-makkah.html',              dir: '' },
    'cold-rooms-medina.html':           { counterpart: 'cold-rooms-medina-en.html',           dir: '' },
    'cold-rooms-medina-en.html':        { counterpart: 'cold-rooms-medina.html',              dir: '' },
    'cold-rooms-qatif.html':            { counterpart: 'cold-rooms-qatif-en.html',            dir: '' },
    'cold-rooms-qatif-en.html':         { counterpart: 'cold-rooms-qatif.html',               dir: '' },
    'cold-rooms-riyadh.html':           { counterpart: 'cold-rooms-riyadh-en.html',           dir: '' },
    'cold-rooms-riyadh-en.html':        { counterpart: 'cold-rooms-riyadh.html',              dir: '' },
    'cold-rooms-tabuk.html':            { counterpart: 'cold-rooms-tabuk-en.html',            dir: '' },
    'cold-rooms-tabuk-en.html':         { counterpart: 'cold-rooms-tabuk.html',               dir: '' },

    /* ── industries/ ── */
    'bakeries.html':            { counterpart: 'bakeries-en.html',          dir: 'industries/' },
    'bakeries-en.html':         { counterpart: 'bakeries.html',             dir: 'industries/' },
    'dairy.html':               { counterpart: 'dairy-en.html',             dir: 'industries/' },
    'dairy-en.html':            { counterpart: 'dairy.html',                dir: 'industries/' },
    'farms.html':               { counterpart: 'farms-en.html',             dir: 'industries/' },
    'farms-en.html':            { counterpart: 'farms.html',                dir: 'industries/' },
    'flower-shops.html':        { counterpart: 'flower-shops-en.html',      dir: 'industries/' },
    'flower-shops-en.html':     { counterpart: 'flower-shops.html',         dir: 'industries/' },
    'hospitals.html':           { counterpart: 'hospitals-en.html',         dir: 'industries/' },
    'hospitals-en.html':        { counterpart: 'hospitals.html',            dir: 'industries/' },
    'ice-factories.html':       { counterpart: 'ice-factories-en.html',     dir: 'industries/' },
    'ice-factories-en.html':    { counterpart: 'ice-factories.html',        dir: 'industries/' },
    'logistics.html':           { counterpart: 'logistics-en.html',         dir: 'industries/' },
    'logistics-en.html':        { counterpart: 'logistics.html',            dir: 'industries/' },
    'meat.html':                { counterpart: 'meat-en.html',              dir: 'industries/' },
    'meat-en.html':             { counterpart: 'meat.html',                 dir: 'industries/' },
    'pharmaceutical.html':      { counterpart: 'pharmaceutical-en.html',    dir: 'industries/' },
    'pharmaceutical-en.html':   { counterpart: 'pharmaceutical.html',       dir: 'industries/' },
    'poultry.html':             { counterpart: 'poultry-en.html',           dir: 'industries/' },
    'poultry-en.html':          { counterpart: 'poultry.html',              dir: 'industries/' },
    'restaurants.html':         { counterpart: 'restaurants-en.html',       dir: 'industries/' },
    'restaurants-en.html':      { counterpart: 'restaurants.html',          dir: 'industries/' },
    'seafood.html':             { counterpart: 'seafood-en.html',           dir: 'industries/' },
    'seafood-en.html':          { counterpart: 'seafood.html',              dir: 'industries/' },
    'supermarkets.html':        { counterpart: 'supermarkets-en.html',      dir: 'industries/' },
    'supermarkets-en.html':     { counterpart: 'supermarkets.html',         dir: 'industries/' },

    /* ── assets/articles/ ── */
    'ammonia-refrigeration-systems-ar.html':  { counterpart: 'ammonia-refrigeration-systems-en.html',  dir: 'assets/articles/' },
    'ammonia-refrigeration-systems-en.html':  { counterpart: 'ammonia-refrigeration-systems-ar.html',  dir: 'assets/articles/' },
    'bitzer-maintenance-ar.html':             { counterpart: 'bitzer-maintenance-en.html',             dir: 'assets/articles/' },
    'bitzer-maintenance-en.html':             { counterpart: 'bitzer-maintenance-ar.html',             dir: 'assets/articles/' },
    'blast-freezer-meat.html':                { counterpart: 'blast-freezer-meat-en.html',             dir: 'assets/articles/' },
    'blast-freezer-meat-en.html':             { counterpart: 'blast-freezer-meat.html',                dir: 'assets/articles/' },
    'cold-room-load-calculation-ar.html':     { counterpart: 'cold-room-load-calculation-en.html',     dir: 'assets/articles/' },
    'cold-room-load-calculation-en.html':     { counterpart: 'cold-room-load-calculation-ar.html',     dir: 'assets/articles/' },
    'cold-storage-dammam-eastern.html':       { counterpart: 'cold-storage-dammam-eastern-en.html',    dir: 'assets/articles/' },
    'cold-storage-dammam-eastern-en.html':    { counterpart: 'cold-storage-dammam-eastern.html',       dir: 'assets/articles/' },
    'cold-store-door-types.html':             { counterpart: 'cold-store-door-types-en.html',          dir: 'assets/articles/' },
    'cold-store-door-types-en.html':          { counterpart: 'cold-store-door-types.html',             dir: 'assets/articles/' },
    'condensing-unit-maintenance.html':       { counterpart: 'condensing-unit-maintenance-en.html',    dir: 'assets/articles/' },
    'condensing-unit-maintenance-en.html':    { counterpart: 'condensing-unit-maintenance.html',       dir: 'assets/articles/' },
    'copeland-scroll-vs-recip.html':          { counterpart: 'copeland-scroll-vs-recip-en.html',       dir: 'assets/articles/' },
    'copeland-scroll-vs-recip-en.html':       { counterpart: 'copeland-scroll-vs-recip.html',          dir: 'assets/articles/' },
    'danfoss-controller-setting.html':        { counterpart: 'danfoss-controller-setting-en.html',     dir: 'assets/articles/' },
    'danfoss-controller-setting-en.html':     { counterpart: 'danfoss-controller-setting.html',        dir: 'assets/articles/' },
    'energy-saving-tips.html':                { counterpart: 'energy-saving-tips-en.html',             dir: 'assets/articles/' },
    'energy-saving-tips-en.html':             { counterpart: 'energy-saving-tips.html',                dir: 'assets/articles/' },
    'friga-bohn-evaporators.html':            { counterpart: 'friga-bohn-evaporators-en.html',         dir: 'assets/articles/' },
    'friga-bohn-evaporators-en.html':         { counterpart: 'friga-bohn-evaporators.html',            dir: 'assets/articles/' },
    'iqf-technology-guide.html':              { counterpart: 'iqf-technology-guide-en.html',           dir: 'assets/articles/' },
    'iqf-technology-guide-en.html':           { counterpart: 'iqf-technology-guide.html',              dir: 'assets/articles/' },
    'refrigeration-gas-leak.html':            { counterpart: 'refrigeration-gas-leak-en.html',         dir: 'assets/articles/' },
    'refrigeration-gas-leak-en.html':         { counterpart: 'refrigeration-gas-leak.html',            dir: 'assets/articles/' },
    'sandwich-panel-specs.html':              { counterpart: 'sandwich-panel-specs-en.html',           dir: 'assets/articles/' },
    'sandwich-panel-specs-en.html':           { counterpart: 'sandwich-panel-specs.html',              dir: 'assets/articles/' },
    'superheat-subcooling-guide.html':        { counterpart: 'superheat-subcooling-guide-en.html',     dir: 'assets/articles/' },
    'superheat-subcooling-guide-en.html':     { counterpart: 'superheat-subcooling-guide.html',        dir: 'assets/articles/' }
  };

  /* ── استخراج معلومات الموقع الحالي من pathname ── */
  function parseLocation(pathname) {
    var p     = (pathname || '').replace(/\\/g, '/');
    var parts = p.split('/');
    var file  = (parts[parts.length - 1] || 'index.html').toLowerCase();
    /* المجلد: كل شيء بعد جذر المشروع (elfarida-ice) وقبل اسم الملف */
    var dir   = '';
    /* نبحث عن مجلدات معروفة في المسار */
    var known = ['industries', 'assets'];
    for (var i = 0; i < parts.length - 1; i++) {
      if (known.indexOf(parts[i]) !== -1) {
        /* نجمع من هنا حتى ما قبل الملف */
        dir = parts.slice(i, parts.length - 1).join('/') + '/';
        break;
      }
    }
    return { file: file, dir: dir };
  }

  /*
   * حساب المسار النسبي من مجلد المصدر إلى مجلد الهدف.
   * مثال: من 'industries/' إلى ''  → '../'
   *        من 'assets/articles/' إلى 'industries/' → '../../industries/'
   *        من '' إلى ''  → ''
   *        من '' إلى 'industries/'  → 'industries/'
   */
  function relativePath(fromDir, toDir) {
    if (fromDir === toDir) return '';

    var fromParts = fromDir ? fromDir.replace(/\/$/, '').split('/') : [];
    var toParts   = toDir   ? toDir.replace(/\/$/, '').split('/')   : [];

    /* احسب المسار الصاعد من fromDir إلى الجذر المشترك */
    var up = '';
    for (var i = 0; i < fromParts.length; i++) up += '../';

    /* ثم انزل إلى toDir */
    var down = toParts.length ? toParts.join('/') + '/' : '';

    return up + down;
  }

  /* ── fallback مشتق لأي صفحة غير مُدرجة في الخريطة ── */
  function deriveCounterpart(filename) {
    if (/-ar\.html$/i.test(filename)) return filename.replace(/-ar\.html$/i, '-en.html');
    if (/-en\.html$/i.test(filename)) return filename.replace(/-en\.html$/i, '.html');
    if (/\.html$/i.test(filename))    return filename.replace(/\.html$/i, '-en.html');
    return null;
  }

  /* ── API العام ── */
  var LangSwitch = {
    /**
     * يُعيد href نسبياً جاهزاً للاستخدام في خاصية href مباشرةً،
     * مُحسوباً من موقع الصفحة الحالية.
     *
     * يُستخدَم بدلاً من abs() في site-shell.js:
     *   href="' + LangSwitch.resolveHref() + '"
     *
     * @returns {string}
     */
    resolveHref: function () {
      var loc     = parseLocation(window.location.pathname);
      var entry   = Object.prototype.hasOwnProperty.call(MAP, loc.file) ? MAP[loc.file] : null;

      var targetFile = entry ? entry.counterpart : (deriveCounterpart(loc.file) || 'index.html');
      var targetDir  = entry ? entry.dir         : loc.dir;

      /* المسار النسبي من موقع الصفحة الحالية إلى الصفحة الهدف */
      var rel = relativePath(loc.dir, targetDir);
      return rel + targetFile;
    },

    map: MAP
  };

  global.LangSwitch = Object.freeze(LangSwitch);

}(window));

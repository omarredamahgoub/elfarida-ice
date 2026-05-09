/* ================================================================
   site-shell.js — Centralized Header & Footer Renderer
   Single Source of Truth for navigation and footer across all pages.

   Responsibilities:
     1. Auto-detect language from <html lang>.
     2. Auto-detect ROOT path (works at root, /industries/, /assets/articles/).
     3. Render semantic <header> + <footer> into placeholders.
     4. Mark active link via aria-current="page".
     5. Mobile menu: open/close, focus management, Escape, click-outside.
     6. Newsletter submission (Web3Forms) with email validation.
     7. WhatsApp floating widget (balloon, dismiss, scroll trigger, GA event).
     8. Reading-progress bar for article pages.
     9. AOS observer fallback (no external library).

   ICON STRATEGY (v2 — Zero External Dependencies):
     All icons rendered as inline <svg><use href="#icon-*"> via a hidden
     <svg> sprite injected into <body>. No CDN, no Font Awesome, no
     network requests. Fully compatible with Brave Shields, CSP, and
     offline environments.

   SEO-2026 baseline:
     - Semantic <header role="banner"> / <footer role="contentinfo">
     - <nav aria-label> with semantic <ul>/<li>
     - aria-current="page" for active link
     - hreflang link is consistent with current page
     - All interactive elements have accessible names
     - Outbound social links carry rel="noopener noreferrer"
     - WhatsApp widget loaded after main paint to protect LCP

   Public API (window.SiteShell):
     - .config       — resolved config object (frozen)
     - .ready(fn)    — schedule callback after shell is rendered
     - .setActive(href) — manually mark a nav link active
================================================================ */
(function () {
  'use strict';

  /* ---------- 1. Configuration ------------------------------- */
  var CONFIG = Object.freeze({
    brand: {
      ar: { name: '\u0627\u0644\u0641\u0631\u064a\u062f\u0629 \u0622\u064a\u0633', tag: '\u0644\u0644\u062a\u0628\u0631\u064a\u062f \u0648\u0627\u0644\u062a\u062c\u0645\u064a\u062f \u0627\u0644\u0635\u0646\u0627\u0639\u064a' },
      en: { name: 'Elfarida Ice', tag: 'Industrial Refrigeration' }
    },
    logo: {
      header: 'assets/ace-logos/elfaridaice.webp',
      footer: 'assets/ace-logos/logo-elfarida-1.webp',
      altAr: '\u0627\u0644\u0641\u0631\u064a\u062f\u0629 \u0622\u064a\u0633 \u0644\u0644\u062a\u0628\u0631\u064a\u062f \u0627\u0644\u0635\u0646\u0627\u0639\u064a',
      altEn: 'Elfarida Ice Industrial Refrigeration'
    },
    contact: {
      phone: { display: '0598366214', e164: '+966598366214' },
      whatsapp: '966598366214',
      email: 'info@elfaridaice.com'
    },
    locations: {
      ar: [
        { url: 'https://maps.app.goo.gl/4xEzGMmeBQXy9wa3A', label: '\u0627\u0644\u062f\u0645\u0627\u0645\u060c \u062d\u064a \u0627\u0644\u0628\u0627\u062f\u064a\u0629\u060c \u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629' },
        { url: 'https://maps.app.goo.gl/UwLW2S4e4BVHhKfd9', label: '\u0627\u0644\u062f\u0645\u0627\u0645\u060c \u0627\u0644\u062e\u0636\u0631\u064a\u0629\u060c \u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629' },
        { url: 'https://maps.app.goo.gl/CykzikzhA1j5RUgE8', label: '\u0627\u0644\u0631\u064a\u0627\u0636\u060c \u0627\u0644\u0633\u0644\u064a\u060c \u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629' }
      ],
      en: [
        { url: 'https://maps.app.goo.gl/4xEzGMmeBQXy9wa3A', label: 'Dammam, Al-Badiya, Saudi Arabia' },
        { url: 'https://maps.app.goo.gl/UwLW2S4e4BVHhKfd9', label: 'Dammam, Al-Khadriyah, Saudi Arabia' },
        { url: 'https://maps.app.goo.gl/CykzikzhA1j5RUgE8', label: 'Riyadh, As-Sulay, Saudi Arabia' }
      ]
    },
    social: [
      { id: 'facebook',  url: 'https://www.facebook.com/alfaridaice.sa/',      labelAr: '\u0641\u064a\u0633\u0628\u0648\u0643',   labelEn: 'Facebook',  icon: 'facebook'  },
      { id: 'instagram', url: 'https://www.instagram.com/alfaridaice_sa/',     labelAr: '\u0627\u0646\u0633\u062a\u062c\u0631\u0627\u0645', labelEn: 'Instagram', icon: 'instagram'   },
      { id: 'twitter',   url: 'https://x.com/EngMoha64468185',                 labelAr: '\u062a\u0648\u064a\u062a\u0631 X',  labelEn: 'X',         icon: 'x-twitter'   },
      { id: 'tiktok',    url: 'https://www.tiktok.com/@alfaridaice_sa',        labelAr: '\u062a\u064a\u0643 \u062a\u0648\u0643',  labelEn: 'TikTok',    icon: 'tiktok'      },
      { id: 'snapchat',  url: 'https://www.snapchat.com/@alfaridaice_sa',      labelAr: '\u0633\u0646\u0627\u0628 \u0634\u0627\u062a', labelEn: 'Snapchat',  icon: 'snapchat'    },
      { id: 'linkedin',  url: 'https://sa.linkedin.com/company/al-farida-ice', labelAr: '\u0644\u064a\u0646\u0643\u062f \u0625\u0646', labelEn: 'LinkedIn',  icon: 'linkedin-in' }
    ],
    nav: {
      ar: [
        { href: '/',             label: '\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629' },
        { href: 'services.html', label: '\u062e\u062f\u0645\u0627\u062a\u0646\u0627' },
        { href: 'projects.html', label: '\u0645\u0634\u0627\u0631\u064a\u0639\u0646\u0627' },
        { href: 'brands.html',   label: '\u0634\u0631\u0643\u0627\u0624\u0646\u0627' },
        { href: 'about.html',    label: '\u0645\u0646 \u0646\u062d\u0646' },
        { href: 'blog.html',     label: '\u0627\u0644\u0645\u062f\u0648\u0646\u0629' }
      ],
      en: [
        { href: 'index-en.html',    label: 'Home' },
        { href: 'services-en.html', label: 'Services' },
        { href: 'projects-en.html', label: 'Projects' },
        { href: 'brands-en.html',   label: 'Partners' },
        { href: 'about-en.html',    label: 'About' },
        { href: 'blog-en.html',     label: 'Blog' }
      ]
    },
    footerLinks: {
      ar: {
        primary: [
          { href: 'services.html', label: '\u062e\u062f\u0645\u0627\u062a \u0627\u0644\u062a\u0628\u0631\u064a\u062f' },
          { href: 'projects.html', label: '\u0633\u062c\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u064a\u0639' },
          { href: 'brands.html',   label: '\u0634\u0631\u0643\u0627\u0624\u0646\u0627' },
          { href: 'about.html',    label: '\u0645\u0646 \u0646\u062d\u0646' },
          { href: 'blog.html',     label: '\u0627\u0644\u0645\u062f\u0648\u0646\u0629' },
          { href: 'contact.html',  label: '\u0627\u0637\u0644\u0628 \u0627\u0633\u062a\u0634\u0627\u0631\u0629' }
        ],
        secondary: [
          { href: 'cold-room-calculator.html', label: '\u062d\u0627\u0633\u0628\u0629 \u0627\u0644\u062a\u0628\u0631\u064a\u062f \u0627\u0644\u0645\u062c\u0627\u0646\u064a\u0629' },
          { href: 'faq.html',                  label: '\u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0634\u0627\u0626\u0639\u0629' },
          { href: 'glossary.html',             label: '\u0642\u0627\u0645\u0648\u0633 \u0645\u0635\u0637\u0644\u062d\u0627\u062a \u0627\u0644\u062a\u0628\u0631\u064a\u062f' },
          { href: 'industries.html',           label: '\u0627\u0644\u0642\u0637\u0627\u0639\u0627\u062a \u0627\u0644\u0635\u0646\u0627\u0639\u064a\u0629' },
          { href: 'services-technical.html',   label: '\u0627\u0644\u0645\u0648\u0627\u0635\u0641\u0627\u062a \u0627\u0644\u062a\u0642\u0646\u064a\u0629' },
          { href: 'company-profile.html',      label: '\u0628\u0631\u0648\u0641\u0627\u064a\u0644 \u0627\u0644\u0634\u0631\u0643\u0629' },
          { href: 'privacy.html',              label: '\u0633\u064a\u0627\u0633\u0629 \u0627\u0644\u062e\u0635\u0648\u0635\u064a\u0629' },
          { href: 'terms.html',                label: '\u0627\u0644\u0634\u0631\u0648\u0637 \u0648\u0627\u0644\u0623\u062d\u0643\u0627\u0645' }
        ]
      },
      en: {
        primary: [
          { href: 'services-en.html', label: 'Refrigeration Services' },
          { href: 'projects-en.html', label: 'Projects Portfolio' },
          { href: 'brands-en.html',   label: 'Partners' },
          { href: 'about-en.html',    label: 'About Us' },
          { href: 'blog-en.html',     label: 'Blog' },
          { href: 'contact-en.html',  label: 'Request Consultation' }
        ],
        secondary: [
          { href: 'cold-room-calculator-en.html', label: 'Free Cold Room Calculator' },
          { href: 'faq-en.html',                  label: 'FAQ' },
          { href: 'glossary-en.html',             label: 'Refrigeration Glossary' },
          { href: 'industries-en.html',           label: 'Industry Sectors' },
          { href: 'services-technical-en.html',   label: 'Technical Specifications' },
          { href: 'company-profile-en.html',      label: 'Company Profile' },
          { href: 'privacy-en.html',              label: 'Privacy Policy' },
          { href: 'terms-en.html',                label: 'Terms & Conditions' }
        ]
      }
    },
    cta: {
      ar: { label: '\u0644\u0637\u0644\u0628 \u0639\u0631\u0636 \u0633\u0639\u0631', href: 'contact.html' },
      en: { label: 'Request a Quote', href: 'contact-en.html' }
    },
    langSwitch: {
      ar: { label: 'EN', target: 'index-en.html', aria: 'English version' },
      en: { label: 'AR', target: '/',             aria: '\u0627\u0644\u0646\u0633\u062e\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629' }
    },
    newsletter: {
      accessKey: '770521ce-1959-4e16-9147-597d9e5bf3e8',
      endpoint: 'https://api.web3forms.com/submit',
      ar: {
        heading: '\u0627\u0644\u0646\u0634\u0631\u0629 \u0627\u0644\u0628\u0631\u064a\u062f\u064a\u0629',
        intro: '\u0627\u0634\u062a\u0631\u0643 \u0644\u064a\u0635\u0644\u0643 \u062c\u062f\u064a\u062f \u0645\u0634\u0627\u0631\u064a\u0639\u0646\u0627 \u0648\u0639\u0631\u0648\u0636\u0646\u0627.',
        placeholder: '\u0628\u0631\u064a\u062f\u0643 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a',
        submit: '\u0627\u0634\u062a\u0631\u0643 \u0627\u0644\u0622\u0646',
        loading: '\u062c\u0627\u0631\u064a \u0627\u0644\u0625\u0631\u0633\u0627\u0644...',
        success: '\u2705 \u062a\u0645 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643 \u0628\u0646\u062c\u0627\u062d!',
        error: '\u274c \u062d\u062f\u062b \u062e\u0637\u0623\u060c \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649',
        invalid: '\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0628\u0631\u064a\u062f \u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a \u0635\u062d\u064a\u062d',
        subject: '\u0627\u0634\u062a\u0631\u0627\u0643 \u0641\u064a \u0627\u0644\u0646\u0634\u0631\u0629 \u0627\u0644\u0628\u0631\u064a\u062f\u064a\u0629 - \u0627\u0644\u0641\u0631\u064a\u062f\u0629 \u0622\u064a\u0633'
      },
      en: {
        heading: 'Newsletter',
        intro: 'Subscribe to receive our latest projects and offers.',
        placeholder: 'Your email',
        submit: 'Subscribe now',
        loading: 'Sending...',
        success: '\u2705 Subscribed successfully!',
        error: '\u274c An error occurred, please try again',
        invalid: 'Please enter a valid email',
        subject: 'Newsletter subscription - Elfarida Ice'
      }
    },
    whatsapp: {
      ar: {
        title: '\u0647\u0644 \u0645\u0634\u0631\u0648\u0639\u0643 \u064a\u062d\u062a\u0627\u062c \u062a\u0628\u0631\u064a\u062f\u061f \u2744\ufe0f',
        text: '\u0627\u062d\u0635\u0644 \u0639\u0644\u0649 \u0627\u0633\u062a\u0634\u0627\u0631\u0629 \u0645\u062c\u0627\u0646\u064a\u0629 \u0627\u0644\u0622\u0646 \u2014 \u0646\u0631\u062f \u062e\u0644\u0627\u0644 \u062f\u0642\u0627\u0626\u0642',
        aria: '\u062a\u0648\u0627\u0635\u0644 \u0645\u0639\u0646\u0627 \u0639\u0644\u0649 \u0648\u0627\u062a\u0633\u0627\u0628 \u2014 \u0627\u0633\u062a\u0634\u0627\u0631\u0629 \u0645\u062c\u0627\u0646\u064a\u0629',
        close: '\u0625\u063a\u0644\u0627\u0642',
        message: '\u0645\u0631\u062d\u0628\u0627\u064b\u060c \u0623\u0631\u064a\u062f \u0627\u0633\u062a\u0634\u0627\u0631\u0629 \u0645\u062c\u0627\u0646\u064a\u0629 \u062d\u0648\u0644 \u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u062a\u0628\u0631\u064a\u062f'
      },
      en: {
        title: 'Need a refrigeration quote? \u2744\ufe0f',
        text: 'Chat with our engineers \u2014 we reply in minutes',
        aria: 'Chat with us on WhatsApp \u2014 Free consultation',
        close: 'Close',
        message: 'Hello, I would like a free consultation for my refrigeration project'
      }
    },
    copyright: {
      ar: { html: '\u00a9 2026 \u0627\u0644\u0641\u0631\u064a\u062f\u0629 \u0622\u064a\u0633 \u0644\u0644\u0647\u0646\u062f\u0633\u0629 \u0648\u0627\u0644\u062a\u0628\u0631\u064a\u062f \u0627\u0644\u0635\u0646\u0627\u0639\u064a \u2014 \u062c\u0645\u064a\u0639 \u0627\u0644\u062d\u0642\u0648\u0642 \u0645\u062d\u0641\u0648\u0638\u0629', linkAr: 'digital-portfolio.html' },
      en: { html: '\u00a9 2026 Elfarida Ice \u2014 Engineering & Industrial Refrigeration. All rights reserved.', linkAr: 'digital-portfolio.html' }
    },
    brandDesc: {
      ar: '\u0627\u0644\u0641\u0631\u064a\u062f\u0629 \u0622\u064a\u0633.. \u0646\u0628\u062a\u0643\u0631 \u062d\u0644\u0648\u0644 \u0627\u0644\u062a\u0628\u0631\u064a\u062f \u0627\u0644\u0647\u0646\u062f\u0633\u064a \u0644\u062d\u0645\u0627\u064a\u0629 \u0627\u0633\u062a\u062b\u0645\u0627\u0631\u0627\u062a\u0643\u0645 \u0641\u064a \u0643\u0627\u0641\u0629 \u0623\u0646\u062d\u0627\u0621 \u0627\u0644\u0645\u0645\u0644\u0643\u0629.',
      en: 'Elfarida Ice innovates refrigeration engineering solutions to protect your investments across the Kingdom.'
    },
    headings: {
      ar: { primary: '\u0631\u0648\u0627\u0628\u0637 \u0647\u0627\u0645\u0629', secondary: '\u0645\u0648\u0627\u0631\u062f \u0648\u0623\u062f\u0648\u0627\u062a', contact: '\u062a\u0648\u0627\u0635\u0644 \u0645\u0639\u0646\u0627', siteLinks: '\u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u0645\u0648\u0642\u0639' },
      en: { primary: 'Important Links', secondary: 'Resources & Tools', contact: 'Contact Us', siteLinks: 'Site Links' }
    },
    skip: {
      ar: '\u062a\u062e\u0637\u064a \u0625\u0644\u0649 \u0627\u0644\u0645\u062d\u062a\u0648\u0649 \u0627\u0644\u0631\u0626\u064a\u0633\u064a',
      en: 'Skip to main content'
    },
    menu: {
      ar: { open: '\u0641\u062a\u062d \u0627\u0644\u0642\u0627\u0626\u0645\u0629', close: '\u0625\u063a\u0644\u0627\u0642 \u0627\u0644\u0642\u0627\u0626\u0645\u0629', label: '\u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629' },
      en: { open: 'Open menu',   close: 'Close menu',   label: 'Main navigation' }
    }
  });

  /* ---------- 2. SVG Icon Sprite (Zero External Dependencies) --- */
  var SVG_SPRITE = [
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">',

    '<symbol id="icon-facebook" viewBox="0 0 512 512">',
    '<path fill="currentColor" d="M512 256C512 114.6 397.4 0 256 0S0 114.6 0 256c0 127.8 93.6 233.8 216 253V330h-65v-74h65v-56c0-64 38-99 96-99 28 0 57 5 57 5v63h-32c-32 0-42 20-42 40v48h71l-11 74h-60v179C418.4 489.8 512 383.8 512 256z"/>',
    '</symbol>',

    '<symbol id="icon-instagram" viewBox="0 0 448 512">',
    '<path fill="currentColor" d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z"/>',
    '</symbol>',

    '<symbol id="icon-x-twitter" viewBox="0 0 512 512">',
    '<path fill="currentColor" d="M389.2 48h70.6L305.6 224.2 487 464H345L233.7 318.6 106.5 464H35.8l164.9-188.5L26.8 48h145.6l100.5 132.9zm-24.8 373.8h39.1L151.1 88h-42z"/>',
    '</symbol>',

    '<symbol id="icon-tiktok" viewBox="0 0 448 512">',
    '<path fill="currentColor" d="M448 209.9a210.1 210.1 0 0 1-122.8-39.3v178.8A162.6 162.6 0 1 1 185 188.3v89.1a74.6 74.6 0 1 0 52.2 71.2V0h88a121.2 121.2 0 0 0 1.9 22.2A122.2 122.2 0 0 0 381 128.4a121.4 121.4 0 0 0 67 20.1z"/>',
    '</symbol>',

    '<symbol id="icon-snapchat" viewBox="0 0 24 24">',
    '<path fill="currentColor" d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.024.358-.033.53.45.075.87-.206 1.347-.206.106 0 1.518.369 1.518 1.055 0 .801-.768 1.1-1.372 1.325-.114.044-.228.086-.327.132-.72.335-1.17.935-1.17 1.945.572.01 1.174-.08 1.805.084.595.155 1.008.65 1.008 1.261 0 .545-.34.99-.81 1.253-.264.146-.587.226-.917.226-.243 0-.476-.05-.697-.143-.427-.178-.82-.444-1.277-.608-.48-.173-1.015-.275-1.608-.275-.417 0-.836.054-1.25.196-.546.187-1.017.522-1.574.882-.534.342-1.17.72-2.004.72-.834 0-1.47-.378-2.005-.72-.557-.36-1.028-.695-1.574-.882-.414-.142-.833-.196-1.25-.196-.593 0-1.129.102-1.608.275-.457.164-.85.43-1.277.608-.221.092-.454.143-.697.143-.33 0-.653-.08-.917-.226-.47-.263-.81-.708-.81-1.253 0-.61.413-1.106 1.008-1.261.631-.164 1.233-.074 1.805-.084 0-1.01-.45-1.61-1.17-1.945-.099-.046-.213-.088-.327-.132C3.768 10.54 3 10.24 3 9.44c0-.687.949-1.055 1.518-1.055.477 0 .897.28 1.347.206l-.033-.53-.003-.06C5.725 6.39 5.599 4.364 6.128 3.17 7.7 1.092 11.216.793 12.206.793z"/>',
    '</symbol>',

    '<symbol id="icon-linkedin-in" viewBox="0 0 448 512">',
    '<path fill="currentColor" d="M100.28 448H7.4V148.9h92.88zm-46.44-340a53.79 53.79 0 1 1 53.79-53.79A53.79 53.79 0 0 1 53.84 108zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z"/>',
    '</symbol>',

    '<symbol id="icon-map-marker-alt" viewBox="0 0 384 512">',
    '<path fill="currentColor" d="M172.268 501.67C26.97 291.031 0 269.413 0 192 0 85.961 85.961 0 192 0s192 85.961 192 192c0 77.413-26.97 99.031-172.268 309.67-9.535 13.774-29.93 13.773-39.464 0zM192 272c44.183 0 80-35.817 80-80s-35.817-80-80-80-80 35.817-80 80 35.817 80 80 80z"/>',
    '</symbol>',

    '<symbol id="icon-phone-alt" viewBox="0 0 512 512">',
    '<path fill="currentColor" d="M497.39 361.8l-112-48a24 24 0 0 0-28 6.9l-49.6 60.6A370.66 370.66 0 0 1 130.6 204.11l60.6-49.6a23.94 23.94 0 0 0 6.9-28l-48-112A24.16 24.16 0 0 0 122.6.61l-104 24A24 24 0 0 0 0 48c0 256.5 207.9 464 464 464a24 24 0 0 0 23.4-18.6l24-104a24.29 24.29 0 0 0-14.01-27.6z"/>',
    '</symbol>',

    '<symbol id="icon-envelope" viewBox="0 0 512 512">',
    '<path fill="currentColor" d="M502.3 190.8c3.9-3.1 9.7-.2 9.7 4.7V400c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V195.6c0-5 5.7-7.8 9.7-4.7 22.4 17.4 52.1 39.5 154.1 113.6 21.1 15.4 56.7 47.8 92.2 47.6 35.7.3 72-32.8 92.3-47.6 102-74.1 131.6-96.3 154-113.7zM256 320c23.2.4 56.6-29.2 73.4-41.4 132.7-96.3 142.8-104.7 173.4-128.7 5.8-4.5 9.2-11.5 9.2-18.9v-19c0-26.5-21.5-48-48-48H48C21.5 64 0 85.5 0 112v19c0 7.4 3.4 14.3 9.2 18.9 30.6 23.9 40.7 32.4 173.4 128.7 16.8 12.2 50.2 41.8 73.4 41.4z"/>',
    '</symbol>',

    '<symbol id="icon-bars" viewBox="0 0 448 512">',
    '<path fill="currentColor" d="M16 132h416c8.837 0 16-7.163 16-16V76c0-8.837-7.163-16-16-16H16C7.163 60 0 67.163 0 76v40c0 8.837 7.163 16 16 16zm0 160h416c8.837 0 16-7.163 16-16v-40c0-8.837-7.163-16-16-16H16c-8.837 0-16 7.163-16 16v40c0 8.837 7.163 16 16 16zm0 160h416c8.837 0 16-7.163 16-16v-40c0-8.837-7.163-16-16-16H16c-8.837 0-16 7.163-16 16v40c0 8.837 7.163 16 16 16z"/>',
    '</symbol>',

    '<symbol id="icon-times" viewBox="0 0 352 512">',
    '<path fill="currentColor" d="M242.72 256l100.07-100.07c12.28-12.28 12.28-32.19 0-44.48l-22.24-22.24c-12.28-12.28-32.19-12.28-44.48 0L176 189.28 75.93 89.21c-12.28-12.28-32.19-12.28-44.48 0L9.21 111.45c-12.28 12.28-12.28 32.19 0 44.48L109.28 256 9.21 356.07c-12.28 12.28-12.28 32.19 0 44.48l22.24 22.24c12.28 12.28 32.2 12.28 44.48 0L176 322.72l100.07 100.07c12.28 12.28 32.2 12.28 44.48 0l22.24-22.24c12.28-12.28 12.28-32.19 0-44.48L242.72 256z"/>',
    '</symbol>',

    '</svg>'
  ].join('');

  /* Helper: render an inline SVG icon <use> reference */
  function icon(id, cls) {
    var c = cls ? ' class="' + cls + '"' : '';
    return '<svg' + c + ' aria-hidden="true" focusable="false" width="1em" height="1em">' +
             '<use href="#icon-' + id + '"></use>' +
           '</svg>';
  }

  /* ---------- 3. Utilities ------------------------------------ */
  var doc = document;
  var html = doc.documentElement;
  var LANG = (html.getAttribute('lang') || 'ar').toLowerCase().indexOf('en') === 0 ? 'en' : 'ar';

  var ROOT_DIRS = [
    'industries', 'assets', 'css', 'js', 'lib', 'src', 'scripts',
    'partials', 'e2e', 'node_modules', '.github', '.well-known'
  ];

  function computeRoot() {
    var proto = window.location.protocol;
    var path  = window.location.pathname.replace(/\\/g, '/');

    if (proto === 'file:') {
      var parts = path.split('/');
      var rootIdx = -1;
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].toLowerCase().indexOf('elfarida') !== -1) {
          rootIdx = i;
          break;
        }
      }
      var depth = rootIdx === -1 ? 0 : parts.length - rootIdx - 2;
      if (depth < 0) depth = 0;
      return repeat('../', depth);
    }

    var segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return '';
    if (path.charAt(path.length - 1) === '/') return repeat('../', segments.length);
    return repeat('../', segments.length - 1);
  }

  function repeat(s, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += s;
    return out;
  }
  var ROOT = computeRoot();

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function abs(href) {
    if (!href) return '#';
    if (/^(https?:|mailto:|tel:|#|\/\/)/i.test(href)) return href;
    if (href.charAt(0) === '/') return href;
    return ROOT + href;
  }

  function currentFile() {
    var pathname = window.location.pathname.replace(/\\/g, '/');
    var parts    = pathname.split('/');
    var last     = parts[parts.length - 1] || '';
    if (!last || last === '' || last === 'index.html') return '/';
    last = last.toLowerCase();
    if (last.indexOf('.') === -1) last += '.html';
    return last;
  }

  function isActive(href) {
    var current = currentFile();
    var target  = String(href || '').toLowerCase();
    if (target === '/') return current === '/';
    target = target.replace(/^\.?\//, '');
    if (target.indexOf('.') === -1 && target !== '') target += '.html';
    return current === target;
  }

  /* ---------- 4. Renderers ------------------------------------ */
  function renderHeader() {
    var t = CONFIG.brand[LANG];
    var navItems = CONFIG.nav[LANG];
    var cta = CONFIG.cta[LANG];
    var lang = (function () {
      var base     = CONFIG.langSwitch[LANG];
      var resolved = (typeof window.LangSwitch !== 'undefined')
        ? window.LangSwitch.resolveHref()
        : null;
      return {
        label:    base.label,
        href:     resolved !== null ? resolved : abs(base.target),
        aria:     base.aria
      };
    }());
    var menu = CONFIG.menu[LANG];

    var desktopLinks = navItems.map(function (item) {
      var active = isActive(item.href);
      return (
        '<li>' +
          '<a class="site-header__link"' +
            (active ? ' aria-current="page"' : '') +
            ' href="' + abs(item.href) + '">' +
            escapeHtml(item.label) +
          '</a>' +
        '</li>'
      );
    }).join('');

    var mobileLinks = navItems.map(function (item) {
      var active = isActive(item.href);
      return (
        '<li>' +
          '<a class="site-header__mobile-link"' +
            (active ? ' aria-current="page"' : '') +
            ' href="' + abs(item.href) + '">' +
            escapeHtml(item.label) +
          '</a>' +
        '</li>'
      );
    }).join('');

    return (
      '<header class="site-header" role="banner">' +
        '<div class="site-header__inner">' +
          '<a class="site-header__brand" href="' + abs(navItems[0].href) + '"' +
            ' aria-label="' + escapeHtml(t.name) + '">' +
            '<img class="site-header__logo"' +
              ' src="' + abs(CONFIG.logo.header) + '"' +
              ' alt="' + escapeHtml(LANG === 'ar' ? CONFIG.logo.altAr : CONFIG.logo.altEn) + '"' +
              ' width="80" height="80" loading="eager" decoding="async" fetchpriority="high">' +
            '<span class="site-header__brand-text">' +
              '<span class="site-header__brand-name">' + escapeHtml(t.name) + '</span>' +
              '<span class="site-header__brand-tag">' + escapeHtml(t.tag) + '</span>' +
            '</span>' +
          '</a>' +
          '<nav class="site-header__nav" aria-label="' + escapeHtml(menu.label) + '">' +
            '<ul class="site-header__nav-list">' + desktopLinks + '</ul>' +
            '<a class="site-header__cta" href="' + abs(cta.href) + '">' + escapeHtml(cta.label) + '</a>' +
            '<a class="site-header__lang" href="' + lang.href + '"' +
              ' aria-label="' + escapeHtml(lang.aria) + '" hreflang="' + (LANG === 'ar' ? 'en' : 'ar') + '">' +
              escapeHtml(lang.label) +
            '</a>' +
          '</nav>' +
          '<button type="button" class="site-header__toggle" id="site-mobile-menu-btn"' +
            ' aria-label="' + escapeHtml(menu.open) + '"' +
            ' aria-expanded="false"' +
            ' aria-controls="site-mobile-menu">' +
            icon('bars', 'site-header__toggle-icon') +
          '</button>' +
        '</div>' +
        '<div class="site-header__mobile" id="site-mobile-menu" data-open="false">' +
          '<ul class="site-header__mobile-list">' + mobileLinks + '</ul>' +
          '<a class="site-header__mobile-cta" href="' + abs(cta.href) + '">' + escapeHtml(cta.label) + '</a>' +
          '<a class="site-header__mobile-lang" href="' + lang.href + '"' +
            ' aria-label="' + escapeHtml(lang.aria) + '" hreflang="' + (LANG === 'ar' ? 'en' : 'ar') + '">' +
            escapeHtml(lang.label) +
          '</a>' +
        '</div>' +
      '</header>'
    );
  }

  function renderFooter() {
    var fl = CONFIG.footerLinks[LANG];
    var hd = CONFIG.headings[LANG];
    var locs = CONFIG.locations[LANG];
    var nl = CONFIG.newsletter[LANG];
    var cp = CONFIG.copyright[LANG];
    var alt = LANG === 'ar' ? CONFIG.logo.altAr : CONFIG.logo.altEn;

    var primary = fl.primary.map(function (i) {
      var active = isActive(i.href);
      return '<li><a class="site-footer__link"' +
        (active ? ' aria-current="page"' : '') +
        ' href="' + abs(i.href) + '">' + escapeHtml(i.label) + '</a></li>';
    }).join('');
    var secondary = fl.secondary.map(function (i) {
      var active = isActive(i.href);
      return '<li><a class="site-footer__link"' +
        (active ? ' aria-current="page"' : '') +
        ' href="' + abs(i.href) + '">' + escapeHtml(i.label) + '</a></li>';
    }).join('');

    var locItems = locs.map(function (l) {
      return (
        '<a class="site-footer__contact-item" href="' + l.url + '" target="_blank" rel="noopener noreferrer">' +
          icon('map-marker-alt', 'site-footer__contact-icon') +
          '<span>' + escapeHtml(l.label) + '</span>' +
        '</a>'
      );
    }).join('');

    var social = CONFIG.social.map(function (s) {
      var label = LANG === 'ar' ? s.labelAr : s.labelEn;
      return (
        '<a class="site-footer__social-link" href="' + s.url + '" target="_blank" rel="noopener noreferrer"' +
          ' aria-label="' + escapeHtml(label) + '">' +
          icon(s.icon) +
        '</a>'
      );
    }).join('');

    var copyrightHtml = cp.linkAr
      ? '<a href="' + abs(cp.linkAr) + '">' + escapeHtml(cp.html) + '</a>'
      : escapeHtml(cp.html);

    return (
      '<footer class="site-footer" role="contentinfo">' +
        '<div class="site-footer__inner">' +

          '<div class="site-footer__column">' +
            '<img class="site-footer__brand-logo"' +
              ' src="' + abs(CONFIG.logo.footer) + '"' +
              ' alt="' + escapeHtml(alt) + '"' +
              ' width="200" height="128" loading="lazy" decoding="async">' +
            '<p class="site-footer__brand-desc">' + escapeHtml(CONFIG.brandDesc[LANG]) + '</p>' +
          '</div>' +

          '<nav class="site-footer__column" aria-label="' + escapeHtml(hd.siteLinks) + '">' +
            '<h2 class="site-footer__heading">' + escapeHtml(hd.primary) + '</h2>' +
            '<ul class="site-footer__list">' + primary + '</ul>' +
            '<h3 class="site-footer__heading site-footer__heading--sub">' + escapeHtml(hd.secondary) + '</h3>' +
            '<ul class="site-footer__list">' + secondary + '</ul>' +
          '</nav>' +

          '<div class="site-footer__column">' +
            '<h2 class="site-footer__heading">' + escapeHtml(hd.contact) + '</h2>' +
            '<address class="site-footer__contact" style="font-style:normal;">' +
              '<a class="site-footer__contact-item" href="tel:' + CONFIG.contact.phone.e164 + '">' +
                icon('phone-alt', 'site-footer__contact-icon') +
                '<span>' + escapeHtml(CONFIG.contact.phone.display) + '</span>' +
              '</a>' +
              '<a class="site-footer__contact-item" href="mailto:' + CONFIG.contact.email + '">' +
                icon('envelope', 'site-footer__contact-icon') +
                '<span>' + escapeHtml(CONFIG.contact.email) + '</span>' +
              '</a>' +
              locItems +
            '</address>' +
            '<div class="site-footer__social">' + social + '</div>' +
          '</div>' +

          '<div class="site-footer__column">' +
            '<h2 class="site-footer__heading">' + escapeHtml(nl.heading) + '</h2>' +
            '<p class="site-footer__brand-desc">' + escapeHtml(nl.intro) + '</p>' +
            '<form class="site-footer__newsletter" id="footer-newsletter-form" method="POST" novalidate data-endpoint="' + CONFIG.newsletter.endpoint + '">' +
              '<input type="hidden" name="access_key" value="' + CONFIG.newsletter.accessKey + '">' +
              '<input type="hidden" name="subject"    value="' + escapeHtml(nl.subject) + '">' +
              '<input type="hidden" name="from_name"  value="elfaridaice.com">' +
              '<label class="sr-only" for="footer-email-input">' + escapeHtml(nl.placeholder) + '</label>' +
              '<input class="site-footer__newsletter-input" id="footer-email-input" type="email" name="Email"' +
                ' placeholder="' + escapeHtml(nl.placeholder) + '" required dir="ltr" autocomplete="email" inputmode="email">' +
              '<p class="site-footer__newsletter-error" id="footer-email-error" hidden>' + escapeHtml(nl.invalid) + '</p>' +
              '<input class="site-footer__honeypot" type="checkbox" name="botcheck" tabindex="-1" autocomplete="off" aria-hidden="true">' +
              '<button class="site-footer__newsletter-button" id="footer-newsletter-btn" type="submit">' + escapeHtml(nl.submit) + '</button>' +
              '<div class="site-footer__newsletter-success" id="footer-success" hidden>' + escapeHtml(nl.success) + '</div>' +
              '<div class="site-footer__newsletter-error"   id="footer-error"   hidden>' + escapeHtml(nl.error) + '</div>' +
            '</form>' +
          '</div>' +

        '</div>' +
        '<div class="site-footer__copyright">' + copyrightHtml + '</div>' +
      '</footer>'
    );
  }

  /* ---------- 5. SVG Sprite injection ------------------------- */
  function injectSvgSprite() {
    if (doc.getElementById('shell-svg-sprite')) return;
    var container = doc.createElement('div');
    container.id = 'shell-svg-sprite';
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    container.innerHTML = SVG_SPRITE;
    doc.body.insertBefore(container, doc.body.firstChild);
  }

  /* ---------- 6. Skip link --------------------------------------- */
  function ensureSkipLink() {
    if (doc.querySelector('.shell-skiplink')) return;
    var a = doc.createElement('a');
    a.className = 'shell-skiplink';
    a.href = '#main-content';
    a.textContent = CONFIG.skip[LANG];
    doc.body.insertBefore(a, doc.body.firstChild);
  }

  /* ---------- 7. Mobile menu interactions ----------------------- */
  function bindMobileMenu() {
    var btn = doc.getElementById('site-mobile-menu-btn');
    var menu = doc.getElementById('site-mobile-menu');
    if (!btn || !menu) return;

    var menuLabels = CONFIG.menu[LANG];

    function setOpen(open) {
      menu.setAttribute('data-open', open ? 'true' : 'false');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? menuLabels.close : menuLabels.open);
      var iconEl = btn.querySelector('svg use');
      if (iconEl) {
        iconEl.setAttribute('href', open ? '#icon-times' : '#icon-bars');
      }
      if (open) {
        var first = menu.querySelector('a');
        if (first) first.focus({ preventScroll: true });
      }
    }

    btn.addEventListener('click', function () {
      setOpen(menu.getAttribute('data-open') !== 'true');
    });

    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.getAttribute('data-open') === 'true') {
        setOpen(false);
        btn.focus({ preventScroll: true });
      }
    });

    doc.addEventListener('click', function (e) {
      if (menu.getAttribute('data-open') !== 'true') return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      setOpen(false);
    });
  }

  /* ---------- 8. Newsletter ------------------------------------- */
  function bindNewsletter() {
    var form    = doc.getElementById('footer-newsletter-form');
    var input   = doc.getElementById('footer-email-input');
    var btn     = doc.getElementById('footer-newsletter-btn');
    var errInl  = doc.getElementById('footer-email-error');
    var ok      = doc.getElementById('footer-success');
    var err     = doc.getElementById('footer-error');
    if (!form || !input || !btn) return;

    var L = CONFIG.newsletter[LANG];
    var labelSubmit = L.submit;
    var EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

    input.addEventListener('input', function () {
      this.value = this.value.replace(/[^\x00-\x7F]/g, '');
    });
    input.addEventListener('blur', function () {
      var v = this.value.trim();
      var bad = v && !EMAIL_RE.test(v);
      errInl.hidden = !bad;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!EMAIL_RE.test(v)) { errInl.hidden = false; input.focus(); return; }
      errInl.hidden = true;
      ok.hidden = true;
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = L.loading;

      var data = {};
      new FormData(form).forEach(function (val, key) { data[key] = val; });

      fetch(CONFIG.newsletter.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r && r.success) { ok.hidden = false; form.reset(); }
          else { err.hidden = false; }
        })
        .catch(function () {
          /* Brave Shields / ad-blocker / network failure — graceful mailto fallback */
          var subject = encodeURIComponent(L.subject);
          var body = encodeURIComponent('Email: ' + v);
          var mailto = 'mailto:' + CONFIG.contact.email + '?subject=' + subject + '&body=' + body;
          try { window.location.href = mailto; ok.hidden = false; form.reset(); }
          catch (_) { err.hidden = false; }
        })
        .finally(function () { btn.disabled = false; btn.textContent = labelSubmit; });
    });
  }

  /* ---------- 9. WhatsApp widget -------------------------------- */
  var WA_STORAGE_KEY = 'wa_balloon_dismissed';
  var WA_SCROLL_THRESHOLD = 300;

  function injectWhatsApp() {
    if (doc.getElementById('wa-widget')) return;

    var cfg = CONFIG.whatsapp[LANG];
    var phone = CONFIG.contact.whatsapp;
    var encodedMsg = encodeURIComponent(cfg.message);
    var waUrl = 'https://wa.me/' + phone + '?text=' + encodedMsg;

    var dismissed = false;
    try { dismissed = !!sessionStorage.getItem(WA_STORAGE_KEY); } catch (_) {}

    var widget = doc.createElement('div');
    widget.id = 'wa-widget';
    widget.setAttribute('role', 'complementary');
    widget.setAttribute('aria-label', cfg.aria);
    widget.innerHTML =
      '<div id="wa-balloon" class="wa-balloon" aria-live="polite" hidden>' +
        '<button type="button" class="wa-balloon__close" id="wa-balloon-close" aria-label="' + escapeHtml(cfg.close) + '">' +
          icon('times') +
        '</button>' +
        '<p class="wa-balloon__title">' + escapeHtml(cfg.title) + '</p>' +
        '<p class="wa-balloon__text">' + escapeHtml(cfg.text) + '</p>' +
      '</div>' +
      '<a id="wa-fab" class="wa-fab" href="' + waUrl + '" target="_blank" rel="noopener noreferrer"' +
        ' aria-label="' + escapeHtml(cfg.aria) + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" aria-hidden="true" focusable="false" width="28" height="28">' +
          '<path fill="currentColor" d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222' +
            ' 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1' +
            'c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67-157zm-157 341.6' +
            'c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7' +
            'c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5' +
            ' 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5' +
            ' 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18' +
            '-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4' +
            '-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7' +
            '-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2' +
            '-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4' +
            ' 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4' +
            ' 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/>' +
        '</svg>' +
        '<span class="wa-fab__badge" aria-hidden="true">5</span>' +
      '</a>';

    doc.body.appendChild(widget);
    bindWhatsApp(dismissed);
  }

  function bindWhatsApp(startDismissed) {
    var balloon  = doc.getElementById('wa-balloon');
    var closeBtn = doc.getElementById('wa-balloon-close');
    var fab      = doc.getElementById('wa-fab');
    if (!balloon || !closeBtn || !fab) return;

    var shown     = false;
    var dismissed = !!startDismissed;

    function showBalloon() {
      if (dismissed || shown) return;
      shown = true;
      balloon.hidden = false;
      balloon.classList.add('wa-balloon--visible');
    }

    function hideBalloon(persist) {
      shown = false;
      balloon.classList.remove('wa-balloon--visible');
      balloon.hidden = true;
      if (persist) {
        dismissed = true;
        try { sessionStorage.setItem(WA_STORAGE_KEY, '1'); } catch (_) {}
      }
    }

    closeBtn.addEventListener('click', function () { hideBalloon(true); });

    fab.addEventListener('click', function () {
      hideBalloon(false);
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'whatsapp_click', { event_category: 'engagement', event_label: 'wa_fab' });
      }
    });

    var scrolled = false;
    window.addEventListener('scroll', function () {
      if (scrolled || dismissed) return;
      if (window.scrollY >= WA_SCROLL_THRESHOLD) {
        scrolled = true;
        setTimeout(showBalloon, 800);
      }
    }, { passive: true });

    setTimeout(function () {
      if (!dismissed && !shown) showBalloon();
    }, 6000);
  }

  /* ---------- 10. Reading-progress bar (article pages) ---------- */
  function bindReadingProgress() {
    var bar = doc.getElementById('readingProgress');
    if (!bar) return;
    window.addEventListener('scroll', function () {
      var scrolled = window.scrollY;
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (max > 0 ? (scrolled / max) * 100 : 0) + '%';
    }, { passive: true });
  }

  /* ---------- 11. AOS observer fallback ------------------------- */
  function bindAOS() {
    if (typeof window.AOS === 'object' && typeof window.AOS.init === 'function') return;
    window.AOS = { init: function () {} };
    var nodes = doc.querySelectorAll('[data-aos]');
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('aos-animate'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var delay = parseInt(el.getAttribute('data-aos-delay') || '0', 10);
        setTimeout(function () { el.classList.add('aos-animate'); }, delay);
        io.unobserve(el);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ---------- 12. Mount ---------------------------------------- */
  var readyQueue = [];

  function findOrCreate(id) {
    var el = doc.getElementById(id);
    if (el) return el;
    el = doc.createElement('div');
    el.id = id;
    if (id === 'site-header') {
      doc.body.insertBefore(el, doc.body.firstChild);
    } else {
      doc.body.appendChild(el);
    }
    return el;
  }

  function mount() {
    if (!doc.body) {
      doc.addEventListener('DOMContentLoaded', mount, { once: true });
      return;
    }

    injectSvgSprite();
    ensureSkipLink();

    var headerHost = findOrCreate('site-header');
    headerHost.outerHTML = renderHeader().replace('class="site-header"', 'class="site-header" id="site-header"');

    var footerHost = findOrCreate('site-footer');
    footerHost.outerHTML = renderFooter().replace('class="site-footer"', 'class="site-footer" id="site-footer"');

    bindMobileMenu();
    bindNewsletter();
    bindReadingProgress();
    bindAOS();

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(injectWhatsApp, { timeout: 1500 });
    } else {
      setTimeout(injectWhatsApp, 1200);
    }

    readyQueue.forEach(function (fn) { try { fn(window.SiteShell); } catch (_) {} });
    readyQueue.length = 0;
  }

  /* ---------- 13. Public API ----------------------------------- */
  window.SiteShell = Object.freeze({
    config: CONFIG,
    lang: LANG,
    root: ROOT,
    ready: function (fn) {
      if (typeof fn !== 'function') return;
      readyQueue.push(fn);
    },
    setActive: function (href) {
      if (!href) return;
      var sel = '.site-header__link, .site-header__mobile-link, .site-footer__link';
      doc.querySelectorAll(sel).forEach(function (a) {
        if (a.getAttribute('href') && a.getAttribute('href').toLowerCase().indexOf(String(href).toLowerCase()) !== -1) {
          a.setAttribute('aria-current', 'page');
        } else {
          a.removeAttribute('aria-current');
        }
      });
    }
  });

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();

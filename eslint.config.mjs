import js from "@eslint/js";
import prettier from "eslint-config-prettier";

/**
 * ملفات JavaScript مُصغَّرة (minified) يدويًا داخل js/ — لا يوجد خط بناء (build pipeline)
 * في هذا المشروع حاليًا، لذا هذه الملفات مكتوبة مباشرة بصيغتها المضغوطة النهائية.
 * تُستثنى من الفحص والتنسيق حتى تتم إضافة خط بناء رسمي (minifier) يفصل المصدر المقروء
 * عن الناتج المضغوط. لا تُعِد تهيئة أو تنسيق هذه الملفات يدويًا.
 */
const MINIFIED_JS = [
  "js/about.js",
  "js/blog.js",
  "js/blog-en.js",
  "js/brands.js",
  "js/brands-en.js",
  "js/company-profile.js",
  "js/contact.js",
  "js/contact-en.js",
  "js/faq-schema-injector.js",
  "js/lang-switch.js",
  "js/perf.js",
  "js/projects.js",
  "js/projects-en.js",
  "js/seo-injector.js",
  "js/services-deep-content.js",
  "js/services.js",
  "js/services-en.js",
  "js/shared.js",
  "js/site-shell.js",
];

const BROWSER_GLOBALS = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  fetch: "readonly",
  FormData: "readonly",
  URLSearchParams: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  ResizeObserver: "readonly",
  IntersectionObserver: "readonly",
  MutationObserver: "readonly",
  sessionStorage: "readonly",
  localStorage: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  console: "readonly",
};

const WORKER_GLOBALS = {
  Request: "readonly",
  Response: "readonly",
  Headers: "readonly",
  fetch: "readonly",
  crypto: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  HTMLRewriter: "readonly",
  btoa: "readonly",
  atob: "readonly",
  escape: "readonly",
  unescape: "readonly",
  console: "readonly",
};

// تُستخدم عبر دوال functions/ بكثرة: catch (_) { /* تجاهل متعمَّد */ } — نمط
// مقصود لتفويت الفشل بأمان (fail open)، وليس متغيّرًا منسيًّا.
const UNUSED_VARS_RULE = [
  "warn",
  { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
];

export default [
  {
    ignores: ["node_modules/**", "backups/**", ".wrangler/**", "dist/**", ...MINIFIED_JS],
  },
  js.configs.recommended,
  prettier,
  {
    // الملف الوحيد داخل js/ المكتوب حاليًا بصيغة مقروءة (غير مُصغَّرة).
    files: ["js/index.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: BROWSER_GLOBALS,
    },
    rules: {
      "no-unused-vars": UNUSED_VARS_RULE,
    },
  },
  {
    // دوال Cloudflare Pages Functions (Workers runtime، وحدات ES).
    files: ["functions/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: WORKER_GLOBALS,
    },
    rules: {
      "no-unused-vars": UNUSED_VARS_RULE,
    },
  },
  {
    // اختبارات node:test — بيئة Node قياسية، وحدات ES.
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { console: "readonly", process: "readonly" },
    },
    rules: {
      "no-unused-vars": UNUSED_VARS_RULE,
    },
  },
];

/**
 * js/lead-tracking-lib.js
 * ------------------------------------------------------------------
 * Pure, dependency-injected logic for reporting successful lead-generation
 * form submissions (the quote/contact forms routed through
 * `SiteShell.postLead` in js/site-shell.js) as a GA4 "generate_lead" event.
 *
 * Design goals (see tests/lead-tracking-lib.test.mjs for full coverage):
 *
 *   - Reliability: every function degrades to a safe no-op if its inputs
 *     are missing or malformed, and never throws. Pushing onto
 *     `dataLayer` works even before gtag.js itself has finished loading
 *     (GA4's own `gtag()` is nothing more than `dataLayer.push(arguments)`
 *     — see js/seo-injector.js), so this has no dependency on
 *     `window.gtag` existing yet at the moment a form is submitted.
 *
 *   - Correctness: functions/api/quote.js deliberately reports
 *     `{success:true}` for honeypot-caught bot submissions, so as not to
 *     tip bots off that they were caught. A submission is only ever
 *     counted as a real lead when BOTH signals agree: the server response
 *     says success AND the client-visible honeypot field is empty.
 *
 *   - No double-counting: each `<form>` is tracked at most once per
 *     browser session via a sessionStorage-backed dedup key, guarding
 *     against retries/resubmissions inflating the count.
 *
 *   - No page-specific coupling: form fields are read defensively by
 *     name, so the same logic works unmodified for every current and
 *     future form that goes through `SiteShell.postLead`, without
 *     hardcoding per-page field names.
 *
 * Loaded in the browser as a native ES module (`<script type="module">`),
 * which is why real `export` statements are used throughout (unlike the
 * legacy hand-minified classic scripts elsewhere in js/). This also lets
 * tests/lead-tracking-lib.test.mjs `import` it directly, unmodified,
 * under node:test — the same pattern already used for
 * functions/admin/_leads-lib.js.
 */

const EVENT_NAME = "generate_lead";
const HONEYPOT_FIELD = "botcheck";
const DEDUP_PREFIX = "efi_lead_tracked_";

/**
 * @param {FormData} formData
 * @returns {boolean} true if the hidden anti-spam field was filled in,
 *   which only happens via automated bots (the field is hidden from real
 *   users with `aria-hidden` + CSS in every form that uses it).
 */
export function isHoneypotFilled(formData) {
  if (!formData || typeof formData.get !== "function") return false;
  const value = formData.get(HONEYPOT_FIELD);
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} responseJson - parsed JSON body returned by /api/quote
 * @param {FormData} formData - the submitted form's data
 * @returns {boolean} true only for a genuine, non-bot, successful submission
 */
export function shouldTrackLead(responseJson, formData) {
  const serverSaysSuccess =
    !!responseJson &&
    typeof responseJson === "object" &&
    responseJson.success === true;
  return serverSaysSuccess && !isHoneypotFilled(formData);
}

/**
 * @param {FormData} formData
 * @param {{formId?: string, pagePath?: string}} [meta]
 * @returns {Record<string, string>} GA4 event parameters. A missing field
 *   is simply omitted rather than sent as `undefined`/`null`, which
 *   gtag/dataLayer would not serialize sensibly.
 */
export function buildLeadEventParams(formData, meta) {
  const params = {};
  const formId = meta && meta.formId;
  const pagePath = meta && meta.pagePath;
  if (formId) params.form_id = String(formId);
  if (pagePath) params.page_path = String(pagePath);
  if (formData && typeof formData.get === "function") {
    const service = formData.get("Service");
    if (typeof service === "string" && service.trim())
      params.lead_service = service.trim();
  }
  return params;
}

/**
 * @param {string} formId
 * @returns {string} the sessionStorage key used to dedupe a given form
 */
export function dedupeKey(formId) {
  return DEDUP_PREFIX + (formId || "unknown");
}

/**
 * @param {{getItem(key: string): string|null}} storage - sessionStorage-shaped store
 * @param {string} formId
 * @returns {boolean}
 */
export function alreadyTracked(storage, formId) {
  if (!storage || typeof storage.getItem !== "function") return false;
  try {
    return storage.getItem(dedupeKey(formId)) === "1";
  } catch (_err) {
    return false;
  }
}

/**
 * @param {{setItem(key: string, value: string): void}} storage
 * @param {string} formId
 */
export function markTracked(storage, formId) {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(dedupeKey(formId), "1");
  } catch (_err) {
    // Storage unavailable (private browsing / quota exceeded) — dedup is
    // best-effort only and must never break the caller.
  }
}

/**
 * Pushes the GA4 event in the exact shape `gtag()` itself would push
 * (`dataLayer.push(arguments)` under the hood), so this works whether or
 * not gtag.js has finished loading yet.
 * @param {unknown[]} dataLayer
 * @param {Record<string, string>} params
 * @returns {boolean} true if the event was pushed
 */
export function pushLeadEvent(dataLayer, params) {
  if (!dataLayer || typeof dataLayer.push !== "function") return false;
  dataLayer.push(Object.assign({ event: EVENT_NAME }, params));
  return true;
}

/**
 * Orchestrates the full decision: validates the submission, applies the
 * dedup guard, and pushes the event. Every collaborator (`dataLayer`,
 * `storage`) is injected so this can be fully unit-tested without a real
 * browser environment.
 *
 * @param {{
 *   responseJson: unknown,
 *   formData: FormData,
 *   formId: string,
 *   pagePath?: string,
 *   dataLayer: unknown[],
 *   storage?: {getItem(key: string): string|null, setItem(key: string, value: string): void},
 * }} ctx
 * @returns {boolean} true if an event was actually pushed on this call
 */
export function trackLeadFromResponse(ctx) {
  const context = ctx || {};
  const { responseJson, formData, formId, pagePath, dataLayer, storage } =
    context;
  if (!shouldTrackLead(responseJson, formData)) return false;
  if (alreadyTracked(storage, formId)) return false;
  const params = buildLeadEventParams(formData, { formId, pagePath });
  const pushed = pushLeadEvent(dataLayer, params);
  if (pushed) markTracked(storage, formId);
  return pushed;
}

export const GENERATE_LEAD_EVENT_NAME = EVENT_NAME;

// Self-register for classic-script consumers (js/site-shell.js calls
// `window.LeadTracking.trackLeadFromResponse(...)` defensively — see its
// `postLead` function). Safe no-op outside a browser (e.g. under node:test,
// where `window` is undefined and this branch is simply skipped).
if (typeof window !== "undefined") {
  window.LeadTracking = {
    isHoneypotFilled,
    shouldTrackLead,
    buildLeadEventParams,
    dedupeKey,
    alreadyTracked,
    markTracked,
    pushLeadEvent,
    trackLeadFromResponse,
  };
}

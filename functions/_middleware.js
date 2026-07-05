/**
 * Pages middleware — per-request CSP nonce injection.
 *
 * Replaces the static `Content-Security-Policy` that relied on
 * `'unsafe-inline'`. For every HTML response it:
 *   1. generates a fresh random nonce,
 *   2. stamps that nonce on every inline <script> (non-JSON-LD) and <style>,
 *   3. emits a CSP header allowing only `'nonce-…'` (no `'unsafe-inline'`)
 *      for script-src and style-src (which governs <style> elements).
 *
 * Inline event-handler attributes (onclick/onload/…) cannot carry a nonce,
 * so they are removed from the markup separately (see js/site-shell.js and
 * the per-page wiring). JSON-LD blocks are data, not executable, so they are
 * left untouched. style-src-attr (the `style="…"` HTML attribute, set either
 * statically or at runtime via JS) is allowed via `'unsafe-inline'` as a
 * narrow, deliberate exception — nonces cannot cover it, and script-src is
 * unaffected, so the XSS-relevant surface stays nonce-only.
 *
 * Fails safe: any error returns the original response unchanged.
 */
export async function onRequest(context) {
  const { next } = context;
  const response = await next();

  try {
    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return response;

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const nonce = btoa(bin);

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://unpkg.com https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://static.cloudflareinsights.com https://challenges.cloudflare.com`,
      `style-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://unpkg.com`,
      // style-src-attr is intentionally relaxed (independent of the nonce
      // above): a small number of elements set the `style` attribute at
      // runtime with a genuinely dynamic value (e.g. the scroll-reading
      // progress bar's width percentage), which cannot carry a nonce.
      // This does not weaken script-src, which remains nonce-only.
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://cdnjs.cloudflare.com",
      "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://cloudflareinsights.com https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    const transformed = new HTMLRewriter()
      .on("script", {
        element(el) {
          const type = (el.getAttribute("type") || "").toLowerCase();
          if (el.getAttribute("src") === null && type !== "application/ld+json") {
            el.setAttribute("nonce", nonce);
          }
        },
      })
      .on("style", {
        element(el) {
          el.setAttribute("nonce", nonce);
        },
      })
      .transform(response);

    transformed.headers.set("Content-Security-Policy", csp);

    // Cloudflare's "Speed Brain" zone feature auto-injects a
    // Speculation-Rules header instructing Chrome to speculatively
    // prefetch same-origin links. On this zone those prefetch requests are
    // then refused at Cloudflare's edge (response: 503, header
    // `cf-speculation-refused: prefetch refused: not eligible`), which
    // Chrome logs as a console error and Lighthouse flags under Best
    // Practices. Stripping the header here prevents Chrome from attempting
    // prefetches that the edge will reject anyway; it has no effect on
    // normal navigation, which is unaffected either way.
    transformed.headers.delete("Speculation-Rules");

    return transformed;
  } catch (_) {
    return response;
  }
}

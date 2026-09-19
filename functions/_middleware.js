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
/**
 * Repository paths that are not part of the website.
 *
 * The Pages build output directory is the repository root, so anything in it
 * that Pages does not itself exclude is served. Its exclusion list is fixed —
 * _worker.js, _redirects, _headers, _routes.json, functions, .DS_Store,
 * node_modules, .git, .wrangler — and the uploader reads no ignore file at
 * all: neither .wranglerignore nor .assetsignore is consulted (verified in the
 * Wrangler source). The database schema, wrangler.toml with its D1 id,
 * package-lock.json and the whole test suite were therefore all reachable.
 *
 * Blocking them here rather than in _redirects because Pages caps a redirects
 * file at 100 dynamic rules: four wildcard rules at the top of that file
 * pushed it past the cap and silently dropped 94 lines of real redirects. This
 * middleware already runs ahead of every asset request, so the check is free.
 *
 * scripts/build-site.mjs now assembles dist/ from exactly the files this
 * function calls public, so once pages_build_output_dir points at dist/ the
 * excluded files are never uploaded at all. This check stays as the second
 * layer: it is what holds while the switch is being made, and what keeps
 * holding if a future deploy ever publishes the root again by accident.
 */
const NOT_PUBLIC = [
  "/migrations/",
  "/scripts/",
  "/tests/",
  "/workers/",
  "/.git/",
  "/backups/",
  // Build output. Once pages_build_output_dir points at dist/ its contents
  // ARE the site root and this path cannot occur; until then, a build that
  // runs while the root is still being published would otherwise serve a
  // second copy of the whole site under /dist/.
  "/dist/",
];

const NOT_PUBLIC_FILES = new Set([
  "/wrangler.toml",
  "/package.json",
  "/package-lock.json",
  "/eslint.config.mjs",
  "/.gitignore",
  "/.gitattributes",
  "/.prettierignore",
  "/.prettierrc.json",
  "/.editorconfig",
]);

/**
 * File types the site is never made of.
 *
 * Blocking by type rather than by name because the leak that prompted this was
 * a pricing document sitting in the repository root — internal paperwork lands
 * next to the site far more often than anyone adds a new tooling directory,
 * and naming each file would mean noticing each one first.
 *
 * .pdf is deliberately absent: assets/gallery holds the company profile, which
 * is a published document. Every page on this site is .html.
 */
const NOT_PUBLIC_EXTENSIONS = [
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pptx",
  ".md",
  ".sql",
  ".toml",
  ".ps1",
  ".sh",
  ".bak",
  ".old",
  ".log",
  ".lock",
  ".env",
];

export function isPublicPath(pathname) {
  const p = String(pathname || "").toLowerCase();
  if (NOT_PUBLIC_FILES.has(p)) return false;
  if (NOT_PUBLIC_EXTENSIONS.some((ext) => p.endsWith(ext))) return false;
  return !NOT_PUBLIC.some((prefix) => p.startsWith(prefix));
}

export async function onRequest(context) {
  const { next, request } = context;

  if (!isPublicPath(new URL(request.url).pathname)) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

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
      // GA4 and Google Ads do not post to the hostnames their loader script is
      // served from. Measured on the live site, every measurement request was
      // refused by this directive: analytics.google.com, www.google.com/g/collect,
      // stats.g.doubleclick.net for GA4, and www.google.com/ccm/collect plus
      // ad.doubleclick.net for the Ads conversion tag. The tags loaded, ran, and
      // then had every hit dropped — so the site was paying for Ads while
      // reporting no conversions, and the generate_lead events fired by
      // js/conversion-kit.js never reached the property at all.
      "connect-src 'self' https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.google.com https://*.g.doubleclick.net https://ad.doubleclick.net https://cloudflareinsights.com https://static.cloudflareinsights.com https://challenges.cloudflare.com",
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

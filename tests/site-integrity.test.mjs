/**
 * Repository-wide integrity checks.
 *
 * These guard invariants that no unit test can see because they live across the
 * whole published tree rather than inside one module. Every one of them
 * corresponds to a defect that actually reached production:
 *
 *   1. A retired phone number left behind in 27 files, so a third of the
 *      landing pages sent WhatsApp traffic to a line nobody answers.
 *   2. Script and stylesheet references with no version token, while _headers
 *      serves /*.js and /*.css as `immutable` for a year — those visitors keep
 *      the pre-change bundle indefinitely.
 *   3. Arabic text double-encoded by a PowerShell rewrite (mojibake), which is
 *      invisible in a diff viewer but renders as garbage on the page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".git", "backups", ".wrangler", "dist", "assets"]);
const TEXT_EXT = new Set([".html", ".js", ".json", ".css", ".txt", ".xml"]);

/** Every text file in the published tree, excluding build and backup dirs. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(extname(entry.name))) out.push(full);
  }
  return out;
}

/** HTML files everywhere, including assets/articles. */
function walkHtml(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) && entry.name !== "assets") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const TEXT_FILES = walk(ROOT);
const HTML_FILES = walkHtml(ROOT);

test("no retired phone number remains anywhere in the tree", () => {
  const offenders = TEXT_FILES.filter((f) => /548113865/.test(readFileSync(f, "utf8"))).map((f) =>
    relative(ROOT, f)
  );
  assert.deepEqual(offenders, [], "retired number 0548113865 still present");
});

test("the single active number is the one published in the config", () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, "lib", "site.config.json"), "utf8"));
  assert.equal(cfg.contact.phonePrimary.e164, "+966598366214");
  assert.equal(cfg.contact.phoneWhatsapp.e164, cfg.contact.phonePrimary.e164);
});

test("every local script and stylesheet shares one cache-busting token", () => {
  // _headers serves /*.css and /*.js as `max-age=31536000, immutable`, so a
  // reference without a token — or pinned to an older one — leaves returning
  // visitors on the previous file for a year with no way to recover.
  // Checking only the handful of files being edited is what left
  // css/maintenance-contracts.css stranded on a stale token after its colours
  // changed, so this covers every local reference and requires them to agree.
  const REF = /((?:src|href)="(?!https?:|\/\/)[^"]*?\.(?:css|js))(\?v=([^"]*))?"/g;
  const tokens = new Map();
  const untokened = [];

  for (const file of HTML_FILES) {
    for (const m of readFileSync(file, "utf8").matchAll(REF)) {
      if (!m[3]) {
        untokened.push(relative(ROOT, file) + " -> " + m[1]);
        continue;
      }
      const list = tokens.get(m[3]) || [];
      if (list.length < 3) list.push(relative(ROOT, file));
      tokens.set(m[3], list);
    }
  }

  assert.deepEqual(untokened.slice(0, 10), [], "local asset reference without a ?v= token");
  assert.equal(
    tokens.size,
    1,
    "assets are pinned to different tokens: " +
      [...tokens.entries()].map(([t, f]) => t + " (" + f.join(", ") + ")").join(" | ")
  );
});

test("the newsletter form does not post into the sales-lead pipeline", () => {
  const shell = readFileSync(join(ROOT, "js", "site-shell.js"), "utf8");
  assert.match(shell, /newsletter:\{endpoint:"\/api\/newsletter"/);
  assert.equal(shell.includes("accessKey"), false, "dead web3forms key still shipped");
});

test("no page publishes the retired web3forms API key", () => {
  // The site posts to its own /api/quote Worker, which strips this field and
  // has never read it. Shipping it left a live third-party key readable in the
  // page source of every form.
  // Scoped to what the browser receives. functions/api/quote.js still names the
  // field, on purpose: it strips it from any legacy payload that arrives.
  const shipped = TEXT_FILES.filter((f) => /\.(html|js|css)$/.test(f) && !f.includes("functions"));
  const offenders = shipped
    .filter((f) => /access_key/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, [], "dead web3forms access_key still shipped");
});

test("page-context patterns match the extensionless URLs Pages actually serves", () => {
  // Cloudflare Pages redirects /x.html to /x, so location.pathname never
  // carries the extension in production. Patterns that required ".html"
  // silently degraded every city and article page to the generic offer.
  const src = readFileSync(join(ROOT, "js", "conversion-kit.js"), "utf8");

  const citySrc = src.match(/var city = p\.match\((\/.+?\/)\);/);
  const artSrc = src.match(/var art = p\.match\((\/.+?\/)\);/);
  assert.ok(citySrc, "city pattern not found");
  assert.ok(artSrc, "article pattern not found");

  const compile = (literal) => {
    const end = literal.lastIndexOf("/");
    return new RegExp(literal.slice(1, end), literal.slice(end + 1));
  };
  const city = compile(citySrc[1]);
  const art = compile(artSrc[1]);

  const cases = [
    [city, "/cold-rooms-dammam", "dammam"],
    [city, "/cold-rooms-dammam.html", "dammam"],
    [city, "/cold-rooms-al-ahsa-en", "al-ahsa"],
    [art, "/assets/articles/bitzer-maintenance-ar", "bitzer-maintenance"],
    [art, "/assets/articles/bitzer-maintenance-ar.html", "bitzer-maintenance"],
    [art, "/assets/articles/refrigeration-gas-leak-en", "refrigeration-gas-leak"],
  ];
  for (const [re, path, expected] of cases) {
    const m = path.match(re);
    assert.ok(m, `no match for ${path}`);
    assert.equal(m[1], expected, `wrong slug for ${path}`);
  }
});

test("no page ships a syntactically invalid inline script", () => {
  // Twelve Arabic industry pages shipped
  //   document.addEventListener('DOMContentLoaded',()=>{if(window.AOS)});
  // which the parser rejects, so the browser discarded the whole <script> and
  // logged an uncaught SyntaxError on every visit. Their English twins were
  // correct, which is exactly why nobody noticed.
  const offenders = [];
  for (const file of HTML_FILES) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const body = m[1];
      if (!body.trim()) continue;
      // JSON-LD blocks are data, not script.
      if (/application\/(ld\+json|json)/.test(m[0])) continue;
      try {
        new Function(body);
      } catch (err) {
        offenders.push(relative(ROOT, file) + " :: " + err.message);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [], "inline script does not parse");
});

test("the honeypot cannot create horizontal overflow", () => {
  // Left at its static position the 1px field sat past the inline end of an
  // RTL form and made the document 37px wider than the phone screen, giving
  // every page that carries the capture block a sideways scroll.
  const css = readFileSync(join(ROOT, "css", "conversion-kit.css"), "utf8");
  const block = css.slice(css.indexOf(".efi-hp {"));
  assert.match(block, /inset-inline-start:\s*0/, "honeypot is not pinned to the inline start");
  assert.match(block, /inset-block-start:\s*0/, "honeypot is not pinned to the block start");
  assert.match(
    css,
    /\.efi-cap-form,\s*\n?\s*\.efi-calc-form \{[^}]*position:\s*relative/,
    "the forms provide no positioning context for the pinned honeypot"
  );
});

test("CSP allows the endpoints GA4 and Google Ads actually post to", () => {
  // The tags loaded and ran, then had every measurement hit refused by
  // connect-src — so the site reported no conversions at all.
  const mw = readFileSync(join(ROOT, "functions", "_middleware.js"), "utf8");
  const line = mw.split("\n").find((l) => l.includes("connect-src"));
  assert.ok(line, "connect-src directive not found");
  for (const host of [
    "https://analytics.google.com",
    "https://www.google.com",
    "https://*.g.doubleclick.net",
    "https://ad.doubleclick.net",
    "https://*.google-analytics.com",
  ]) {
    assert.ok(line.includes(host), `connect-src is missing ${host}`);
  }
});

test("the site serves a real favicon.ico", () => {
  // Browsers request /favicon.ico implicitly on every page whether or not a
  // <link> exists. The site had no such file, so every page load ended in a
  // 404, and the declared icon was a .webp of the wide logo lockup — an
  // illegible smudge at 16px, and unusable by consumers that ignore the tag.
  const ico = readFileSync(join(ROOT, "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0, "not an ICO: reserved field");
  assert.equal(ico.readUInt16LE(2), 1, "not an ICO: type must be 1");
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 3, `expected at least three sizes, found ${count}`);

  const sizes = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + 16 * i;
    sizes.push(ico.readUInt8(entry) || 256);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + length <= ico.length, "image data runs past end of file");
    // Each entry is an embedded PNG; check its signature.
    assert.equal(
      ico.subarray(offset, offset + 4).toString("hex"),
      "89504e47",
      "entry is not a PNG"
    );
  }
  assert.deepEqual(
    sizes.sort((a, b) => a - b),
    [16, 32, 48]
  );
});

test("no page declares the logo lockup as its icon", () => {
  const offenders = [];
  for (const file of HTML_FILES) {
    for (const tag of readFileSync(file, "utf8").match(/<link\b[\s\S]*?>/g) || []) {
      if (/icon/.test(tag) && /\.webp/.test(tag)) offenders.push(relative(ROOT, file));
    }
  }
  assert.deepEqual([...new Set(offenders)], [], "icon link still points at a .webp");
});

test("no Arabic text is double-encoded (mojibake)", () => {
  // The signature of UTF-8 read as Latin-1 and re-encoded: Ø or Ù followed by
  // another high byte. Genuine Arabic never produces this sequence.
  const MOJIBAKE = /[ØÙ][-¿]/;
  const offenders = TEXT_FILES.filter((f) => MOJIBAKE.test(readFileSync(f, "utf8"))).map((f) =>
    relative(ROOT, f)
  );
  assert.deepEqual(offenders, [], "double-encoded Arabic detected");
});

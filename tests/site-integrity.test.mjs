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

test("every reference to a versioned asset carries a cache-busting token", () => {
  // Assets served immutable for a year; a stale copy is unrecoverable without
  // the visitor clearing their cache.
  const assets = [
    "js/site-shell.js",
    "js/conversion-kit.js",
    "css/conversion-kit.css",
    "js/index.js",
    "js/index-en.js",
  ];
  const offenders = [];
  for (const file of HTML_FILES) {
    const text = readFileSync(file, "utf8");
    for (const asset of assets) {
      const escaped = asset.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      if (new RegExp('(?:src|href)="[^"]*?' + escaped + '"').test(text)) {
        offenders.push(relative(ROOT, file) + " -> " + asset);
      }
    }
  }
  assert.deepEqual(offenders, [], "asset reference without ?v= token");
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

test("no Arabic text is double-encoded (mojibake)", () => {
  // The signature of UTF-8 read as Latin-1 and re-encoded: Ø or Ù followed by
  // another high byte. Genuine Arabic never produces this sequence.
  const MOJIBAKE = /[ØÙ][-¿]/;
  const offenders = TEXT_FILES.filter((f) => MOJIBAKE.test(readFileSync(f, "utf8"))).map((f) =>
    relative(ROOT, f)
  );
  assert.deepEqual(offenders, [], "double-encoded Arabic detected");
});

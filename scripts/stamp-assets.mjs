#!/usr/bin/env node
/**
 * scripts/stamp-assets.mjs — stamps every local script and stylesheet
 * reference with a token derived from those files' contents.
 *
 * Why a content hash rather than a date:
 *   `_headers` serves /*.css and /*.js as `max-age=31536000, immutable`, so a
 *   URL the browser has already seen is never revalidated. A hand-written
 *   token has to be remembered and changed on every edit, and forgetting is
 *   silent: the deploy succeeds, the file on the origin is new, and every
 *   returning visitor keeps the old one for a year. That is not hypothetical —
 *   it happened twice on this project, once leaving css/maintenance-contracts
 *   .css stranded after a colour change, and once when two consecutive deploys
 *   reused the same date token and the second stylesheet never reached anyone.
 *
 *   Deriving the token from the bytes removes the judgement call: change any
 *   asset and the token changes; change nothing and it stays put, so a rebuild
 *   does not needlessly invalidate every visitor's cache.
 *
 * Usage:  npm run stamp        (rewrites the HTML in place)
 *         npm run stamp -- --check   (exit 1 if anything is out of date)
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, dirname, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKIP = new Set(["node_modules", ".git", "backups", ".wrangler", "dist"]);

/** Matches src/href of a same-origin .css or .js, capturing any existing ?v=. */
const REF = /((?:src|href)=")((?!https?:|\/\/|data:)[^"?]*?\.(?:css|js))(\?v=[^"]*)?"/g;

function walk(dir, test, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (test(entry.name)) out.push(full);
  }
  return out;
}

const htmlFiles = walk(ROOT, (n) => n.endsWith(".html"));

/** Resolves a reference as written in a page to a path on disk. */
function resolveAsset(htmlFile, ref) {
  const base = ref.startsWith("/") ? ROOT : dirname(htmlFile);
  return resolve(base, ref.startsWith("/") ? "." + ref : ref);
}

/** The set of asset files the site actually references. */
function referencedAssets() {
  const assets = new Set();
  for (const file of htmlFiles) {
    for (const m of readFileSync(file, "utf8").matchAll(REF)) {
      assets.add(resolveAsset(file, m[2]));
    }
  }
  return [...assets].sort();
}

export function computeToken() {
  const hash = createHash("sha256");
  for (const asset of referencedAssets()) {
    // Path as well as content: a rename must change the token too.
    hash.update(relative(ROOT, asset).split("\\").join(posix.sep));
    try {
      hash.update(readFileSync(asset));
    } catch (_) {
      // A referenced file that does not exist is a separate problem; hash the
      // absence so the token still changes if it later appears.
      hash.update("\0missing");
    }
  }
  return hash.digest("hex").slice(0, 10);
}

export function stamp({ check = false } = {}) {
  const token = computeToken();
  const stale = [];
  let rewritten = 0;

  for (const file of htmlFiles) {
    const before = readFileSync(file, "utf8");
    const after = before.replace(REF, (whole, head, path, ver) => {
      if (ver === "?v=" + token) return whole;
      stale.push(relative(ROOT, file) + " -> " + path + " " + (ver || "(no token)"));
      return head + path + "?v=" + token + '"';
    });
    if (after !== before && !check) {
      writeFileSync(file, after, "utf8");
      rewritten++;
    }
  }

  return { token, stale, rewritten };
}

// pathToFileURL, not string concatenation: on Windows the drive letter makes
// the naive form `file://D:/…` while import.meta.url is `file:///D:/…`, so the
// comparison silently fails and the script does nothing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const { token, stale, rewritten } = stamp({ check });
  console.log("asset token: " + token);
  if (check) {
    if (stale.length) {
      console.error("out of date references: " + stale.length);
      stale.slice(0, 20).forEach((s) => console.error("  " + s));
      process.exit(1);
    }
    console.log("all references are current.");
  } else {
    console.log("pages rewritten: " + rewritten + ", references updated: " + stale.length);
  }
}

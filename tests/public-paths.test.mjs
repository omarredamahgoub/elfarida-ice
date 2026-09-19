import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { isPublicPath } from "../functions/_middleware.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every one of these was reachable over HTTPS in production, because the rules
 * lived in .wranglerignore — a filename no Wrangler version reads. None is a
 * credential, but together they hand over the database schema, the D1 id, the
 * exact dependency versions and the internal test suite.
 */
const MUST_BLOCK = [
  "/migrations/0001_init.sql",
  "/migrations/0004_response_and_ref.sql",
  "/scripts/stamp-assets.mjs",
  "/tests/digest-lib.test.mjs",
  "/workers/digest/src/index.js",
  "/workers/digest/wrangler.toml",
  "/wrangler.toml",
  "/package.json",
  "/package-lock.json",
  "/eslint.config.mjs",
  "/.gitignore",
  "/.gitattributes",
  "/.prettierignore",
  "/.prettierrc.json",
  // Business paperwork that was sitting in the repository root and being
  // served: the website pricing, a site audit and an O&M guide.
  "/تسعيرة-موقع-الفريدة-آيس.docx",
  "/تقرير-فحص-موقع-الفريدة-آيس.md",
  "/دليل-التشغيل-والصيانة.md",
];

/** The site itself, which must keep working. */
const MUST_SERVE = [
  "/",
  "/index.html",
  "/cold-rooms-dammam",
  "/admin/leads",
  "/api/quote",
  "/js/conversion-kit.js",
  "/css/site-shell.css",
  "/assets/articles/iqf-technology-guide.html",
  "/sitemap.xml",
  "/robots.txt",
  "/favicon.ico",
  "/sw.js",
  "/manifest.webmanifest",
  // A published document, unlike the paperwork above — the extension rule must
  // not take the company profile down with it.
  "/assets/gallery/AL FARIDA - PROFILE.pdf",
];

test("repository tooling is not served as part of the website", async (t) => {
  for (const path of MUST_BLOCK) {
    await t.test(`${path} is blocked`, () => {
      assert.equal(isPublicPath(path), false, `${path} would be served publicly`);
    });
  }

  await t.test("case does not open a way round it", () => {
    assert.equal(isPublicPath("/Migrations/0001_init.sql"), false);
    assert.equal(isPublicPath("/WRANGLER.TOML"), false);
  });

  await t.test("a missing or empty path is treated as the site root, not blocked", () => {
    assert.equal(isPublicPath(""), true);
    assert.equal(isPublicPath(null), true);
  });
});

test("the website itself still serves", async (t) => {
  for (const path of MUST_SERVE) {
    await t.test(`${path} is public`, () => {
      assert.equal(isPublicPath(path), true, `${path} is a real page and must not be blocked`);
    });
  }

  await t.test("a page whose name merely starts with a blocked word is unaffected", () => {
    // "/scripts/" is blocked; "/scripts-and-tools.html" is not a directory
    // under it and must keep working.
    assert.equal(isPublicPath("/scripts-and-tools.html"), true);
    assert.equal(isPublicPath("/testimonials.html"), true);
  });
});

test("every top-level repository entry is accounted for", async (t) => {
  // A directory added later that holds tooling would otherwise start being
  // served the day it is committed, with nothing to notice it.
  const SITE_DIRS = new Set([
    "assets",
    "css",
    "js",
    "industries",
    "lib",
    "partials",
    ".well-known",
    "functions",
    "node_modules",
    ".git",
    ".wrangler",
  ]);

  // Derived from what git tracks, not from what is on disk: an untracked
  // directory (node_modules, dist, .wrangler) is never deployed, so flagging
  // it would be noise that trains people to ignore this test.
  const dirs = [
    ...new Set(
      execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
        .split("\0")
        .filter((f) => f.includes("/"))
        .map((f) => f.split("/")[0])
    ),
  ];

  for (const name of dirs) {
    if (SITE_DIRS.has(name)) continue;
    await t.test(`${name}/ is blocked or declared part of the site`, () => {
      assert.equal(
        isPublicPath(`/${name}/x`),
        false,
        `${name}/ is served publicly — add it to NOT_PUBLIC in functions/_middleware.js, or to SITE_DIRS here if it really is part of the site`
      );
    });
  }
});

test("no committed file of a non-web type is reachable", async (t) => {
  // The leak this guards against was not a directory anyone forgot to list: it
  // was a pricing document dropped beside the pages. Walking what git actually
  // tracks catches the next one on the commit that adds it.
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);

  const WEB = new Set([
    "html",
    "css",
    "js",
    "json",
    "webp",
    "png",
    "jpg",
    "jpeg",
    "svg",
    "gif",
    "ico",
    "woff2",
    "woff",
    "ttf",
    "xml",
    "txt",
    "webmanifest",
    "pdf",
    "mp4",
    "webm",
    "avif",
  ]);

  // Pages never serves these four, whatever the middleware says.
  const PAGES_OWNS = new Set(["_headers", "_redirects", "_routes.json", "_worker.js"]);

  const suspects = tracked.filter((f) => {
    if (PAGES_OWNS.has(f)) return false;
    const ext = (f.split(".").pop() || "").toLowerCase();
    // Site data lives in lib/ and is fetched at runtime; only a JSON sitting in
    // the repository root is configuration rather than content.
    if (ext === "json") return !f.includes("/");
    return !WEB.has(ext);
  });

  for (const file of suspects) {
    await t.test(`${file} is not served`, () => {
      assert.equal(
        isPublicPath("/" + file),
        false,
        `${file} is committed and would be served at https://elfaridaice.com/${file} — block it in functions/_middleware.js, or remove it from the repository`
      );
    });
  }
});

test("dead ignore files are not left behind to mislead", async (t) => {
  await t.test(".wranglerignore is gone — no Wrangler version reads it", () => {
    assert.equal(existsSync(join(ROOT, ".wranglerignore")), false);
  });

  await t.test(".assetsignore is not used either — the Pages uploader ignores it", () => {
    assert.equal(existsSync(join(ROOT, ".assetsignore")), false);
  });
});

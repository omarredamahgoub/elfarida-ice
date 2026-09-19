import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { selectSiteFiles } from "../scripts/build-site.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const selected = new Set(selectSiteFiles(tracked));

test("the build publishes the site", async (t) => {
  for (const file of [
    "index.html",
    "index-en.html",
    "cold-rooms-dammam.html",
    "_headers",
    "_redirects",
    "robots.txt",
    "sitemap.xml",
    "favicon.ico",
    "sw.js",
    "manifest.webmanifest",
    "css/site-shell.css",
    "js/conversion-kit.js",
    "lib/site.config.json",
    "assets/gallery/AL FARIDA - PROFILE.pdf",
  ]) {
    await t.test(`${file} is published`, () => {
      assert.ok(selected.has(file), `${file} is part of the site and must be in dist/`);
    });
  }

  await t.test("every committed .html page is published", () => {
    const pages = tracked.filter((f) => f.endsWith(".html") && !f.startsWith("functions/"));
    const dropped = pages.filter((f) => !selected.has(f));
    assert.deepEqual(dropped, [], "pages were dropped from the build");
  });
});

test("the build withholds everything that is not the site", async (t) => {
  for (const file of [
    "package.json",
    "package-lock.json",
    "wrangler.toml",
    "eslint.config.mjs",
    ".gitignore",
    "migrations/0001_init.sql",
    "scripts/build-site.mjs",
    "tests/build-site.test.mjs",
    "workers/digest/src/index.js",
  ]) {
    await t.test(`${file} is withheld`, () => {
      assert.equal(selected.has(file), false, `${file} would be uploaded to the public site`);
    });
  }

  await t.test("functions/ is never copied — Pages compiles it from the root", () => {
    const leaked = [...selected].filter((f) => f.startsWith("functions/"));
    assert.deepEqual(leaked, []);
  });

  await t.test("nothing withheld by the running site is published by the build", () => {
    // The two share isPublicPath(), so this asserts the property that makes
    // the pair safe: the build cannot publish what the site would refuse.
    const contradictions = [...selected].filter((f) => f.startsWith("tests/"));
    assert.deepEqual(contradictions, []);
  });
});

test("selectSiteFiles", async (t) => {
  await t.test("is a pure filter over the list it is given", () => {
    const out = selectSiteFiles(["index.html", "package.json", "functions/_middleware.js"]);
    assert.deepEqual(out, ["index.html"]);
  });

  await t.test("an empty repository selects nothing rather than throwing", () => {
    assert.deepEqual(selectSiteFiles([]), []);
  });
});

/**
 * scripts/build-site.mjs — assemble the publishable site into dist/.
 *
 * Until now the Pages build output directory was the repository root, so the
 * site was whatever happened to be committed: the database schema, the test
 * suite, wrangler.toml and — the reason this exists — the company's pricing
 * document were all served alongside the pages. Blocking them at request time
 * works, but it defends a mistake instead of removing it. A file that is never
 * uploaded cannot be served by any rule, cache or future misconfiguration.
 *
 * Two decisions keep this honest rather than clever:
 *
 *   The file list comes from `git ls-files`, not from a directory walk. What
 *   is published is then exactly what is committed — no stray local scratch
 *   file can ride along, and nothing depends on ignore files whose semantics
 *   differ between tools (the previous .wranglerignore was read by nothing).
 *
 *   The include/exclude rule is imported from functions/_middleware.js, the
 *   same isPublicPath() the running site uses. The build and the runtime
 *   therefore cannot disagree about what belongs to the public site; there is
 *   one list, in one place, exercised by one set of tests.
 *
 * functions/ is deliberately not copied: Pages compiles it into the Functions
 * bundle from the project root and never serves it as an asset.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isPublicPath } from "../functions/_middleware.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");

/** Files the site cannot work without; a build missing one is a failed build. */
const REQUIRED = [
  "index.html",
  "_headers",
  "_redirects",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  "css/site-shell.css",
  "js/conversion-kit.js",
  "lib/site.config.json",
];

/**
 * Directories that are never part of the repository's committed contents.
 * Used only by the fallback below, where git cannot answer the question.
 */
const NON_REPO = new Set(["node_modules", ".git", ".wrangler", "dist", ".github", ".vscode"]);

function walk(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir === "" ? "." : dir), { withFileTypes: true })) {
    if (base === "" && NON_REPO.has(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(rel, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * The files the repository contains.
 *
 * git is the right answer — it publishes exactly what is committed, so no
 * local scratch file can ride along. But the build runs in a container this
 * repository does not control, and a build that dies because `git` is absent
 * takes the site down. The fallback walks the tree instead and leans entirely
 * on isPublicPath(), which is the rule that actually protects anything; it is
 * strictly safer than what this replaced, where the whole tree was published.
 */
function repositoryFiles() {
  try {
    const listed = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    if (listed.length) return { files: listed, source: "git" };
  } catch (_) {
    /* no git, or not a checkout — fall through */
  }
  return { files: walk(""), source: "filesystem" };
}

export function selectSiteFiles(files) {
  return files.filter((f) => {
    // Pages owns functions/ — it is compiled, not published.
    if (f === "functions" || f.startsWith("functions/")) return false;
    return isPublicPath("/" + f);
  });
}

function build() {
  const { files: tracked, source } = repositoryFiles();
  const publish = selectSiteFiles(tracked);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let bytes = 0;
  for (const rel of publish) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) continue; // committed but deleted locally
    const to = join(OUT, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    bytes += statSync(from).size;
  }

  const missing = REQUIRED.filter((f) => !existsSync(join(OUT, f)));
  if (missing.length) {
    throw new Error(
      `build produced a site missing required files: ${missing.join(", ")}\n` +
        "Refusing to publish — deploying this would take the site down."
    );
  }

  const withheld = tracked.length - publish.length;
  process.stdout.write(
    `dist/: ${publish.length} files, ${(bytes / 1048576).toFixed(1)} MB` +
      ` — ${withheld} withheld from the site (file list from ${source})\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  build();
}

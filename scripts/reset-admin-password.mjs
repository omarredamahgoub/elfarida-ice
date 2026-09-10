#!/usr/bin/env node
/**
 * scripts/reset-admin-password.mjs
 *
 * Resets the /admin/leads panel credentials when the password has been lost.
 *
 * Run it yourself:   npm run admin:reset
 *
 * Why a script rather than a manual database edit:
 *
 *   - The password is stored as a SHA-256 hash and is not recoverable by
 *     design. The only way back in is to set a new one.
 *
 *   - Deleting the credential rows would make /admin/leads fall back to its
 *     one-time setup page, which is open to whoever loads it first. This script
 *     never leaves that window open: it overwrites both rows in a single step.
 *
 *   - The password is typed here and hashed locally. It is never printed, never
 *     written to a file, never passed as a command-line argument (where it would
 *     land in shell history and the process list), and never leaves this machine
 *     in plain form — only the resulting hash is sent to D1.
 *
 * Requires: wrangler authenticated against the Cloudflare account that owns the
 * "elfarida-leads" D1 database (`npx wrangler login`).
 */

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB_NAME = "elfarida-leads";
const MIN_PASSWORD_LENGTH = 8;

/* ── prompts ─────────────────────────────────────────────────────── */

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Reads a line without echoing it. Node's readline has no built-in masking, so
 * the output stream's write is intercepted while the answer is being typed.
 */
function askHidden(question) {
  // Masking needs a real terminal. Without one (a pipe, a CI job) the characters
  // cannot be hidden, so say so plainly rather than echoing a password that the
  // user believes is hidden.
  const canMask = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  if (!canMask) {
    console.error(
      "\nهذا السكربت يحتاج طرفية تفاعلية لإخفاء ما تكتبه.\n" +
        "شغّله مباشرة في PowerShell أو Terminal:  npm run admin:reset\n"
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    const onData = (chunk) => {
      // Redraw the prompt line without the typed characters.
      const s = chunk.toString();
      if (s === "\r" || s === "\n" || s === "\r\n") return;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(question);
    };
    process.stdin.on("data", onData);
    rl.question(question, (answer) => {
      process.stdin.removeListener("data", onData);
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/* ── D1 ──────────────────────────────────────────────────────────── */

/**
 * Runs SQL against the remote D1 database via a temp file, so no value ever
 * appears in the command line (and therefore never in shell history).
 */
function runSql(sql) {
  const dir = mkdtempSync(join(tmpdir(), "efi-admin-"));
  const file = join(dir, `${randomUUID()}.sql`);
  writeFileSync(file, sql, "utf8");
  try {
    return execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["--yes", "wrangler", "d1", "execute", DB_NAME, "--remote", `--file=${file}`, "--json"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
    );
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* best effort */
    }
  }
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/* ── main ────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const isLocal = args.includes("--local");
if (isLocal) {
  console.log("ملاحظة: --local غير مدعوم في هذا السكربت. يعمل على القاعدة الحيّة فقط.\n");
  process.exit(1);
}

console.log("إعادة تعيين كلمة مرور لوحة /admin/leads");
console.log("────────────────────────────────────────\n");

const username = (await ask("اسم المستخدم [omar]: ")) || "omar";
const password = await askHidden("كلمة المرور الجديدة (8 أحرف على الأقل): ");

if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`\nكلمة المرور قصيرة — الحد الأدنى ${MIN_PASSWORD_LENGTH} أحرف. لم يتغيّر شيء.`);
  process.exit(1);
}

const confirm = await askHidden("أعد كتابة كلمة المرور للتأكيد: ");
if (confirm !== password) {
  console.error("\nكلمتا المرور غير متطابقتين. لم يتغيّر شيء.");
  process.exit(1);
}

const hash = createHash("sha256").update(password).digest("hex");

console.log("\nجارٍ التحديث على قاعدة البيانات الحيّة…");

try {
  runSql(
    [
      "CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);",
      `INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_user', ${sqlQuote(username)});`,
      `INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_pwd_hash', ${sqlQuote(hash)});`,
      // Any session cookie issued under the old password is signed with the old
      // hash, so it stops validating the moment the hash changes. Clearing the
      // login-attempt log as well removes any rate-limit block on your own IP.
      "DELETE FROM admin_login_attempts;",
    ].join("\n")
  );
} catch (error) {
  console.error("\nفشل التحديث. تأكد من تسجيل الدخول إلى Cloudflare أولاً:");
  console.error("  npx wrangler login\n");
  console.error(String(error.stderr || error.message).slice(0, 600));
  process.exit(1);
}

console.log("\n✅ تم بنجاح.");
console.log(`   اسم المستخدم : ${username}`);
console.log("   كلمة المرور  : التي أدخلتها للتو (غير مطبوعة هنا عمداً)");
console.log("\n   ادخل الآن على: https://elfaridaice.com/admin/leads");
console.log("   أي جلسة قديمة على أي جهاز أصبحت لاغية.\n");

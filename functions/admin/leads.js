/**
 * /admin/leads — protected leads viewer (D1-backed auth, in-page form login).
 * No env secrets, no Basic-Auth popup. Session = cookie signed with HMAC keyed
 * by the stored password hash (stateless). First visit = one-time setup.
 */
const COOKIE = "efi_admin";
const MAXAGE = 28800; // 8h

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return text("D1 binding (DB) missing.", 500);
  await ensure(env);
  const url = new URL(request.url);

  if (url.searchParams.get("logout") === "1") {
    return new Response(loginPage("تم تسجيل الخروج."), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": clearCookie() },
    });
  }

  const cred = await getCred(env);
  if (!cred) return htmlResp(setupPage());
  if (!(await validSession(request, cred))) return htmlResp(loginPage());

  const fmt = url.searchParams.get("format");
  const { results } = await env.DB.prepare(
    "SELECT created_at, name, email, phone, subject, ip FROM leads ORDER BY created_at DESC LIMIT 500"
  ).all();
  const rows = results || [];
  if (fmt === "json") return new Response(JSON.stringify(rows, null, 2), noStore("application/json; charset=utf-8"));
  if (fmt === "csv") return csv(rows);
  return htmlResp(tablePage(rows));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return text("D1 binding (DB) missing.", 500);
  await ensure(env);
  const form = await request.formData();
  const user = (form.get("username") || "").toString().trim();
  const pass = (form.get("password") || "").toString();
  const cred = await getCred(env);

  if (!cred) {
    // one-time setup
    const u = user || "admin";
    if (pass.length < 8) return htmlResp(setupPage("كلمة المرور يجب ألا تقل عن 8 أحرف."), 422);
    const hash = await sha256(pass);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_user', ?)").bind(u).run();
    await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_pwd_hash', ?)").bind(hash).run();
    return redirectWithSession(await makeSession(u, hash));
  }

  // login
  if (user === cred.user && safeEq(await sha256(pass), cred.hash)) {
    return redirectWithSession(await makeSession(cred.user, cred.hash));
  }
  return htmlResp(loginPage("اسم المستخدم أو كلمة المرور غير صحيحة."), 401);
}

/* ── auth ─────────────────────────────────────────────────── */
async function ensure(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)").run();
}
async function getCred(env) {
  const { results } = await env.DB.prepare("SELECT k, v FROM settings WHERE k IN ('admin_user','admin_pwd_hash')").all();
  const m = {}; for (const r of results || []) m[r.k] = r.v;
  return m.admin_pwd_hash ? { user: m.admin_user || "admin", hash: m.admin_pwd_hash } : null;
}
async function makeSession(user, keyHex) {
  const exp = Date.now() + MAXAGE * 1000;
  const payload = `${b64u(user)}.${exp}`;
  return `${payload}.${await hmac(payload, keyHex)}`;
}
async function validSession(request, cred) {
  const cookie = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!cookie) return false;
  const val = cookie.slice(COOKIE.length + 1);
  const parts = val.split(".");
  if (parts.length !== 3) return false;
  const [ub, exp, sig] = parts;
  if (Date.now() > Number(exp)) return false;
  if (ub64(ub) !== cred.user) return false;
  return safeEq(sig, await hmac(`${ub}.${exp}`, cred.hash));
}
function redirectWithSession(session) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/admin/leads",
      "Set-Cookie": `${COOKIE}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${MAXAGE}`,
      "Cache-Control": "no-store",
    },
  });
}
function clearCookie() { return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0`; }
async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", enc(s))); }
async function hmac(msg, keyHex) {
  const key = await crypto.subtle.importKey("raw", enc(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc(msg)));
}
function enc(s) { return new TextEncoder().encode(s); }
function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function ub64(s) { try { return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))); } catch { return ""; } }
function safeEq(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/* ── responses / pages ────────────────────────────────────── */
function noStore(type) { return { headers: { "Content-Type": type, "Cache-Control": "no-store" } }; }
function text(t, s) { return new Response(t, { status: s, headers: { "Cache-Control": "no-store" } }); }
function htmlResp(h, s = 200) { return new Response(h, { status: s, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function csv(rows) {
  const cols = ["created_at", "name", "email", "phone", "subject", "ip"];
  const out = [cols.join(",")].concat(rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
  return new Response("﻿" + out, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="leads.csv"', "Cache-Control": "no-store" } });
}
const SHELL = (title, inner) => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
h1{color:#fff}a.btn,button{background:#1e3a8a;color:#fff;border:0;text-decoration:none;padding:10px 18px;border-radius:8px;margin:0 0 16px 8px;cursor:pointer;font-size:15px}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}
th,td{padding:10px 12px;border-bottom:1px solid #334155;text-align:right;font-size:14px}th{background:#0b1220;color:#93c5fd}
.muted{color:#94a3b8}label{display:block;margin:12px 0 6px}input{width:100%;max-width:360px;padding:10px;border-radius:8px;border:1px solid #334155;background:#0b1220;color:#fff}
.card{max-width:420px;background:#1e293b;padding:24px;border-radius:12px}.err{color:#f87171}</style></head><body>${inner}</body></html>`;
function loginPage(msg) {
  return SHELL("دخول لوحة الطلبات", `<div class="card"><h1>دخول اللوحة</h1>
  ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
  <form method="POST"><label>اسم المستخدم</label><input name="username" autocomplete="username">
  <label>كلمة المرور</label><input name="password" type="password" autocomplete="current-password" required>
  <div style="margin-top:18px"><button type="submit">دخول</button></div></form></div>`);
}
function setupPage(err) {
  return SHELL("تهيئة لوحة الطلبات", `<div class="card"><h1>تهيئة لوحة الطلبات</h1>
  <p class="muted">أوّل زيارة — اختر اسم مستخدم وكلمة مرور (تُخزَّن مُجزّأة).</p>
  ${err ? `<p class="err">${esc(err)}</p>` : ""}
  <form method="POST"><label>اسم المستخدم</label><input name="username" value="admin" autocomplete="username">
  <label>كلمة المرور (8 أحرف على الأقل)</label><input name="password" type="password" autocomplete="new-password" required>
  <div style="margin-top:18px"><button type="submit">حفظ وتفعيل</button></div></form></div>`);
}
function tablePage(rows) {
  const trs = rows.map((r) => `<tr><td>${esc(r.created_at)}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${esc(r.subject)}</td><td>${esc(r.ip)}</td></tr>`).join("");
  return SHELL("طلبات الموقع", `<h1>طلبات الموقع (${rows.length})</h1>
  <a class="btn" href="/admin/leads?format=csv">تنزيل CSV</a><a class="btn" href="/admin/leads">تحديث</a><a class="btn" href="/admin/leads?logout=1" style="background:#334155">خروج</a>
  <table><thead><tr><th>التاريخ</th><th>الاسم</th><th>البريد</th><th>الهاتف</th><th>الموضوع</th><th>IP</th></tr></thead>
  <tbody>${trs || '<tr><td colspan="6" class="muted">لا توجد طلبات بعد.</td></tr>'}</tbody></table>`);
}

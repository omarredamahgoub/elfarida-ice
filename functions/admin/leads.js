/**
 * /admin/leads — protected viewer for quote/contact leads in D1.
 * Auth is stored in D1 (settings table), NOT env, to avoid Pages secret-injection
 * quirks. First visit shows a one-time setup form to choose username + password
 * (stored as SHA-256 hash). Afterwards: HTTP Basic auth.
 *   GET  /admin/leads            -> setup page (if unconfigured) | login | table
 *   GET  /admin/leads?format=csv -> CSV export (authed)
 *   POST /admin/leads            -> one-time setup (only when unconfigured)
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return text("D1 binding (DB) missing.", 500);
  await ensure(env);

  const cred = await getCred(env);
  if (!cred) return htmlResp(setupPage());

  if (!(await authed(request, cred))) {
    return new Response("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Elfarida Leads", charset="UTF-8"' },
    });
  }

  const fmt = new URL(request.url).searchParams.get("format");
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
  if (await getCred(env)) return text("Already configured.", 403);

  const form = await request.formData();
  const user = (form.get("username") || "admin").toString().trim() || "admin";
  const pass = (form.get("password") || "").toString();
  if (pass.length < 8) return htmlResp(setupPage("كلمة المرور يجب ألا تقل عن 8 أحرف."), 422);

  const hash = await sha256(pass);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_user', ?)").bind(user).run();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_pwd_hash', ?)").bind(hash).run();
  return new Response(setupDone(), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/* ── data helpers ─────────────────────────────────────────── */
async function ensure(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)").run();
}
async function getCred(env) {
  const { results } = await env.DB.prepare("SELECT k, v FROM settings WHERE k IN ('admin_user','admin_pwd_hash')").all();
  const m = {};
  for (const r of results || []) m[r.k] = r.v;
  if (!m.admin_pwd_hash) return null;
  return { user: m.admin_user || "admin", hash: m.admin_pwd_hash };
}
async function authed(request, cred) {
  const hdr = request.headers.get("Authorization") || "";
  if (!hdr.startsWith("Basic ")) return false;
  let dec = "";
  try { dec = atob(hdr.slice(6)); } catch { return false; }
  const i = dec.indexOf(":");
  const u = dec.slice(0, i), p = dec.slice(i + 1);
  return u === cred.user && safeEq(await sha256(p), cred.hash);
}
async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ── responses ────────────────────────────────────────────── */
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
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title><style>body{font-family:system-ui,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
h1{color:#fff}a.btn,button{background:#1e3a8a;color:#fff;border:0;text-decoration:none;padding:10px 18px;border-radius:8px;margin:0 0 16px 8px;cursor:pointer;font-size:15px}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}
th,td{padding:10px 12px;border-bottom:1px solid #334155;text-align:right;font-size:14px}
th{background:#0b1220;color:#93c5fd}.muted{color:#94a3b8}label{display:block;margin:12px 0 6px}
input{width:100%;max-width:360px;padding:10px;border-radius:8px;border:1px solid #334155;background:#0b1220;color:#fff}
.card{max-width:420px;background:#1e293b;padding:24px;border-radius:12px}</style></head><body>${inner}</body></html>`;
function setupPage(err) {
  return SHELL("تهيئة لوحة الطلبات", `<h1>تهيئة لوحة الطلبات</h1>
  <p class="muted">هذه أوّل زيارة — اختر اسم مستخدم وكلمة مرور لحماية اللوحة (تُخزَّن مُجزّأة بأمان).</p>
  ${err ? `<p style="color:#f87171">${esc(err)}</p>` : ""}
  <form method="POST" class="card"><label>اسم المستخدم</label><input name="username" value="admin" autocomplete="username">
  <label>كلمة المرور (8 أحرف على الأقل)</label><input name="password" type="password" autocomplete="new-password" required>
  <div style="margin-top:18px"><button type="submit">حفظ وتفعيل</button></div></form>`);
}
function setupDone() {
  return SHELL("تمّت التهيئة", `<h1>تمّت التهيئة بنجاح</h1>
  <p class="muted">احفظ بياناتك. افتح اللوحة الآن وسجّل الدخول.</p><a class="btn" href="/admin/leads">فتح اللوحة</a>`);
}
function tablePage(rows) {
  const trs = rows.map((r) => `<tr><td>${esc(r.created_at)}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${esc(r.subject)}</td><td>${esc(r.ip)}</td></tr>`).join("");
  return SHELL("طلبات الموقع", `<h1>طلبات الموقع (${rows.length})</h1>
  <a class="btn" href="/admin/leads?format=csv">تنزيل CSV</a><a class="btn" href="/admin/leads">تحديث</a>
  <table><thead><tr><th>التاريخ</th><th>الاسم</th><th>البريد</th><th>الهاتف</th><th>الموضوع</th><th>IP</th></tr></thead>
  <tbody>${trs || '<tr><td colspan="6" class="muted">لا توجد طلبات بعد.</td></tr>'}</tbody></table>`);
}

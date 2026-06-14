/**
 * GET /admin/leads — protected viewer for quote/contact leads stored in D1.
 * Auth: HTTP Basic. Credentials from env secrets ADMIN_USER (default "admin")
 *       and ADMIN_PASSWORD (required — fails closed if unset).
 * Query: ?format=json | ?format=csv  (default: HTML table). 100% Cloudflare.
 */
export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.ADMIN_PASSWORD) {
    return new Response("Admin panel not configured. Set ADMIN_PASSWORD secret.", { status: 503 });
  }
  if (!authorized(request, env)) {
    return new Response("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Elfarida Leads", charset="UTF-8"' },
    });
  }
  if (!env.DB) return new Response("D1 binding (DB) missing.", { status: 500 });

  const fmt = new URL(request.url).searchParams.get("format");
  const { results } = await env.DB.prepare(
    "SELECT created_at, name, email, phone, subject, payload, ip FROM leads ORDER BY created_at DESC LIMIT 500"
  ).all();
  const rows = results || [];

  if (fmt === "json") return body(JSON.stringify(rows, null, 2), "application/json; charset=utf-8");
  if (fmt === "csv") return csv(rows);
  return body(htmlPage(rows), "text/html; charset=utf-8");
}

function authorized(request, env) {
  const hdr = request.headers.get("Authorization") || "";
  if (!hdr.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = atob(hdr.slice(6)); } catch { return false; }
  const i = decoded.indexOf(":");
  return safeEqual(decoded.slice(0, i), env.ADMIN_USER || "admin") &&
         safeEqual(decoded.slice(i + 1), env.ADMIN_PASSWORD);
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function body(text, type) {
  return new Response(text, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}

function csv(rows) {
  const cols = ["created_at", "name", "email", "phone", "subject", "ip"];
  const out = [cols.join(",")].concat(
    rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))
  ).join("\n");
  return new Response("﻿" + out, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="leads.csv"',
      "Cache-Control": "no-store",
    },
  });
}

function htmlPage(rows) {
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const trs = rows.map((r) =>
    `<tr><td>${esc(r.created_at)}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${esc(r.subject)}</td><td>${esc(r.ip)}</td></tr>`
  ).join("");
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>طلبات الموقع — الفريدة آيس</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
h1{color:#fff}a.btn{display:inline-block;background:#1e3a8a;color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;margin:0 8px 16px 0}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}
th,td{padding:10px 12px;border-bottom:1px solid #334155;text-align:right;font-size:14px}
th{background:#0b1220;color:#93c5fd}tr:hover td{background:#243449}.muted{color:#94a3b8}</style></head>
<body><h1>طلبات الموقع (${rows.length})</h1>
<a class="btn" href="/admin/leads?format=csv">تنزيل CSV</a><a class="btn" href="/admin/leads">تحديث</a>
<table><thead><tr><th>التاريخ</th><th>الاسم</th><th>البريد</th><th>الهاتف</th><th>الموضوع</th><th>IP</th></tr></thead>
<tbody>${trs || '<tr><td colspan="6" class="muted">لا توجد طلبات بعد.</td></tr>'}</tbody></table></body></html>`;
}

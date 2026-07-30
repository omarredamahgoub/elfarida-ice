/**
 * /admin/leads — protected leads viewer (D1-backed auth, in-page form login).
 * No env secrets, no Basic-Auth popup. Session = cookie signed with HMAC keyed
 * by the stored password hash (stateless). First visit = one-time setup.
 *
 * Updated 2026-07-05:
 *   - Brute-force protection on login (per-IP sliding-window rate limit).
 *   - Lead status tracking (new / contacted / closed).
 *   - Search + status filter over the table.
 *   - Clickable tel: / mailto: / wa.me links.
 *   - Times shown in Asia/Riyadh instead of raw UTC.
 *   - Per-row delete action.
 *   - "New in last 24h" row highlight + quick stats bar.
 *   - Mobile-responsive table layout.
 *
 * Updated 2026-07-05 (part 2):
 *   - Pagination (25 rows/page) over the filtered result set.
 *   - Sortable columns (date / name / status), stable sort.
 *   - Repeat-customer badge (same phone or email seen more than once
 *     among the most recently loaded leads).
 *   - Internal per-lead notes, editable inline.
 *   - Admin password change from within the panel (/admin/leads?settings=1).
 *
 * All schema changes are self-migrating inside ensure(env): the
 * "leads.status", "leads.notes" columns and the "admin_login_attempts"
 * table are created on first use after deploy, idempotently. No manual
 * wrangler command is required for this update.
 */
import {
  STATUS_OPTIONS,
  DEFAULT_STATUS,
  STATUS_LABELS_AR,
  isValidStatus,
  isValidUuid,
  esc,
  isRateLimited,
  matchesQuery,
  matchesStatus,
  toRiyadhDisplay,
  isRecent,
  computeStats,
  buildTelHref,
  buildWaHref,
  buildMailtoHref,
  paginate,
  sortRows,
  toggleSortDir,
  markDuplicates,
  isValidNewPassword,
  buildQueryString,
} from "./_leads-lib.js";

const COOKIE = "efi_admin";
const MAXAGE = 28800; // 8h
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return text("D1 binding (DB) missing.", 500);
  await ensure(env);
  const url = new URL(request.url);

  if (url.searchParams.get("logout") === "1") {
    return new Response(loginPage("تم تسجيل الخروج."), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": clearCookie(),
      },
    });
  }

  const cred = await getCred(env);
  if (!cred) return htmlResp(setupPage());
  if (!(await validSession(request, cred))) return htmlResp(loginPage());

  if (url.searchParams.get("settings") === "1") {
    const ok = url.searchParams.get("ok") === "1";
    return htmlResp(securityPage(ok ? "تم تحديث كلمة المرور بنجاح." : ""));
  }

  const fmt = url.searchParams.get("format");
  const q = url.searchParams.get("q") || "";
  const statusFilter = url.searchParams.get("status") || "";
  const sortField = url.searchParams.get("sort") || "created_at";
  const sortDir = url.searchParams.get("dir") || "desc";
  const page = url.searchParams.get("page");
  const returnParams = new URLSearchParams(url.searchParams);
  returnParams.delete("format");
  const returnQs = returnParams.toString();

  const { results } = await env.DB.prepare(
    "SELECT id, created_at, name, email, phone, subject, ip, status, notes FROM leads ORDER BY created_at DESC LIMIT 500"
  ).all();
  const rows = results || [];
  const stats = computeStats(rows, new Date());
  const decorated = markDuplicates(rows);
  const filtered = decorated.filter((r) => matchesQuery(r, q) && matchesStatus(r, statusFilter));

  if (fmt === "json")
    return new Response(
      JSON.stringify(filtered, null, 2),
      noStore("application/json; charset=utf-8")
    );
  if (fmt === "csv") return csv(filtered);

  const sorted = sortRows(filtered, sortField, sortDir);
  const { pageRows, page: currentPage, totalPages } = paginate(sorted, page);

  return htmlResp(
    tablePage(pageRows, {
      stats,
      filters: { q, status: statusFilter, sort: sortField, dir: sortDir },
      filteredCount: filtered.length,
      rawTotalCount: rows.length,
      page: currentPage,
      totalPages,
      returnQs,
    })
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return text("D1 binding (DB) missing.", 500);
  await ensure(env);
  const form = await request.formData();
  const action = (form.get("_action") || "").toString();
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";

  // ── authenticated row actions: change status / notes / delete a lead ──
  if (action === "update_status" || action === "update_notes" || action === "delete") {
    const cred = await getCred(env);
    if (!cred || !(await validSession(request, cred))) {
      return htmlResp(loginPage("انتهت الجلسة، سجّل الدخول مرة أخرى."), 401);
    }
    const id = (form.get("id") || "").toString();
    if (!isValidUuid(id)) return text("معرّف غير صالح.", 400);
    const returnQs = (form.get("_return") || "").toString();

    if (action === "delete") {
      await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
    } else if (action === "update_notes") {
      const notes = (form.get("notes") || "").toString().slice(0, 2000);
      await env.DB.prepare("UPDATE leads SET notes = ? WHERE id = ?").bind(notes, id).run();
    } else {
      const status = (form.get("status") || "").toString();
      if (!isValidStatus(status)) return text("حالة غير صالحة.", 400);
      await env.DB.prepare("UPDATE leads SET status = ? WHERE id = ?").bind(status, id).run();
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/admin/leads" + (returnQs ? "?" + returnQs : ""),
        "Cache-Control": "no-store",
      },
    });
  }

  // ── admin password change ──
  if (action === "change_password") {
    const cred = await getCred(env);
    if (!cred || !(await validSession(request, cred))) {
      return htmlResp(loginPage("انتهت الجلسة، سجّل الدخول مرة أخرى."), 401);
    }
    const current = (form.get("current_password") || "").toString();
    const next = (form.get("new_password") || "").toString();
    if (!safeEq(await sha256(current), cred.hash)) {
      return htmlResp(securityPage("كلمة المرور الحالية غير صحيحة.", true), 401);
    }
    if (!isValidNewPassword(next)) {
      return htmlResp(securityPage("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.", true), 422);
    }
    const newHash = await sha256(next);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_pwd_hash', ?)")
      .bind(newHash)
      .run();
    return redirectWithSession(
      await makeSession(cred.user, newHash),
      "/admin/leads?settings=1&ok=1"
    );
  }

  // ── login / one-time setup ──
  const user = (form.get("username") || "").toString().trim();
  const pass = (form.get("password") || "").toString();
  const cred = await getCred(env);

  if (!cred) {
    // One-time setup — not rate-limited (no credentials exist yet to brute-force).
    const u = user || "admin";
    if (!isValidNewPassword(pass))
      return htmlResp(setupPage("كلمة المرور يجب ألا تقل عن 8 أحرف."), 422);
    const hash = await sha256(pass);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_user', ?)")
      .bind(u)
      .run();
    await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('admin_pwd_hash', ?)")
      .bind(hash)
      .run();
    return redirectWithSession(await makeSession(u, hash));
  }

  if (await isLoginRateLimited(env, clientIp)) {
    const minutes = Math.ceil(LOGIN_WINDOW_MS / 60000);
    return htmlResp(
      loginPage(
        `محاولات دخول كثيرة وفاشلة من هذا العنوان. يرجى الانتظار ${minutes} دقيقة والمحاولة مجددًا.`
      ),
      429
    );
  }

  if (user === cred.user && safeEq(await sha256(pass), cred.hash)) {
    return redirectWithSession(await makeSession(cred.user, cred.hash));
  }
  await recordFailedLoginAttempt(env, clientIp);
  return htmlResp(loginPage("اسم المستخدم أو كلمة المرور غير صحيحة."), 401);
}

/* ── auth ─────────────────────────────────────────────────── */
async function ensure(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)").run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS admin_login_attempts (ip TEXT NOT NULL, attempted_at TEXT NOT NULL)"
  ).run();
  try {
    await env.DB.prepare("ALTER TABLE leads ADD COLUMN status TEXT NOT NULL DEFAULT 'new'").run();
  } catch (_) {
    // Column already exists from a previous deploy — safe to ignore.
  }
  try {
    await env.DB.prepare("ALTER TABLE leads ADD COLUMN notes TEXT NOT NULL DEFAULT ''").run();
  } catch (_) {
    // Column already exists from a previous deploy — safe to ignore.
  }
}
async function getCred(env) {
  const { results } = await env.DB.prepare(
    "SELECT k, v FROM settings WHERE k IN ('admin_user','admin_pwd_hash')"
  ).all();
  const m = {};
  for (const r of results || []) m[r.k] = r.v;
  return m.admin_pwd_hash ? { user: m.admin_user || "admin", hash: m.admin_pwd_hash } : null;
}
async function makeSession(user, keyHex) {
  const exp = Date.now() + MAXAGE * 1000;
  const payload = `${b64u(user)}.${exp}`;
  return `${payload}.${await hmac(payload, keyHex)}`;
}
async function validSession(request, cred) {
  const cookie = (request.headers.get("Cookie") || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(COOKIE + "="));
  if (!cookie) return false;
  const val = cookie.slice(COOKIE.length + 1);
  const parts = val.split(".");
  if (parts.length !== 3) return false;
  const [ub, exp, sig] = parts;
  if (Date.now() > Number(exp)) return false;
  if (ub64(ub) !== cred.user) return false;
  return safeEq(sig, await hmac(`${ub}.${exp}`, cred.hash));
}
function redirectWithSession(session, location = "/admin/leads") {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Set-Cookie": `${COOKIE}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${MAXAGE}`,
      "Cache-Control": "no-store",
    },
  });
}
function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0`;
}
async function sha256(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc(s)));
}
async function hmac(msg, keyHex) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc(keyHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, enc(msg)));
}
function enc(s) {
  return new TextEncoder().encode(s);
}
function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64u(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function ub64(s) {
  try {
    return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return "";
  }
}
function safeEq(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ── brute-force protection ──────────────────────────────── */
async function isLoginRateLimited(env, ip) {
  const now = new Date();
  const cutoffIso = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
  try {
    await env.DB.prepare("DELETE FROM admin_login_attempts WHERE attempted_at <= ?")
      .bind(cutoffIso)
      .run();
  } catch (_) {
    /* non-fatal housekeeping */
  }
  const { results } = await env.DB.prepare(
    "SELECT attempted_at FROM admin_login_attempts WHERE ip = ? AND attempted_at > ?"
  )
    .bind(ip, cutoffIso)
    .all();
  const timestamps = (results || []).map((r) => r.attempted_at);
  return isRateLimited(timestamps, now, LOGIN_WINDOW_MS, MAX_LOGIN_ATTEMPTS);
}
async function recordFailedLoginAttempt(env, ip) {
  await env.DB.prepare("INSERT INTO admin_login_attempts (ip, attempted_at) VALUES (?, ?)")
    .bind(ip, new Date().toISOString())
    .run();
}

/* ── responses / pages ────────────────────────────────────── */
function noStore(type) {
  return { headers: { "Content-Type": type, "Cache-Control": "no-store" } };
}
function text(t, s) {
  return new Response(t, {
    status: s,
    headers: { "Cache-Control": "no-store" },
  });
}
function htmlResp(h, s = 200) {
  return new Response(h, {
    status: s,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
function csv(rows) {
  const cols = ["created_at", "status", "name", "email", "phone", "subject", "ip", "notes"];
  const out = [cols.join(",")]
    .concat(
      rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))
    )
    .join("\n");
  return new Response("﻿" + out, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="leads.csv"',
      "Cache-Control": "no-store",
    },
  });
}

const SHELL = (
  title,
  inner
) => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>
:root{--bg:#0e1522;--panel:#1a2436;--panel-alt:#161f30;--panel-2:#0b1220;--border:#2c3b52;--text:#dbe2ea;--muted:#8a97a8;--link:#7fa8d9;--link-hover:#bcd4f2;--accent:#5a8fce;--primary:#28406e;--primary-hover:#33508a}
*{box-sizing:border-box}
body{font-family:system-ui,Tahoma,sans-serif;-webkit-font-smoothing:antialiased;background:var(--bg);color:var(--text);margin:0;padding:24px 24px 48px;line-height:1.5}
h1{color:var(--text);margin:0 0 20px;font-size:21px;font-weight:600}
a.btn,button{background:var(--primary);color:#eef2f8;border:0;text-decoration:none;padding:9px 16px;border-radius:8px;cursor:pointer;font-size:14px;line-height:1.2;display:inline-flex;align-items:center}
a.btn:hover,button:hover{background:var(--primary-hover)}
.btn-secondary{background:var(--panel-alt);border:1px solid var(--border)}
.btn-secondary:hover{background:#202c42}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:20px}
.toolbar-account{display:flex;gap:8px;margin-inline-start:auto}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;background:var(--panel);border-radius:10px;overflow:hidden}
th,td{padding:12px;border-bottom:1px solid var(--border);text-align:right;font-size:13.5px;vertical-align:middle;line-height:1.5}
th{background:var(--panel-2);color:var(--muted);font-weight:600;white-space:nowrap;font-size:12.5px;letter-spacing:.02em}
th a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
th a:hover{color:var(--text)}
.sort-indicator{color:var(--link);font-size:10px}
tbody tr:nth-child(even){background:var(--panel-alt)}
tbody tr{transition:background .12s ease}
tbody tr:hover{background:#243450}
tr.row--new{background:#213754}
tr.row--new:hover{background:#28405f}
.muted{color:var(--muted)}
label{display:block;margin:12px 0 6px;font-size:14px;color:var(--muted)}
input{width:100%;max-width:360px;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--panel-2);color:var(--text);font-family:inherit}
.card{max-width:420px;background:var(--panel);border:1px solid var(--border);padding:24px;border-radius:12px}
.err{color:#f29b9b}
.stats{display:flex;gap:12px;flex-wrap:wrap}
.stat{background:var(--panel-2);padding:8px 14px;border-radius:8px;font-size:13.5px;border:1px solid var(--border);color:var(--muted)}
.stat b{color:var(--text);font-size:15px;font-weight:600}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0}
.filters input[type=text]{flex:1;min-width:220px;padding:8px 10px;margin:0;width:auto}
.filters select{padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--panel-2);color:var(--text)}
td a{color:var(--link);text-decoration:none;border-bottom:1px dotted rgba(127,168,217,.4)}
td a:visited{color:var(--link)}
td a:hover,td a:focus-visible{color:var(--link-hover);border-bottom-color:var(--link-hover)}
.status-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;margin-bottom:6px;white-space:nowrap}
.status-badge--new{background:#1f3a63;color:#a9c6ea}
.status-badge--contacted{background:#5c4423;color:#e3c78d}
.status-badge--closed{background:#33404f;color:#adb9c7}
.inline-form{display:flex;gap:6px;align-items:center;margin:0;flex-wrap:wrap}
.inline-form select,.inline-form input[type=text]{padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--panel-2);color:var(--text);font-size:12.5px;width:auto;margin:0}
.btn-sm{background:var(--primary);color:#eef2f8;border:0;border-radius:6px;padding:6px 10px;font-size:12.5px;cursor:pointer;margin:0}
.btn-sm:hover{background:var(--primary-hover)}
.btn-danger{background:#5f2323}
.btn-danger:hover{background:#7a2d2d}
.wa-link{color:#4fae86;font-size:11.5px;margin-inline-start:6px;white-space:nowrap;border-bottom:none}
.dup-badge{background:#5c3a1e;color:#e3b98d;font-size:10.5px;padding:2px 6px;border-radius:999px;margin-inline-start:6px;white-space:nowrap;font-weight:600}
.pagination{display:flex;gap:10px;align-items:center;margin:20px 0 0}
@media (max-width:768px){
  table,thead,tbody,th,td,tr{display:block}
  thead{display:none}
  table{background:transparent}
  tbody tr:nth-child(even){background:var(--panel)}
  tr{margin-bottom:12px;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--panel)}
  td{border:none;position:relative;padding-inline-start:45%;text-align:right;min-height:24px}
  td:before{content:attr(data-label);position:absolute;inset-inline-start:8px;top:12px;white-space:nowrap;font-weight:700;color:var(--muted)}
}
</style></head><body>${inner}</body></html>`;

function loginPage(msg) {
  return SHELL(
    "دخول لوحة الطلبات",
    `<div class="card"><h1>دخول اللوحة</h1>
  ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
  <form method="POST"><label>اسم المستخدم</label><input name="username" autocomplete="username">
  <label>كلمة المرور</label><input name="password" type="password" autocomplete="current-password" required>
  <div style="margin-top:18px"><button type="submit">دخول</button></div></form></div>`
  );
}
function setupPage(err) {
  return SHELL(
    "تهيئة لوحة الطلبات",
    `<div class="card"><h1>تهيئة لوحة الطلبات</h1>
  <p class="muted">أوّل زيارة — اختر اسم مستخدم وكلمة مرور (تُخزَّن مُجزّأة).</p>
  ${err ? `<p class="err">${esc(err)}</p>` : ""}
  <form method="POST"><label>اسم المستخدم</label><input name="username" value="admin" autocomplete="username">
  <label>كلمة المرور (8 أحرف على الأقل)</label><input name="password" type="password" autocomplete="new-password" required>
  <div style="margin-top:18px"><button type="submit">حفظ وتفعيل</button></div></form></div>`
  );
}

function securityPage(msg, isError) {
  return SHELL(
    "إعدادات الأمان",
    `<div class="card"><h1>إعدادات الأمان</h1>
  ${msg ? `<p class="${isError ? "err" : "muted"}">${esc(msg)}</p>` : ""}
  <form method="POST">
    <input type="hidden" name="_action" value="change_password">
    <label>كلمة المرور الحالية</label><input name="current_password" type="password" autocomplete="current-password" required>
    <label>كلمة المرور الجديدة (8 أحرف على الأقل)</label><input name="new_password" type="password" autocomplete="new-password" required>
    <div style="margin-top:18px"><button type="submit">تحديث كلمة المرور</button></div>
  </form>
  <p style="margin-top:20px"><a class="btn" href="/admin/leads">رجوع للطلبات</a></p>
  </div>`
  );
}

function sortHeader(label, field, filters) {
  const nextDir = toggleSortDir(filters.sort, filters.dir, field);
  const qs = buildQueryString({
    ...filters,
    sort: field,
    dir: nextDir,
    page: 1,
  });
  const indicator =
    filters.sort === field
      ? `<span class="sort-indicator">${filters.dir === "asc" ? "▲" : "▼"}</span>`
      : "";
  return `<th><a href="${esc("/admin/leads?" + qs)}">${esc(label)}${indicator}</a></th>`;
}

function paginationControls(filters, page, totalPages) {
  if (totalPages <= 1) return "";
  const prevQs = buildQueryString({ ...filters, page: page - 1 });
  const nextQs = buildQueryString({ ...filters, page: page + 1 });
  const prev = page > 1 ? `<a class="btn" href="${esc("/admin/leads?" + prevQs)}">السابق</a>` : "";
  const next =
    page < totalPages ? `<a class="btn" href="${esc("/admin/leads?" + nextQs)}">التالي</a>` : "";
  return `<div class="pagination">${prev}<span class="stat">صفحة ${page} من ${totalPages}</span>${next}</div>`;
}

function tablePage(rows, view) {
  const { stats, filters, filteredCount, rawTotalCount, page, totalPages, returnQs } = view;
  const now = new Date();
  const q = filters.q || "";
  const status = filters.status || "";
  const isFiltered = Boolean(q || status);

  const statusOptionsHtml = STATUS_OPTIONS.map(
    (s) =>
      `<option value="${s}"${s === status ? " selected" : ""}>${esc(STATUS_LABELS_AR[s])}</option>`
  ).join("");

  const filterForm = `<form method="GET" action="/admin/leads" class="filters">
    <input type="text" name="q" value="${esc(q)}" placeholder="ابحث بالاسم أو البريد أو الهاتف أو الموضوع">
    <select name="status"><option value="">كل الحالات</option>${statusOptionsHtml}</select>
    <input type="hidden" name="sort" value="${esc(filters.sort)}">
    <input type="hidden" name="dir" value="${esc(filters.dir)}">
    <button type="submit">بحث</button>
    ${isFiltered ? '<a class="btn" href="/admin/leads">إعادة تعيين</a>' : ""}
  </form>`;

  const statsBar = `<div class="panel stats">
    <span class="stat"><b>${stats.today}</b> اليوم</span>
    <span class="stat"><b>${stats.week}</b> هذا الأسبوع</span>
    <span class="stat"><b>${stats.total}</b> الإجمالي</span>
    ${isFiltered ? `<span class="stat">عرض <b>${filteredCount}</b> من ${rawTotalCount}</span>` : ""}
  </div>`;

  const trs = rows
    .map((r) => {
      const recent = isRecent(r.created_at, now, 24);
      const tel = buildTelHref(r.phone);
      const wa = buildWaHref(r.phone);
      const mail = buildMailtoHref(r.email);
      const statusVal = r.status || DEFAULT_STATUS;
      const rowStatusOptions = STATUS_OPTIONS.map(
        (s) =>
          `<option value="${s}"${s === statusVal ? " selected" : ""}>${esc(STATUS_LABELS_AR[s])}</option>`
      ).join("");
      const returnField = `<input type="hidden" name="_return" value="${esc(returnQs)}">`;
      const dupBadge = r.isDuplicate
        ? '<span class="dup-badge" title="نفس الهاتف أو البريد ورد من قبل">مكرر</span>'
        : "";

      return `<tr class="${recent ? "row--new" : ""}">
      <td data-label="التاريخ">${esc(toRiyadhDisplay(r.created_at))}</td>
      <td data-label="الحالة">
        <span class="status-badge status-badge--${statusVal}">${esc(STATUS_LABELS_AR[statusVal])}</span>
        <form method="POST" class="inline-form">
          <input type="hidden" name="_action" value="update_status">
          <input type="hidden" name="id" value="${esc(r.id)}">
          ${returnField}
          <select name="status">${rowStatusOptions}</select>
          <button type="submit" class="btn-sm">تحديث</button>
        </form>
      </td>
      <td data-label="الاسم">${esc(r.name)}${dupBadge}</td>
      <td data-label="البريد">${mail ? `<a href="${esc(mail)}">${esc(r.email)}</a>` : esc(r.email)}</td>
      <td data-label="الهاتف">${tel ? `<a href="${esc(tel)}">${esc(r.phone)}</a>` : esc(r.phone)}${wa ? ` <a href="${esc(wa)}" target="_blank" rel="noopener noreferrer" class="wa-link">واتساب</a>` : ""}</td>
      <td data-label="الموضوع">${esc(r.subject)}</td>
      <td data-label="IP">${esc(r.ip)}</td>
      <td data-label="ملاحظات">
        <form method="POST" class="inline-form">
          <input type="hidden" name="_action" value="update_notes">
          <input type="hidden" name="id" value="${esc(r.id)}">
          ${returnField}
          <input type="text" name="notes" value="${esc(r.notes || "")}" placeholder="ملاحظة...">
          <button type="submit" class="btn-sm">حفظ</button>
        </form>
      </td>
      <td data-label="إجراءات">
        <form method="POST" class="inline-form">
          <input type="hidden" name="_action" value="delete">
          <input type="hidden" name="id" value="${esc(r.id)}">
          ${returnField}
          <button type="submit" class="btn-sm btn-danger">حذف</button>
        </form>
      </td>
    </tr>`;
    })
    .join("");

  return SHELL(
    "طلبات الموقع",
    `<h1>طلبات الموقع (${filteredCount})</h1>
  <div class="toolbar">
    <a class="btn" href="${esc("/admin/leads?format=csv" + (returnQs ? "&" + returnQs : ""))}">تنزيل CSV</a>
    <a class="btn" href="${esc("/admin/leads" + (returnQs ? "?" + returnQs : ""))}">تحديث</a>
    <span class="toolbar-account">
      <a class="btn btn-secondary" href="/admin/leads?settings=1">الإعدادات</a>
      <a class="btn btn-secondary" href="/admin/leads?logout=1">خروج</a>
    </span>
  </div>
  ${statsBar}
  <div class="panel">${filterForm}</div>
  <table><thead><tr>
    ${sortHeader("التاريخ", "created_at", filters)}
    ${sortHeader("الحالة", "status", filters)}
    ${sortHeader("الاسم", "name", filters)}
    <th>البريد</th><th>الهاتف</th><th>الموضوع</th><th>IP</th><th>ملاحظات</th><th>إجراءات</th>
  </tr></thead>
  <tbody>${trs || '<tr><td colspan="9" class="muted">لا توجد طلبات مطابقة.</td></tr>'}</tbody></table>
  ${paginationControls(filters, page, totalPages)}`
  );
}

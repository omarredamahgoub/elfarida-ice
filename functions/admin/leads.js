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
import {
  CHANNELS,
  CHANNEL_LABELS_AR,
  channelLabel,
  locationLabel,
  matchesContactQuery,
  matchesChannel,
  channelBreakdown,
  topPages,
  deviceHint,
} from "./_contacts-lib.js";
import {
  shortDayLabel,
  combinedSeries,
  windowCounts,
  hourHistogram,
  weekdayHistogram,
  busiest,
  hourRangeLabel,
  normalizeRef,
  findByRef,
  shareOf,
} from "./_overview-lib.js";

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

  // Contact-intent view: WhatsApp and click-to-call taps recorded by
  // js/conversion-kit.js. Shares this route's session so the owner signs in once.
  if (url.searchParams.get("view") === "contacts") {
    return contactsView(env, url);
  }

  // Newsletter subscribers. These used to be written into `leads`, which made
  // the lead count meaningless; moving them out would have hidden them from the
  // owner entirely, so they get their own view instead.
  if (url.searchParams.get("view") === "newsletter") {
    return newsletterView(env, url);
  }

  // The landing view. A list answers "who contacted us"; the owner opening the
  // panel first needs "is demand rising, when do people actually call, and
  // which page produced it" — questions a table cannot answer at a glance.
  if (!url.searchParams.get("view")) {
    return overviewView(env, url);
  }

  const fmt = url.searchParams.get("format");
  const q = url.searchParams.get("q") || "";
  const statusFilter = url.searchParams.get("status") || "";
  const sortField = url.searchParams.get("sort") || "created_at";
  const sortDir = url.searchParams.get("dir") || "desc";
  const page = url.searchParams.get("page");
  const returnParams = new URLSearchParams(url.searchParams);
  returnParams.delete("format");
  // The table is no longer the landing view, so a row action must carry the
  // view back with it — otherwise saving a status drops the owner on the
  // overview and loses the filter, sort and page he was working through.
  returnParams.set("view", "leads");
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

/**
 * Builds the monitoring overview: the three demand streams on one screen.
 *
 * Both tables are read in full over the window rather than aggregated in SQL,
 * because D1 has no timezone support — grouping by `substr(created_at,1,10)`
 * would cut every bucket at UTC midnight and move Riyadh evening traffic into
 * the following day. The volumes here are small enough that bucketing in JS
 * costs nothing and keeps the logic testable.
 */
async function overviewView(env, url) {
  const now = new Date();
  const since = new Date(now.getTime() - 31 * 86400000).toISOString();

  const { results: leadRows } = await env.DB.prepare(
    "SELECT id, created_at, name, phone, subject, status FROM leads WHERE created_at >= ? ORDER BY created_at DESC LIMIT 2000"
  )
    .bind(since)
    .all();
  const quotes = leadRows || [];

  let contacts = [];
  let contactsPending = false;
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, created_at, ref, channel, location, page, page_title, context FROM contact_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT 5000"
    )
      .bind(since)
      .all();
    contacts = results || [];
  } catch (_) {
    contactsPending = true;
  }

  const whatsapp = contacts.filter((r) => r.channel === "whatsapp");
  const phone = contacts.filter((r) => r.channel === "phone");

  // The reference lookup searches the full table, not just the window: a
  // WhatsApp conversation can surface weeks after the tap that started it.
  const refQuery = (url.searchParams.get("ref") || "").trim();
  let refMatches = [];
  if (refQuery && !contactsPending) {
    const normalized = normalizeRef(refQuery);
    if (normalized) {
      const { results } = await env.DB.prepare(
        "SELECT id, created_at, ref, channel, location, page, page_title, context, ua FROM contact_events WHERE UPPER(ref) = ? ORDER BY created_at DESC LIMIT 25"
      )
        .bind(normalized)
        .all();
      refMatches = findByRef(results || [], normalized);
    }
  }

  return htmlResp(
    overviewPage({
      now,
      contactsPending,
      refQuery,
      refNormalized: normalizeRef(refQuery),
      refMatches,
      counts: {
        quotes: windowCounts(quotes, now),
        whatsapp: windowCounts(whatsapp, now),
        phone: windowCounts(phone, now),
      },
      series: combinedSeries({ quotes, whatsapp, phone }, 30, now),
      hours: hourHistogram(contacts.concat(quotes)),
      weekdays: weekdayHistogram(contacts.concat(quotes)),
      pages: topPages(contacts, 8),
    })
  );
}

/**
 * Renders the contact-intent log: every WhatsApp / click-to-call tap made from
 * the site, with the reference code that also travels inside the visitor's own
 * WhatsApp message.
 */
async function contactsView(env, url) {
  const q = url.searchParams.get("q") || "";
  const channelFilter = url.searchParams.get("channel") || "";
  const page = url.searchParams.get("page");
  const fmt = url.searchParams.get("format");

  let rows;
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, created_at, ref, channel, location, page, page_title, lang, context, ip, ua FROM contact_events ORDER BY created_at DESC LIMIT 1000"
    ).all();
    rows = results || [];
  } catch (_) {
    // Table absent until migration 0002 is applied — show an empty, explained state.
    return htmlResp(contactsPage([], { pending: true }));
  }

  const stats = computeStats(rows, new Date());
  const breakdown = channelBreakdown(rows);
  const pages = topPages(rows, 8);
  const filtered = rows.filter(
    (r) => matchesContactQuery(r, q) && matchesChannel(r, channelFilter)
  );

  if (fmt === "json")
    return new Response(
      JSON.stringify(filtered, null, 2),
      noStore("application/json; charset=utf-8")
    );
  if (fmt === "csv") return contactsCsv(filtered);

  const { pageRows, page: currentPage, totalPages } = paginate(filtered, page);

  return htmlResp(
    contactsPage(pageRows, {
      stats,
      breakdown,
      pages,
      filters: { q, channel: channelFilter },
      filteredCount: filtered.length,
      rawTotalCount: rows.length,
      page: currentPage,
      totalPages,
    })
  );
}

/** Renders the newsletter subscriber list. */
async function newsletterView(env, url) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const page = url.searchParams.get("page");
  const fmt = url.searchParams.get("format");

  let rows;
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, created_at, email, lang, page, status FROM newsletter_subscribers ORDER BY created_at DESC LIMIT 2000"
    ).all();
    rows = results || [];
  } catch (_) {
    // Table absent until migration 0003 is applied — show an explained state
    // rather than a stack trace.
    return htmlResp(newsletterPage([], { pending: true }));
  }

  const stats = computeStats(rows, new Date());
  const filtered = q
    ? rows.filter((r) =>
        String(r.email || "")
          .toLowerCase()
          .includes(q)
      )
    : rows;

  if (fmt === "json")
    return new Response(
      JSON.stringify(filtered, null, 2),
      noStore("application/json; charset=utf-8")
    );
  if (fmt === "csv") return newsletterCsv(filtered);

  const { pageRows, page: currentPage, totalPages } = paginate(filtered, page);

  return htmlResp(
    newsletterPage(pageRows, {
      stats,
      filters: { q },
      filteredCount: filtered.length,
      rawTotalCount: rows.length,
      page: currentPage,
      totalPages,
    })
  );
}

function newsletterCsv(rows) {
  const head = ["created_at", "email", "lang", "page", "status"];
  const esq = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const body = rows
    .map((r) => head.map((k) => esq(k === "created_at" ? toRiyadhDisplay(r[k]) : r[k])).join(","))
    .join("\n");
  return new Response("﻿" + head.join(",") + "\n" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="newsletter-subscribers.csv"',
      "Cache-Control": "no-store",
    },
  });
}

function newsletterPage(rows, view) {
  if (view.pending) {
    return SHELL(
      "النشرة البريدية",
      `<h1>النشرة البريدية</h1>${viewNav("newsletter")}
      <div class="panel">
        <p>جدول <code>newsletter_subscribers</code> غير موجود بعد.</p>
        <p class="muted">نفّذ الأمر التالي مرة واحدة لتفعيل فصل النشرة عن طلبات العملاء:</p>
        <p><code>npx wrangler d1 execute elfarida-leads --remote --file=migrations/0003_newsletter_subscribers.sql</code></p>
      </div>`
    );
  }

  const { stats, filters, filteredCount, rawTotalCount, page, totalPages } = view;
  const q = filters.q || "";
  const now = new Date();

  const trs = rows
    .map(
      (r) => `<tr class="${isRecent(r.created_at, now, 24) ? "row--new" : ""}">
      <td data-label="التاريخ">${esc(toRiyadhDisplay(r.created_at))}</td>
      <td data-label="البريد"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
      <td data-label="اللغة">${esc(r.lang || "—")}</td>
      <td data-label="الحالة">${esc(r.status || "subscribed")}</td>
    </tr>`
    )
    .join("");

  return SHELL(
    "النشرة البريدية",
    `<h1>النشرة البريدية</h1>
    ${viewNav("newsletter")}
    <div class="panel stats">
      <span class="stat"><b>${stats.today}</b> اليوم</span>
      <span class="stat"><b>${stats.week}</b> هذا الأسبوع</span>
      <span class="stat"><b>${stats.total}</b> الإجمالي</span>
      ${q ? `<span class="stat">عرض <b>${filteredCount}</b> من ${rawTotalCount}</span>` : ""}
    </div>
    <div class="panel">
      <form method="GET" action="/admin/leads" class="filters">
        <input type="hidden" name="view" value="newsletter">
        <input type="text" name="q" value="${esc(q)}" placeholder="ابحث ببريد إلكتروني">
        <button type="submit">بحث</button>
        ${q ? '<a class="btn" href="/admin/leads?view=newsletter">إعادة تعيين</a>' : ""}
      </form>
    </div>
    <div class="toolbar">
      <a class="btn btn-secondary" href="/admin/leads?view=newsletter&format=csv${q ? "&q=" + encodeURIComponent(q) : ""}">تصدير CSV</a>
      <a class="btn btn-secondary" href="/admin/leads?view=newsletter&format=json">JSON</a>
    </div>
    <div class="panel" style="padding:12px 16px">
      <p class="muted" style="margin:0;font-size:13px">
        المشتركون في النشرة لم يطلبوا عرض سعر. فصلهم عن جدول العملاء يجعل عدد
        الطلبات في الصفحة الأولى رقماً حقيقياً يمكن الاعتماد عليه.
      </p>
    </div>
    ${
      rows.length
        ? `<table><thead><tr><th>التاريخ</th><th>البريد</th><th>اللغة</th><th>الحالة</th></tr></thead>
           <tbody>${trs}</tbody></table>${paginationControlsFor("newsletter", filters, page, totalPages)}`
        : `<div class="panel"><p class="muted">${q ? "لا نتائج مطابقة." : "لا يوجد مشتركون بعد."}</p></div>`
    }`
  );
}

function contactsCsv(rows) {
  const head = ["created_at", "ref", "channel", "location", "page", "page_title", "context", "ip"];
  const esq = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const body = rows
    .map((r) => head.map((k) => esq(k === "created_at" ? toRiyadhDisplay(r[k]) : r[k])).join(","))
    .join("\n");
  return new Response("﻿" + head.join(",") + "\n" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="contact-events.csv"',
      "Cache-Control": "no-store",
    },
  });
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
  // Mirrors migrations/0002_contact_events.sql so the contact log works on first
  // load without a manual migration step.
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS contact_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ref TEXT, channel TEXT NOT NULL, location TEXT, page TEXT, page_title TEXT, lang TEXT, context TEXT, referrer TEXT, ip TEXT, ua TEXT)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_contact_events_created_at ON contact_events (created_at)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_contact_events_ref ON contact_events (ref)"
  ).run();
  // Mirrors migrations/0003_newsletter_subscribers.sql, for the same reason.
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS newsletter_subscribers (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, email TEXT NOT NULL UNIQUE, lang TEXT, page TEXT, status TEXT NOT NULL DEFAULT 'subscribed', ip TEXT, ua TEXT)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_newsletter_created_at ON newsletter_subscribers (created_at)"
  ).run();
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
/* ── overview ── */
h2{font-size:15px;font-weight:600;margin:0;color:var(--text)}
.panel__head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.panel__head .muted{font-size:12.5px}
.refbox{margin-bottom:20px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-bottom:20px}
.kpi{position:relative;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px 14px}
.kpi__dot{position:absolute;inset-block-start:16px;inset-inline-end:16px;width:10px;height:10px;border-radius:50%}
.kpi__head{color:var(--muted);font-size:13px;margin-bottom:10px}
.kpi__today{font-size:13px;color:var(--muted);margin-bottom:10px}
.kpi__today b{color:var(--text);font-size:28px;font-weight:700;margin-inline-end:6px;line-height:1}
.kpi__row{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);padding-top:7px;border-top:1px solid var(--border)}
.kpi__row b{color:var(--text);font-size:14px;margin-inline-start:auto}
.kpi__row .trend{margin-inline-start:0}
.trend{font-size:11.5px;font-weight:600;white-space:nowrap}
.trend--up{color:#6fbf98}
.trend--down{color:#e09b9b}
.trend--flat{color:var(--muted)}
[data-stream=quotes]{background:#5a8fce}
[data-stream=whatsapp]{background:#4fae86}
[data-stream=phone]{background:#e0a458}
.chart{width:100%;height:auto;display:block;overflow:visible}
.chart .ax{fill:#8a97a8;font-size:11px;font-family:system-ui,Tahoma,sans-serif}
.chart .grid{stroke:#2c3b52;stroke-width:1}
.chart-note{font-size:12px;margin:10px 0 0}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12.5px;color:var(--muted)}
.legend__item{display:inline-flex;align-items:center;gap:6px}
.legend__item i{width:10px;height:10px;border-radius:3px;display:inline-block}
.sharebar{display:flex;height:34px;border-radius:8px;overflow:hidden;background:var(--panel-2);border:1px solid var(--border)}
.sharebar__seg{display:flex;align-items:center;justify-content:center;min-width:0}
.sharebar__seg b{color:#0e1522;font-size:12px;font-weight:700;padding:0 4px;white-space:nowrap}
/* URLs and reference codes are Latin runs inside Arabic text: without bidi
   isolation the leading slash of a path is reordered to the end, so
   /cold-rooms-dammam is displayed to the owner as cold-rooms-dammam/ */
.path{display:inline-block;unicode-bidi:isolate;direction:ltr;font-size:12px}
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
  <p style="margin-top:20px"><a class="btn" href="/admin/leads">رجوع للوحة</a></p>
  </div>`
  );
}

function sortHeader(label, field, filters) {
  const nextDir = toggleSortDir(filters.sort, filters.dir, field);
  const qs = buildQueryString({
    view: "leads",
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
  const prevQs = buildQueryString({ view: "leads", ...filters, page: page - 1 });
  const nextQs = buildQueryString({ view: "leads", ...filters, page: page + 1 });
  const prev = page > 1 ? `<a class="btn" href="${esc("/admin/leads?" + prevQs)}">السابق</a>` : "";
  const next =
    page < totalPages ? `<a class="btn" href="${esc("/admin/leads?" + nextQs)}">التالي</a>` : "";
  return `<div class="pagination">${prev}<span class="stat">صفحة ${page} من ${totalPages}</span>${next}</div>`;
}

/** Tab strip shared by every view, so each is one click from the others. */
function viewNav(active) {
  const tab = (href, label, key) =>
    `<a class="btn ${active === key ? "" : "btn-secondary"}" href="${href}">${label}</a>`;
  return `<div class="toolbar">
    ${tab("/admin/leads", "المراقبة", "overview")}
    ${tab("/admin/leads?view=leads", "طلبات النماذج", "leads")}
    ${tab("/admin/leads?view=contacts", "واتساب ومكالمات", "contacts")}
    ${tab("/admin/leads?view=newsletter", "النشرة البريدية", "newsletter")}
    <div class="toolbar-account">
      <a class="btn btn-secondary" href="/admin/leads?settings=1">الأمان</a>
      <a class="btn btn-secondary" href="/admin/leads?logout=1">خروج</a>
    </div>
  </div>`;
}

/* ── overview rendering ───────────────────────────────────── */

const STREAM_COLORS = { quotes: "#5a8fce", whatsapp: "#4fae86", phone: "#e0a458" };
const STREAM_LABELS = { quotes: "طلبات النماذج", whatsapp: "واتساب", phone: "مكالمات" };

/** A signed, coloured change indicator, or a dash when there is no baseline. */
function trendBadge(pct) {
  if (pct == null) return '<span class="trend trend--flat">—</span>';
  if (pct === 0) return '<span class="trend trend--flat">بلا تغيّر</span>';
  const up = pct > 0;
  return `<span class="trend trend--${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
}

/**
 * Stacked daily volume for the last 30 days.
 *
 * Stacked rather than grouped: the owner's first question is whether total
 * demand is moving, and the second is which channel moved it. Grouped bars
 * answer the second well and the first badly.
 */
function dailyChart(series) {
  const W = 960;
  const H = 230;
  const padTop = 14;
  const padBottom = 30;
  const plot = H - padTop - padBottom;
  const max = Math.max(1, ...series.map((d) => d.total));
  const slot = W / Math.max(1, series.length);
  const barW = Math.min(20, slot * 0.62);

  const bars = series
    .map((d, i) => {
      const cx = slot * i + slot / 2;
      const x = cx - barW / 2;
      let y = padTop + plot;
      const seg = (value, fill) => {
        if (!value) return "";
        const h = (value / max) * plot;
        y -= h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" rx="2"><title>${esc(d.key)} — ${value}</title></rect>`;
      };
      return (
        seg(d.phone, STREAM_COLORS.phone) +
        seg(d.whatsapp, STREAM_COLORS.whatsapp) +
        seg(d.quotes, STREAM_COLORS.quotes)
      );
    })
    .join("");

  const labels = series
    .map((d, i) =>
      i % 5 === 0 || i === series.length - 1
        ? `<text x="${(slot * i + slot / 2).toFixed(1)}" y="${H - 10}" class="ax" text-anchor="middle">${esc(shortDayLabel(d.key))}</text>`
        : ""
    )
    .join("");

  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = padTop + plot - f * plot;
      return `<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" class="grid"/><text x="${W - 4}" y="${(y - 4).toFixed(1)}" class="ax" text-anchor="end">${Math.round(f * max)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="حجم التواصل اليومي خلال آخر 30 يوماً">${grid}${bars}${labels}</svg>`;
}

/** A single-series histogram used for both the hour and weekday breakdowns. */
function histogramChart(buckets, labelFor, fill, ariaLabel, highlightIndex) {
  const W = 960;
  const H = 150;
  const padTop = 10;
  const padBottom = 26;
  const plot = H - padTop - padBottom;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const slot = W / Math.max(1, buckets.length);
  const barW = Math.min(46, slot * 0.66);

  const bars = buckets
    .map((b, i) => {
      const h = (b.count / max) * plot;
      const x = slot * i + (slot - barW) / 2;
      const y = padTop + plot - h;
      const dim = b.count === 0;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, dim ? 2 : h).toFixed(1)}" fill="${i === highlightIndex ? "#d4e3f5" : fill}" opacity="${dim ? 0.18 : 1}" rx="2"><title>${esc(labelFor(b))} — ${b.count}</title></rect>`;
    })
    .join("");

  const labels = buckets
    .map((b, i) =>
      buckets.length <= 8 || i % 2 === 0
        ? `<text x="${(slot * i + slot / 2).toFixed(1)}" y="${H - 8}" class="ax" text-anchor="middle">${esc(labelFor(b, true))}</text>`
        : ""
    )
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(ariaLabel)}">${bars}${labels}</svg>`;
}

function overviewPage(view) {
  const { counts, series, hours, weekdays, pages, refQuery, refNormalized, refMatches } = view;

  const window30 = {
    quotes: counts.quotes.last30,
    whatsapp: counts.whatsapp.last30,
    phone: counts.phone.last30,
  };
  const shares = shareOf(window30);
  const total30 = window30.quotes + window30.whatsapp + window30.phone;

  const kpi = (key) => {
    const c = counts[key];
    return `<div class="kpi">
      <span class="kpi__dot" data-stream="${key}"></span>
      <div class="kpi__head">${esc(STREAM_LABELS[key])}</div>
      <div class="kpi__today"><b>${c.today}</b> اليوم</div>
      <div class="kpi__row"><span>آخر 7 أيام</span><b>${c.last7}</b> ${trendBadge(c.trend)}</div>
      <div class="kpi__row"><span>آخر 30 يوماً</span><b>${c.last30}</b></div>
    </div>`;
  };

  const shareBar = total30
    ? `<div class="sharebar" role="img" aria-label="توزيع قنوات التواصل خلال 30 يوماً">
        ${shares
          .filter((s) => s.pct > 0)
          .map(
            (s) =>
              `<span class="sharebar__seg" data-stream="${s.key}" style="width:${s.pct}%"><b>${s.pct}%</b></span>`
          )
          .join("")}
      </div>
      <div class="legend">${shares
        .map(
          (s) =>
            `<span class="legend__item"><i data-stream="${s.key}"></i>${esc(STREAM_LABELS[s.key])} — ${s.value}</span>`
        )
        .join("")}</div>`
    : '<p class="muted">لا توجد بيانات في آخر 30 يوماً بعد.</p>';

  const peakHour = busiest(hours);
  const peakDay = busiest(weekdays);

  const refPanel = `<form method="GET" action="/admin/leads" class="filters refbox">
    <input type="text" name="ref" value="${esc(refQuery || "")}" placeholder="ألصق رمز المرجع من رسالة واتساب (مثال: EFI-7K3M)">
    <button type="submit">ابحث عن الرمز</button>
    ${refQuery ? '<a class="btn btn-secondary" href="/admin/leads">مسح</a>' : ""}
  </form>`;

  const refResult = !refQuery
    ? ""
    : refMatches.length
      ? `<div class="panel">
          <p class="muted">الرمز <bdi><b>${esc(refNormalized)}</b></bdi> — ${refMatches.length} ${refMatches.length === 1 ? "ضغطة" : "ضغطات"}:</p>
          <table><thead><tr><th>الوقت</th><th>القناة</th><th>من أين</th><th>الصفحة</th><th>السياق</th></tr></thead><tbody>
          ${refMatches
            .map(
              (r) => `<tr>
              <td data-label="الوقت">${esc(toRiyadhDisplay(r.created_at))}</td>
              <td data-label="القناة">${esc(channelLabel(r.channel))}</td>
              <td data-label="من أين">${esc(locationLabel(r.location))}</td>
              <td data-label="الصفحة">${esc(r.page_title || "")}${r.page ? `<br><bdi class="muted path">${esc(r.page)}</bdi>` : ""}${!r.page_title && !r.page ? "—" : ""}</td>
              <td data-label="السياق">${esc(r.context || "—")}</td>
            </tr>`
            )
            .join("")}
          </tbody></table>
        </div>`
      : `<div class="panel"><p class="muted">لا توجد ضغطة مسجّلة بالرمز <b>${esc(refNormalized || refQuery)}</b>. تأكد من نسخ الرمز كاملاً كما ورد في الرسالة.</p></div>`;

  const pagesTable = pages.length
    ? `<table><thead><tr><th>الصفحة</th><th>عدد التواصلات</th></tr></thead><tbody>
      ${pages
        .map(
          (p) => `<tr>
          <td data-label="الصفحة">${esc(p.title || p.page || "—")}<br><bdi class="muted path">${esc(p.page || "")}</bdi></td>
          <td data-label="عدد التواصلات"><b>${p.count}</b></td>
        </tr>`
        )
        .join("")}
    </tbody></table>`
    : '<p class="muted">لم تُسجَّل أي ضغطة بعد.</p>';

  const pendingNotice = view.contactsPending
    ? `<div class="panel"><p>جدول <code>contact_events</code> غير موجود بعد، لذلك لا تظهر ضغطات الواتساب والمكالمات.</p>
       <p class="muted"><code>npx wrangler d1 execute elfarida-leads --remote --file=migrations/0002_contact_events.sql</code></p></div>`
    : "";

  return SHELL(
    "لوحة المراقبة",
    `<h1>لوحة المراقبة</h1>${viewNav("overview")}
    ${pendingNotice}
    ${refPanel}
    ${refResult}

    <div class="kpis">${kpi("quotes")}${kpi("whatsapp")}${kpi("phone")}</div>

    <div class="panel">
      <div class="panel__head"><h2>حجم التواصل اليومي — آخر 30 يوماً</h2>
        <span class="muted">من الأقدم (يسار) إلى اليوم (يمين)</span></div>
      ${dailyChart(series)}
      <div class="legend">${["quotes", "whatsapp", "phone"]
        .map(
          (k) =>
            `<span class="legend__item"><i data-stream="${k}"></i>${esc(STREAM_LABELS[k])}</span>`
        )
        .join("")}</div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>توزيع القنوات — آخر 30 يوماً</h2>
        <span class="muted">إجمالي ${total30}</span></div>
      ${shareBar}
    </div>

    <div class="panel">
      <div class="panel__head"><h2>ساعات الذروة</h2>
        <span class="muted">${peakHour ? `الأكثر ازدحاماً: ${esc(hourRangeLabel(peakHour.hour))}` : "لا توجد بيانات كافية"}</span></div>
      ${histogramChart(
        hours,
        (b, short) => (short ? String(b.hour) : hourRangeLabel(b.hour)),
        "#5a8fce",
        "عدد التواصلات بحسب ساعة اليوم بتوقيت الرياض",
        peakHour ? peakHour.hour : -1
      )}
      <p class="muted chart-note">بتوقيت الرياض. يفيد في تحديد من يرد على الهاتف والواتساب في أي ساعة.</p>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>أيام الأسبوع</h2>
        <span class="muted">${peakDay ? `الأنشط: ${esc(peakDay.label)}` : "لا توجد بيانات كافية"}</span></div>
      ${histogramChart(
        weekdays,
        (b) => b.label,
        "#4fae86",
        "عدد التواصلات بحسب يوم الأسبوع",
        peakDay ? peakDay.weekday : -1
      )}
    </div>

    <div class="panel">
      <div class="panel__head"><h2>الصفحات الأكثر توليداً للتواصل</h2>
        <span class="muted">آخر 30 يوماً</span></div>
      ${pagesTable}
    </div>`
  );
}

function contactsPage(rows, view) {
  if (view.pending) {
    return SHELL(
      "واتساب ومكالمات",
      `<h1>واتساب ومكالمات</h1>${viewNav("contacts")}
      <div class="panel">
        <p>جدول <code>contact_events</code> غير موجود بعد.</p>
        <p class="muted">نفّذ الأمر التالي مرة واحدة لتفعيل تسجيل نقرات الواتساب والمكالمات:</p>
        <p><code>npx wrangler d1 execute elfarida-leads --remote --file=migrations/0002_contact_events.sql</code></p>
      </div>`
    );
  }

  const { stats, breakdown, pages, filters, filteredCount, rawTotalCount, page, totalPages } = view;
  const q = filters.q || "";
  const channel = filters.channel || "";
  const isFiltered = Boolean(q || channel);
  const now = new Date();

  const channelOptions = CHANNELS.map(
    (c) =>
      `<option value="${c}"${c === channel ? " selected" : ""}>${esc(CHANNEL_LABELS_AR[c])}</option>`
  ).join("");

  const filterForm = `<form method="GET" action="/admin/leads" class="filters">
    <input type="hidden" name="view" value="contacts">
    <input type="text" name="q" value="${esc(q)}" placeholder="ابحث برمز المرجع (مثال: EFI-7K3M) أو الصفحة">
    <select name="channel"><option value="">كل القنوات</option>${channelOptions}</select>
    <button type="submit">بحث</button>
    ${isFiltered ? '<a class="btn" href="/admin/leads?view=contacts">إعادة تعيين</a>' : ""}
  </form>`;

  const statsBar = `<div class="panel stats">
    <span class="stat"><b>${stats.today}</b> اليوم</span>
    <span class="stat"><b>${stats.week}</b> هذا الأسبوع</span>
    <span class="stat"><b>${breakdown.whatsapp}</b> واتساب</span>
    <span class="stat"><b>${breakdown.phone}</b> مكالمة</span>
    <span class="stat"><b>${stats.total}</b> الإجمالي</span>
    ${isFiltered ? `<span class="stat">عرض <b>${filteredCount}</b> من ${rawTotalCount}</span>` : ""}
  </div>`;

  const topPagesHtml = pages.length
    ? `<div class="panel">
        <p class="muted" style="margin:0 0 10px">الصفحات التي تجلب أكثر تواصل</p>
        <div class="stats">${pages
          .map((p) => `<span class="stat"><b>${p.count}</b> ${esc(p.title || p.page)}</span>`)
          .join("")}</div>
      </div>`
    : "";

  const trs = rows
    .map((r) => {
      const recent = isRecent(r.created_at, now, 24);
      const isWa = r.channel === "whatsapp";
      return `<tr class="${recent ? "row--new" : ""}">
      <td data-label="التاريخ">${esc(toRiyadhDisplay(r.created_at))}</td>
      <td data-label="المرجع">${r.ref ? `<code>${esc(r.ref)}</code>` : '<span class="muted">—</span>'}</td>
      <td data-label="القناة"><span class="status-badge status-badge--${isWa ? "contacted" : "new"}">${esc(channelLabel(r.channel))}</span></td>
      <td data-label="من أين">${esc(locationLabel(r.location))}</td>
      <td data-label="الصفحة">${
        r.page
          ? `<a href="${esc(r.page)}" target="_blank" rel="noopener">${esc(r.page_title || r.page)}</a>`
          : '<span class="muted">—</span>'
      }</td>
      <td data-label="السياق">${r.context ? esc(r.context) : '<span class="muted">—</span>'}</td>
      <td data-label="الجهاز"><span class="muted">${esc(deviceHint(r.ua))}</span></td>
    </tr>`;
    })
    .join("");

  const pager = paginationControlsFor("contacts", filters, page, totalPages);

  return SHELL(
    "واتساب ومكالمات",
    `<h1>واتساب ومكالمات</h1>
    ${viewNav("contacts")}
    ${statsBar}
    ${topPagesHtml}
    <div class="panel">${filterForm}</div>
    <div class="toolbar">
      <a class="btn btn-secondary" href="/admin/leads?view=contacts&format=csv${channel ? "&channel=" + encodeURIComponent(channel) : ""}${q ? "&q=" + encodeURIComponent(q) : ""}">تصدير CSV</a>
      <a class="btn btn-secondary" href="/admin/leads?view=contacts&format=json">JSON</a>
    </div>
    <div class="panel" style="padding:12px 16px">
      <p class="muted" style="margin:0;font-size:13px">
        كل رسالة واتساب تُفتح من الموقع تحمل رمزاً مثل <code>EFI-7K3M</code>. حين تصلك الرسالة،
        ابحث بالرمز هنا لتعرف من أي صفحة جاء العميل وفي أي لحظة وما الذي كان يقرأه.
      </p>
    </div>
    ${
      rows.length
        ? `<table><thead><tr>
            <th>التاريخ</th><th>المرجع</th><th>القناة</th><th>من أين</th>
            <th>الصفحة</th><th>السياق</th><th>الجهاز</th>
          </tr></thead><tbody>${trs}</tbody></table>${pager}`
        : `<div class="panel"><p class="muted">${
            isFiltered ? "لا نتائج مطابقة." : "لا توجد نقرات مسجّلة بعد."
          }</p></div>`
    }`
  );
}

/** Pagination links that keep the current view and filters. */
function paginationControlsFor(view, filters, page, totalPages) {
  if (totalPages <= 1) return "";
  const link = (p, label) =>
    `<a class="btn btn-secondary" href="/admin/leads?${buildQueryString({
      view,
      ...filters,
      page: p,
    })}">${label}</a>`;
  const prev = page > 1 ? link(page - 1, "السابق") : "";
  const next = page < totalPages ? link(page + 1, "التالي") : "";
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
    <input type="hidden" name="view" value="leads">
    <input type="text" name="q" value="${esc(q)}" placeholder="ابحث بالاسم أو البريد أو الهاتف أو الموضوع">
    <select name="status"><option value="">كل الحالات</option>${statusOptionsHtml}</select>
    <input type="hidden" name="sort" value="${esc(filters.sort)}">
    <input type="hidden" name="dir" value="${esc(filters.dir)}">
    <button type="submit">بحث</button>
    ${isFiltered ? '<a class="btn" href="/admin/leads?view=leads">إعادة تعيين</a>' : ""}
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
  ${viewNav("leads")}
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

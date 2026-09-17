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
 * Updated 2026-09-17:
 *   - A waiting queue at the top of the overview: every request still unanswered,
 *     longest wait first, with the buyer's own number and a one-tap "replied".
 *   - Reply-time tracking on leads.answered_at, stamped on the first move away
 *     from `new` and cleared if the lead is reopened.
 *   - Tap-to-request attribution: the page-view reference code now travels into
 *     form submissions as well as WhatsApp messages (leads.ref).
 *   - A unified recent-activity feed and a plain-text daily digest with a
 *     WhatsApp share link.
 *
 * All schema changes are self-migrating inside ensure(env): the
 * "leads.status", "leads.notes", "leads.answered_at" and "leads.ref" columns
 * and the "admin_login_attempts" table are created on first use after deploy,
 * idempotently. No manual wrangler command is required for this update.
 */
import {
  STATUS_OPTIONS,
  DEFAULT_STATUS,
  ANSWERED_STATUS,
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
  mergeTimeline,
  deviceHint,
} from "./_contacts-lib.js";
import {
  shortDayLabel,
  combinedSeries,
  windowCounts,
  hourHistogram,
  weekdayHistogram,
  hourRangeLabel,
  normalizeRef,
  findByRef,
  shareOf,
  WINDOW_OPTIONS,
  normalizeWindow,
  peakClaim,
  breakdownBy,
  uniqueCount,
  repeatRatio,
  responseStats,
  pendingLeads,
  hoursBetween,
  waitLabel,
  hoursLabel,
  repliesLabel,
  peopleLabel,
  tapsLabel,
  requestsLabel,
  tapConversion,
  SLA_HOURS,
} from "./_overview-lib.js";
import { dailyDigest, digestStamp } from "./_digest-lib.js";

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
    "SELECT id, created_at, name, email, phone, subject, ip, status, notes, answered_at, ref FROM leads ORDER BY created_at DESC LIMIT 500"
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
  const days = normalizeWindow(url.searchParams.get("days"));
  const since = new Date(now.getTime() - (days + 1) * 86400000).toISOString();

  // A silently truncated read would understate every number on the page while
  // still looking authoritative, so the cap is surfaced rather than hidden.
  const LEAD_CAP = 5000;
  const EVENT_CAP = 20000;

  const { results: leadRows } = await env.DB.prepare(
    `SELECT id, created_at, name, email, phone, subject, status, answered_at, ref, ip FROM leads WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${LEAD_CAP}`
  )
    .bind(since)
    .all();
  const quotes = leadRows || [];

  // The waiting queue deliberately ignores the selected window. A request from
  // six weeks ago that nobody answered is the most expensive row in the table,
  // and hiding it behind a date filter is how it stays unanswered.
  const { results: openRows } = await env.DB.prepare(
    `SELECT id, created_at, name, email, phone, subject, status, answered_at FROM leads WHERE status = ? ORDER BY created_at ASC LIMIT 200`
  )
    .bind(DEFAULT_STATUS)
    .all();

  let contacts = [];
  let contactsPending = false;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, created_at, ref, channel, location, page, page_title, context, ip FROM contact_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${EVENT_CAP}`
    )
      .bind(since)
      .all();
    contacts = results || [];
  } catch (_) {
    contactsPending = true;
  }

  const truncated = quotes.length >= LEAD_CAP || contacts.length >= EVENT_CAP;
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

  // The hour and weekday histograms answer a staffing question — who must be
  // free to pick up the phone and reply on WhatsApp — so they count live
  // contact attempts only. Folding in form submissions, which wait politely in
  // a table until someone opens it, would blur exactly that signal.
  const hours = hourHistogram(contacts);
  const weekdays = weekdayHistogram(contacts);

  // Response quality is measured over the window (so it tracks how the shop is
  // doing lately), while the queue below it is measured over everything still
  // open (so nothing falls off the bottom).
  const response = responseStats(quotes, now);
  const open = responseStats(openRows || [], now);

  return htmlResp(
    overviewPage({
      now,
      days,
      truncated,
      contactsPending,
      response,
      queue: pendingLeads(openRows || [], now).slice(0, 8),
      open,
      conversion: tapConversion(quotes, contacts),
      timeline: mergeTimeline(quotes, contacts).slice(0, 12),
      digest: dailyDigest(quotes, contacts, now),
      refQuery,
      refNormalized: normalizeRef(refQuery),
      refMatches,
      counts: {
        quotes: windowCounts(quotes, now, days),
        whatsapp: windowCounts(whatsapp, now, days),
        phone: windowCounts(phone, now, days),
      },
      people: {
        contacts: uniqueCount(contacts, "ip"),
        repeat: repeatRatio(contacts, "ip"),
      },
      series: combinedSeries({ quotes, whatsapp, phone }, days, now),
      hours,
      weekdays,
      hourPeak: peakClaim(hours),
      // Seven buckets, not twenty-four: the same total is far denser per
      // bucket, so the bar for a believable winner is lower.
      dayPeak: peakClaim(weekdays, 20, 4),
      pages: topPages(contacts, 8),
      locations: breakdownBy(contacts, "location", 8),
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
  if (
    action === "update_status" ||
    action === "update_notes" ||
    action === "delete" ||
    action === "mark_answered"
  ) {
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
      const status =
        action === "mark_answered" ? ANSWERED_STATUS : (form.get("status") || "").toString();
      if (!isValidStatus(status)) return text("حالة غير صالحة.", 400);
      await setLeadStatus(env, id, status);
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

/**
 * Writes a lead's status and keeps `answered_at` honest alongside it.
 *
 * The timestamp is stamped only on the FIRST move away from `new`, so a lead
 * later reopened and closed again still reports the wait the buyer actually
 * experienced rather than the last time someone touched the row. Putting a
 * lead back to `new` clears it: the panel would otherwise show a request that
 * is both waiting and already answered.
 */
async function setLeadStatus(env, id, status) {
  if (status === DEFAULT_STATUS) {
    await env.DB.prepare("UPDATE leads SET status = ?, answered_at = NULL WHERE id = ?")
      .bind(status, id)
      .run();
    return;
  }
  await env.DB.prepare(
    "UPDATE leads SET status = ?, answered_at = COALESCE(answered_at, ?) WHERE id = ?"
  )
    .bind(status, new Date().toISOString(), id)
    .run();
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
  // Mirrors migrations/0004_response_and_ref.sql. Nullable with no default:
  // an un-answered lead must be distinguishable from one answered at the epoch.
  try {
    await env.DB.prepare("ALTER TABLE leads ADD COLUMN answered_at TEXT").run();
  } catch (_) {
    // Column already exists from a previous deploy — safe to ignore.
  }
  try {
    await env.DB.prepare("ALTER TABLE leads ADD COLUMN ref TEXT").run();
  } catch (_) {
    // Column already exists from a previous deploy — safe to ignore.
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_leads_ref ON leads (ref)").run();
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
/* a.btn is more specific than .btn-secondary, so an anchor carrying both
   rendered as a primary button — which is why the window picker highlighted
   every option. The anchor form is spelled out rather than the rule reordered,
   because reordering would only move the collision somewhere else. */
.btn-secondary,a.btn.btn-secondary{background:var(--panel-alt);border:1px solid var(--border)}
.btn-secondary:hover,a.btn.btn-secondary:hover{background:#202c42}
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
.wait{font-size:11.5px;display:inline-block;margin-top:3px}
.wait--late{color:#f0a9a9;font-weight:600}
.status-badge--new{background:#1f3a63;color:#a9c6ea}
.status-badge--contacted{background:#5c4423;color:#e3c78d}
.status-badge--closed{background:#33404f;color:#adb9c7}
.inline-form{display:flex;gap:6px;align-items:center;margin:0;flex-wrap:wrap}
.inline-form select,.inline-form input[type=text]{padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--panel-2);color:var(--text);font-size:12.5px;width:auto;margin:0}
/* Size only. Colour comes from button / a.btn / .btn-secondary, so a small
   secondary button stays secondary instead of being repainted primary here. */
.btn-sm,a.btn.btn-sm,button.btn-sm{border-radius:6px;padding:6px 10px;font-size:12.5px;margin:0}
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
[data-stream=quotes]{background:#3987e5}
[data-stream=whatsapp]{background:#199e70}
[data-stream=phone]{background:#d95926}
.panel__bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px}
.panel__bar .muted{font-size:12.5px}
.windowpick{display:flex;gap:6px}
.people{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.people .muted{font-size:12px}
.peak{color:var(--text)}
.countlink{color:var(--link);text-decoration:none;white-space:nowrap}
.ranked{display:flex;flex-direction:column;gap:9px}
.ranked__row{display:grid;grid-template-columns:minmax(90px,150px) 1fr auto;align-items:center;gap:12px}
.ranked__label{font-size:13px;color:var(--text)}
.ranked__track{background:var(--panel-2);border-radius:4px;height:14px;overflow:hidden}
/* Logical radii: the bar grows from the inline start, so the rounded end must
   follow the data end — which is the left edge in this RTL panel. */
.ranked__fill{display:block;height:100%;border-start-start-radius:0;border-end-start-radius:0;border-start-end-radius:4px;border-end-end-radius:4px}
.ranked__value{font-size:13px;color:var(--text);min-width:2ch;text-align:start}
@media (max-width:600px){.ranked__row{grid-template-columns:1fr auto;gap:4px}.ranked__track{grid-column:1/-1}}
.plot{display:block}
.chart{width:100%;height:auto;display:block;overflow:visible}
.chart .ax{fill:#8a97a8;font-size:11px;font-family:system-ui,Tahoma,sans-serif}
.chart .grid{stroke:#2c3b52;stroke-width:1}
/* The waiting queue is the page's one call to action, so it is the only panel
   allowed an accent border; everything else reports and stays quiet. */
.panel--queue{border-color:#3d5a86}
.queue{display:flex;flex-direction:column;gap:10px}
.queue__row{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.queue__row--late{border-color:#7a3b3b;background:#241a1c}
.queue__who{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:13.5px}
.queue__who b{color:var(--text)}
.queue__who .muted{font-size:12.5px}
.queue__wait{display:flex;flex-direction:column;align-items:flex-end;white-space:nowrap;font-size:12.5px}
.queue__wait b{color:var(--text);font-size:14.5px}
.queue__act{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.queue__done{margin:0}
.peak--alert{color:#f0a9a9;font-weight:600}
@media(max-width:600px){
.queue__row{grid-template-columns:1fr auto}
.queue__act{grid-column:1/-1}
}
.feed{display:flex;flex-direction:column}
.feed__row{display:grid;grid-template-columns:10px 1fr auto auto;gap:10px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px}
.feed__row:last-child{border-bottom:0}
.feed__dot{width:8px;height:8px;border-radius:50%;align-self:center}
.feed__what{min-width:0;overflow-wrap:anywhere}
.feed__where{font-size:12px}
.feed__when{white-space:nowrap;font-size:12px}
@media(max-width:600px){
.feed__row{grid-template-columns:10px 1fr}
.feed__where,.feed__when{grid-column:2/-1}
}
.digest{width:100%;max-width:none;font-family:inherit;font-size:13.5px;line-height:1.8;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:12px;resize:vertical}
/* The plot's x axis runs oldest-to-newest left-to-right in SVG user space, which
   no page direction changes; the tick row has to follow it, not the page. */
.ticks{display:flex;margin-top:6px;direction:ltr}
.ticks__t{flex:1 1 0;min-width:0;text-align:center;font-size:11px;line-height:1.3;color:#8a97a8;white-space:nowrap;font-variant-numeric:tabular-nums}
.chart-note{font-size:12px;margin:10px 0 0}
@media(max-width:720px){
.chart .ax{font-size:34px}
.ticks__t:not(.ticks__t--keep){visibility:hidden}
}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12.5px;color:var(--muted)}
.legend__item{display:inline-flex;align-items:center;gap:6px}
.legend__item i{width:10px;height:10px;border-radius:3px;display:inline-block}
/* Values live in the legend beneath, in text ink — never as coloured text on
   a coloured fill, where the contrast depends on which segment it lands in. */
.sharebar{display:flex;height:16px;border-radius:6px;overflow:hidden;background:var(--panel-2);gap:2px}
.sharebar__seg{min-width:2px}
.legend__item b{color:var(--text)}
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

/**
 * Categorical slots 1–3 of the design palette, stepped for a dark surface and
 * validated as a set against this panel's own background (#1a2436): lightness
 * band, chroma floor, adjacent CVD separation (worst ΔE 9.4), normal-vision
 * separation (worst ΔE 20.9) and 3:1 contrast all pass. The previous ad-hoc
 * trio failed the lightness band and left orange and green only ΔE 6.6 apart
 * under protanopia — the two channels the owner most needs to tell apart.
 *
 * Aqua carries WhatsApp because it is both the validated slot and the colour a
 * reader already associates with it; colour follows the stream, never its rank,
 * so filtering or a quiet channel never repaints the others.
 */
const STREAM_COLORS = { quotes: "#3987e5", whatsapp: "#199e70", phone: "#d95926" };
const STREAM_LABELS = { quotes: "طلبات النماذج", whatsapp: "واتساب", phone: "مكالمات" };
const BAR_RADIUS = 4;
const SEG_GAP = 2;

/** A bar with its data end rounded and its baseline end square. */
function barPath(x, y, w, h, r) {
  const n = (v) => v.toFixed(1);
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (rr <= 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return (
    `M${n(x)} ${n(y + h)}L${n(x)} ${n(y + rr)}Q${n(x)} ${n(y)} ${n(x + rr)} ${n(y)}` +
    `L${n(x + w - rr)} ${n(y)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + rr)}` +
    `L${n(x + w)} ${n(y + h)}Z`
  );
}

/**
 * X-axis ticks, rendered as HTML rather than inside the viewBox.
 *
 * An SVG scales its own text down with the plot, so a 11px axis label becomes a
 * 5px smudge on a phone. Equal-width flex cells sit on the same slot grid as the
 * bars, so the labels stay aligned while keeping a real CSS font size. `wide` is
 * the desktop label interval and `narrow` the one a phone can fit; the cells in
 * between are still emitted, so the grid never shifts.
 */
function axisTicks(items, textFor, wide, narrow) {
  return `<div class="ticks" aria-hidden="true">${items
    .map((item, i) => {
      if (i % wide !== 0) return '<span class="ticks__t"></span>';
      const keep = i % narrow === 0 ? " ticks__t--keep" : "";
      return `<span class="ticks__t${keep}">${esc(textFor(item))}</span>`;
    })
    .join("")}</div>`;
}

/** A signed, coloured change indicator, or a dash when there is no baseline. */
function trendBadge(pct) {
  if (pct == null) return '<span class="trend trend--flat">—</span>';
  if (pct === 0) return '<span class="trend trend--flat">بلا تغيّر</span>';
  const up = pct > 0;
  return `<span class="trend trend--${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
}

/**
 * Stacked daily volume over the selected window.
 *
 * Stacked rather than grouped: the owner's first question is whether total
 * demand is moving, and the second is which channel moved it. Grouped bars
 * answer the second well and the first badly.
 */
function dailyChart(series) {
  const W = 960;
  const H = 200;
  const padTop = 14;
  const padBottom = 6;
  const plot = H - padTop - padBottom;
  const max = Math.max(1, ...series.map((d) => d.total));
  const slot = W / Math.max(1, series.length);
  const barW = Math.max(3, Math.min(20, slot - SEG_GAP * 2));

  const bars = series
    .map((d, i) => {
      const x = slot * i + (slot - barW) / 2;
      const stack = [
        ["phone", d.phone],
        ["whatsapp", d.whatsapp],
        ["quotes", d.quotes],
      ].filter(([, v]) => v > 0);

      let y = padTop + plot;
      return stack
        .map(([key, value], idx) => {
          const raw = (value / max) * plot;
          y -= raw;
          // A 2px surface gap keeps adjacent fills from reading as one block.
          const gap = idx < stack.length - 1 ? SEG_GAP : 0;
          const h = Math.max(1.5, raw - gap);
          const top = idx === stack.length - 1 ? BAR_RADIUS : 0;
          return `<path d="${barPath(x, y + gap, barW, h, top)}" fill="${STREAM_COLORS[key]}"><title>${esc(shortDayLabel(d.key))} — ${esc(STREAM_LABELS[key])}: ${value}</title></path>`;
        })
        .join("");
    })
    .join("");

  const wide = series.length > 40 ? 10 : series.length > 14 ? 5 : 2;
  const narrow = series.length > 40 ? 30 : series.length > 14 ? 10 : 2;

  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = padTop + plot - f * plot;
      return `<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" class="grid"/><text x="${W - 4}" y="${(y - 4).toFixed(1)}" class="ax" text-anchor="end">${Math.round(f * max)}</text>`;
    })
    .join("");

  return `<div class="plot"><svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="حجم التواصل اليومي">${grid}${bars}</svg>${axisTicks(series, (d) => shortDayLabel(d.key), wide, narrow)}</div>`;
}

/** A single-series histogram used for both the hour and weekday breakdowns. */
function histogramChart(buckets, labelFor, fill, ariaLabel, highlight, narrow) {
  const W = 960;
  const H = 124;
  const padTop = 10;
  const padBottom = 4;
  const plot = H - padTop - padBottom;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const slot = W / Math.max(1, buckets.length);
  const barW = Math.max(4, Math.min(46, slot - SEG_GAP * 2));

  const bars = buckets
    .map((b, i) => {
      const empty = b.count === 0;
      const h = empty ? 2 : Math.max(2, (b.count / max) * plot);
      const x = slot * i + (slot - barW) / 2;
      const y = padTop + plot - h;
      // The peak is emphasised by opacity, never by a second hue: a value ramp
      // on nominal buckets would double-encode the height the bar already shows.
      const opacity = empty ? 0.16 : i === highlight ? 1 : 0.62;
      return `<path d="${barPath(x, y, barW, h, empty ? 0 : BAR_RADIUS)}" fill="${fill}" opacity="${opacity}"><title>${esc(labelFor(b))} — ${b.count}</title></path>`;
    })
    .join("");

  const wide = buckets.length <= 8 ? 1 : 2;

  return `<div class="plot"><svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(ariaLabel)}">${bars}</svg>${axisTicks(buckets, (b) => labelFor(b, true), wide, narrow)}</div>`;
}

/** Horizontal ranked bars — the readable form for named categories. */
function rankedBars(rows, labelFor, fill) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return `<div class="ranked">${rows
    .map(
      (r) => `<div class="ranked__row">
      <span class="ranked__label">${esc(labelFor(r))}</span>
      <span class="ranked__track"><span class="ranked__fill" style="width:${Math.max(2, Math.round((r.count / max) * 100))}%;background:${fill}"></span></span>
      <b class="ranked__value">${r.count}</b>
    </div>`
    )
    .join("")}</div>`;
}

/** The peak line: a claim when the sample supports one, an honest gap when not. */
function peakLine(claim, describe, noun) {
  if (!claim.top) return `<span class="muted">لا توجد بيانات بعد</span>`;
  if (!claim.reliable) {
    return `<span class="muted">العيّنة صغيرة (${claim.total} ${noun}) — لا تكفي لتحديد ذروة موثوقة بعد</span>`;
  }
  return `<span class="muted">الأكثر ازدحاماً: <b class="peak">${esc(describe(claim.top))}</b> · من ${claim.total} ${noun}</span>`;
}

/**
 * The waiting queue — the only panel on this page that asks for an action
 * rather than reporting a number.
 *
 * It sits above the charts because a request nobody answered costs more than
 * every insight below it combined, and it carries the buyer's own phone number
 * so answering is one tap rather than a trip through the table.
 */
function queuePanelHtml(queue, open, backQs) {
  if (!queue || !queue.length) {
    return `<div class="panel">
      <div class="panel__head"><h2>بانتظار الرد</h2></div>
      <p class="muted">لا يوجد طلب بانتظار الرد. كل ما وصل تم التعامل معه.</p>
    </div>`;
  }

  const overdue = open.overdue;
  const rows = queue
    .map((r) => {
      const late = r.waitedHours >= SLA_HOURS;
      const wa = buildWaHref(r.phone);
      const tel = buildTelHref(r.phone);
      const who = r.name || r.phone || r.email || "بدون اسم";
      return `<div class="queue__row${late ? " queue__row--late" : ""}">
        <div class="queue__who">
          <b>${esc(who)}</b>
          ${r.subject ? `<span class="muted">${esc(r.subject)}</span>` : ""}
          <span class="muted">${esc(toRiyadhDisplay(r.created_at))}</span>
        </div>
        <div class="queue__wait"><b>${esc(waitLabel(r.waitedHours))}</b><span class="muted">انتظاراً</span></div>
        <div class="queue__act">
          ${wa ? `<a class="btn btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ""}
          ${tel ? `<a class="btn btn-secondary btn-sm" href="${esc(tel)}">اتصال</a>` : ""}
          <form method="POST" action="/admin/leads" class="queue__done">
            <input type="hidden" name="_action" value="mark_answered">
            <input type="hidden" name="id" value="${esc(r.id)}">
            <input type="hidden" name="_return" value="${esc(backQs)}">
            <button type="submit" class="btn btn-secondary btn-sm">تم الرد</button>
          </form>
        </div>
      </div>`;
    })
    .join("");

  const headline = overdue
    ? `<span class="peak peak--alert">${overdue} منها بلا رد منذ أكثر من ${esc(hoursLabel(SLA_HOURS))}</span>`
    : `<span class="peak">${esc(requestsLabel(open.pending))} بانتظار الرد، ولا شيء منها تجاوز ${esc(hoursLabel(SLA_HOURS))}</span>`;

  const more =
    open.pending > queue.length
      ? `<p class="muted chart-note">تُعرض أقدم ${queue.length} من ${open.pending}. البقية في <a class="countlink" href="${esc("/admin/leads?" + buildQueryString({ view: "leads", status: DEFAULT_STATUS }))}">تبويب طلبات النماذج ↗</a></p>`
      : "";

  return `<div class="panel panel--queue">
    <div class="panel__head"><h2>بانتظار الرد</h2>${headline}</div>
    <div class="queue">${rows}</div>
    ${more}
  </div>`;
}

/** Reply speed, stated only once enough replies exist to mean anything. */
function responsePanelHtml(response) {
  const body =
    response.median != null
      ? `<div class="panel people">
          <span class="stat"><b>${esc(waitLabel(response.median))}</b> وسيط زمن الرد</span>
          <span class="stat"><b>${response.slaPct}%</b> من الردود خلال ${esc(hoursLabel(SLA_HOURS))}</span>
          <span class="muted">محسوب على ${esc(repliesLabel(response.answered))} مسجّلة. الوسيط وليس المتوسط: ردٌّ متأخر واحد لا يشوّه الصورة.</span>
        </div>`
      : `<div class="panel people">
          <span class="muted">سُجِّل ${esc(repliesLabel(response.answered))} حتى الآن — أقل من أن يُحسب منه زمن رد موثوق. يُحتسب الزمن تلقائياً كلما ضغطت «تم الرد».</span>
        </div>`;
  return body;
}

/** How many taps became a submitted request, via the shared reference code. */
function conversionPanelHtml(conversion) {
  if (!conversion || !conversion.taps) return "";
  return `<div class="panel people">
    <span class="stat"><b>${conversion.converted}</b> من ${esc(tapsLabel(conversion.taps))} أرسل أصحابها نموذجاً أيضاً</span>
    ${conversion.pct != null ? `<span class="stat"><b>${conversion.pct}%</b></span>` : ""}
    <span class="muted">يُربط برمز المرجع المشترك بين الرسالة والنموذج، لا بعنوان الـ IP.</span>
  </div>`;
}

/** Every way a visitor reached out, newest first, in one list. */
function timelinePanelHtml(timeline) {
  if (!timeline || !timeline.length) return "";
  const rows = timeline
    .map((e) => {
      const isLead = e.kind === "lead";
      const stream = isLead ? "quotes" : e.channel === "phone" ? "phone" : "whatsapp";
      // A form lead is named by the person who sent it; a tap has no name, so
      // it is named by its channel and the label carries that already.
      const detail = (isLead ? [e.label, e.detail] : [e.detail]).filter(Boolean).join(" — ");
      return `<div class="feed__row">
      <span class="feed__dot" data-stream="${stream}"></span>
      <span class="feed__what"><b>${esc(isLead ? "نموذج" : e.label)}</b>${detail ? ` — ${esc(detail)}` : ""}</span>
      <span class="feed__where">${e.page ? `<bdi class="muted path">${esc(e.page)}</bdi>` : ""}${e.ref ? ` <bdi class="muted">${esc(e.ref)}</bdi>` : ""}</span>
      <span class="feed__when muted">${esc(toRiyadhDisplay(e.created_at))}</span>
    </div>`;
    })
    .join("");
  return `<div class="panel">
    <div class="panel__head"><h2>آخر النشاط</h2><span class="muted">أحدث ${timeline.length}</span></div>
    <div class="feed">${rows}</div>
  </div>`;
}

/**
 * The day in one message.
 *
 * Delivered as a WhatsApp link rather than a copy button because the panel
 * carries no JavaScript at all, and because the owner reads this on a phone:
 * tapping straight through to WhatsApp is fewer steps than any clipboard
 * dance. The textarea beside it covers the desktop case.
 */
function digestPanelHtml(digest, now) {
  return `<div class="panel">
    <div class="panel__head"><h2>الملخص اليومي</h2><span class="muted">${esc(digestStamp(now))}</span></div>
    <textarea class="digest" rows="12" readonly aria-label="نص الملخص اليومي">${esc(digest)}</textarea>
    <div class="panel__bar">
      <a class="btn btn-sm" href="${esc("https://wa.me/?text=" + encodeURIComponent(digest))}" target="_blank" rel="noopener">إرساله عبر واتساب</a>
      <span class="muted">يفتح واتساب بالنص جاهزاً — اختر المستلم فقط.</span>
    </div>
  </div>`;
}

function overviewPage(view) {
  const {
    counts,
    people,
    series,
    hours,
    weekdays,
    hourPeak,
    dayPeak,
    pages,
    locations,
    days,
    truncated,
    refQuery,
    refNormalized,
    refMatches,
  } = view;

  const windowTotals = {
    quotes: counts.quotes.window,
    whatsapp: counts.whatsapp.window,
    phone: counts.phone.window,
  };
  const shares = shareOf(windowTotals);
  const windowTotal = windowTotals.quotes + windowTotals.whatsapp + windowTotals.phone;
  const qs = (extra) =>
    esc("/admin/leads?" + buildQueryString({ days, ref: refQuery || "", ...extra }));

  const windowPicker = `<div class="windowpick">${WINDOW_OPTIONS.map(
    (d) =>
      `<a class="btn ${d === days ? "" : "btn-secondary"} btn-sm" href="${esc("/admin/leads?" + buildQueryString({ days: d, ref: refQuery || "" }))}">${d} يوم</a>`
  ).join("")}</div>`;

  const kpi = (key) => {
    const c = counts[key];
    return `<div class="kpi">
      <span class="kpi__dot" data-stream="${key}"></span>
      <div class="kpi__head">${esc(STREAM_LABELS[key])}</div>
      <div class="kpi__today"><b>${c.today}</b> اليوم</div>
      <div class="kpi__row"><span>آخر 7 أيام</span><b>${c.last7}</b> ${trendBadge(c.trend)}</div>
      <div class="kpi__row"><span>خلال ${days} يوماً</span><b>${c.window}</b></div>
    </div>`;
  };

  const peopleLine =
    people.contacts > 0
      ? `<div class="panel people">
          <span class="stat"><b>${esc(peopleLabel(people.contacts))}</b> تواصلوا خلال ${days} يوماً</span>
          <span class="stat"><b>${people.repeat}</b> ضغطة لكل شخص في المتوسط</span>
          <span class="muted">يُقاس بعنوان الـ IP تقريبياً؛ عشر ضغطات من شخص واحد ليست عشرة عملاء.</span>
        </div>`
      : "";

  const shareBar = windowTotal
    ? `<div class="sharebar" role="img" aria-label="توزيع قنوات التواصل">
        ${shares
          .filter((s) => s.pct > 0)
          .map(
            (s) =>
              `<span class="sharebar__seg" data-stream="${s.key}" style="width:${s.pct}%"></span>`
          )
          .join("")}
      </div>
      <div class="legend">${shares
        .map(
          (s) =>
            `<span class="legend__item"><i data-stream="${s.key}"></i>${esc(STREAM_LABELS[s.key])} — <b>${s.value}</b> (${s.pct}%)</span>`
        )
        .join("")}</div>`
    : '<p class="muted">لا توجد بيانات في هذه الفترة بعد.</p>';

  const refPanel = `<form method="GET" action="/admin/leads" class="filters refbox">
    <input type="hidden" name="days" value="${days}">
    <input type="text" name="ref" value="${esc(refQuery || "")}" placeholder="ألصق رمز المرجع من رسالة واتساب (مثال: EFI-7K3M)">
    <button type="submit">ابحث عن الرمز</button>
    ${refQuery ? `<a class="btn btn-secondary" href="${qs({ ref: "" })}">مسح</a>` : ""}
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
      : `<div class="panel"><p class="muted">لا توجد ضغطة مسجّلة بالرمز <bdi><b>${esc(refNormalized || refQuery)}</b></bdi>. تأكد من نسخ الرمز كاملاً كما ورد في الرسالة.</p></div>`;

  const pagesTable = pages.length
    ? `<table><thead><tr><th>الصفحة</th><th>عدد التواصلات</th></tr></thead><tbody>
      ${pages
        .map(
          (p) => `<tr>
          <td data-label="الصفحة">${esc(p.title || p.page || "—")}<br><bdi class="muted path">${esc(p.page || "")}</bdi></td>
          <td data-label="عدد التواصلات"><a class="countlink" href="${esc("/admin/leads?" + buildQueryString({ view: "contacts", q: p.page || "" }))}"><b>${p.count}</b> ↗</a></td>
        </tr>`
        )
        .join("")}
    </tbody></table>`
    : '<p class="muted">لم تُسجَّل أي ضغطة بعد.</p>';

  const locationPanel = locations.length
    ? `${rankedBars(locations, (r) => locationLabel(r.key), STREAM_COLORS.whatsapp)}
       <p class="muted chart-note">أي زر يضغطه الزائر فعلاً. الزر الذي لا يُضغط مكانه خاطئ أو صياغته لا تقنع.</p>`
    : '<p class="muted">لم تُسجَّل أي ضغطة بعد.</p>';

  const pendingNotice = view.contactsPending
    ? `<div class="panel"><p>جدول <code>contact_events</code> غير موجود بعد، لذلك لا تظهر ضغطات الواتساب والمكالمات.</p>
       <p class="muted"><code>npx wrangler d1 execute elfarida-leads --remote --file=migrations/0002_contact_events.sql</code></p></div>`
    : "";

  const truncNotice = truncated
    ? `<div class="panel"><p class="err">بلغت القراءة الحد الأقصى للصفوف، لذلك قد تكون الأرقام أقل من الواقع. قلّل الفترة أو راجع التبويبات التفصيلية.</p></div>`
    : "";

  const emptyNotice =
    windowTotal === 0 && !view.contactsPending
      ? `<div class="panel"><p class="muted">لا يوجد نشاط مسجّل في هذه الفترة. إن كان الموقع يستقبل زواراً، جرّب فترة أطول من الأزرار أعلاه.</p></div>`
      : "";

  const backQs = buildQueryString({ days });
  const queuePanel = queuePanelHtml(view.queue, view.open, backQs);
  const responsePanel = responsePanelHtml(view.response);
  const conversionPanel = conversionPanelHtml(view.conversion);
  const timelinePanel = timelinePanelHtml(view.timeline);
  const digestPanel = digestPanelHtml(view.digest, view.now);

  return SHELL(
    "لوحة المراقبة",
    `<h1>لوحة المراقبة</h1>${viewNav("overview")}
    ${pendingNotice}
    ${truncNotice}
    ${refPanel}
    ${refResult}
    ${queuePanel}
    <div class="panel__bar">${windowPicker}<span class="muted">البيانات حتى ${esc(toRiyadhDisplay(view.now.toISOString()))} بتوقيت الرياض</span></div>
    ${emptyNotice}

    <div class="kpis">${kpi("quotes")}${kpi("whatsapp")}${kpi("phone")}</div>
    ${responsePanel}
    ${peopleLine}
    ${conversionPanel}

    <div class="panel">
      <div class="panel__head"><h2>حجم التواصل اليومي — ${days} يوماً</h2>
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
      <div class="panel__head"><h2>توزيع القنوات</h2><span class="muted">إجمالي ${windowTotal}</span></div>
      ${shareBar}
    </div>

    <div class="panel">
      <div class="panel__head"><h2>ساعات الذروة</h2>
        ${peakLine(hourPeak, (b) => hourRangeLabel(b.hour), "تواصل")}</div>
      ${histogramChart(
        hours,
        (b, short) => (short ? String(b.hour) : hourRangeLabel(b.hour)),
        STREAM_COLORS.quotes,
        "عدد محاولات التواصل بحسب ساعة اليوم بتوقيت الرياض",
        hourPeak.reliable ? hourPeak.top.hour : -1,
        6
      )}
      <p class="muted chart-note">واتساب ومكالمات فقط — وهي ما يحتاج رداً فورياً. بتوقيت الرياض.</p>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>أيام الأسبوع</h2>
        ${peakLine(dayPeak, (b) => b.label, "تواصل")}</div>
      ${histogramChart(
        weekdays,
        (b, short) => (short ? b.short : b.label),
        STREAM_COLORS.whatsapp,
        "عدد محاولات التواصل بحسب يوم الأسبوع",
        dayPeak.reliable ? dayPeak.top.weekday : -1,
        1
      )}
    </div>

    <div class="panel">
      <div class="panel__head"><h2>من أي زر يأتي التواصل</h2><span class="muted">${days} يوماً</span></div>
      ${locationPanel}
    </div>

    <div class="panel">
      <div class="panel__head"><h2>الصفحات الأكثر توليداً للتواصل</h2><span class="muted">${days} يوماً</span></div>
      ${pagesTable}
    </div>

    ${timelinePanel}
    ${digestPanel}`
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

      // The wait is shown on open rows and the achieved reply time on closed
      // ones, so one column answers both "how late am I" and "how did we do".
      const waited = hoursBetween(r.created_at, r.answered_at || now);
      const waitTag =
        waited == null
          ? ""
          : r.answered_at
            ? `<span class="muted wait">رُدَّ بعد ${esc(waitLabel(waited))}</span>`
            : `<span class="wait${waited >= SLA_HOURS ? " wait--late" : ""}">منتظر ${esc(waitLabel(waited))}</span>`;
      const refTag = r.ref
        ? `<a class="countlink" href="${esc("/admin/leads?" + buildQueryString({ ref: r.ref }))}" title="الضغطات التي تحمل الرمز نفسه"><bdi>${esc(r.ref)}</bdi> ↗</a>`
        : "";

      return `<tr class="${recent ? "row--new" : ""}">
      <td data-label="التاريخ">${esc(toRiyadhDisplay(r.created_at))}${waitTag ? `<br>${waitTag}` : ""}${refTag ? `<br>${refTag}` : ""}</td>
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

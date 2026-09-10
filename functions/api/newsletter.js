/**
 * POST /api/newsletter — footer newsletter subscription.
 *
 * Why this endpoint exists: the footer form used to post to /api/quote, so a
 * bare e-mail address with no name, no phone and no stated need was written to
 * the `leads` table and raised the same "new quote request" notification as a
 * genuine buyer. The owner could not tell the two apart, the lead count in the
 * admin panel was inflated, and real requests were diluted by subscriptions.
 *
 * A subscription is a different object with a different lifecycle, so it gets
 * its own table (`newsletter_subscribers`), its own uniqueness rule and no
 * sales notification.
 *
 * Bindings: DB — D1 database "elfarida-leads".
 */

const MAX_BODY_BYTES = 2000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_SUBSCRIPTIONS = 5;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  const data = await parseBody(request);
  if (data === null) return json({ success: false, message: "طلب غير صالح." }, 400);

  // Honeypot — answer success so the bot does not retry with a variation.
  if (data.botcheck) return json({ success: true, message: "تمّ الاشتراك." });

  const email = pick(data, ["email", "Email", "البريد", "البريد_الإلكتروني"]).toLowerCase();
  if (!EMAIL_RE.test(email))
    return json({ success: false, message: "يرجى إدخال بريد إلكتروني صحيح." }, 422);

  if (!env.DB) return json({ success: false, message: "تعذّر الاشتراك مؤقّتًا." }, 502);

  const ip = request.headers.get("CF-Connecting-IP") || "";

  // Per-IP flood guard. Fails open — a check error must not reject a real user.
  if (ip) {
    try {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      const recent = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE ip = ? AND created_at > ?"
      )
        .bind(ip, since)
        .first();
      if (recent && recent.n >= RATE_MAX_SUBSCRIPTIONS)
        return json(
          { success: false, message: "تمّ استلام عدّة طلبات للتوّ. حاول بعد قليل." },
          429
        );
    } catch (_) {
      /* fail open */
    }
  }

  const values = [
    crypto.randomUUID(),
    new Date().toISOString(),
    email,
    clip(data.lang || request.headers.get("Accept-Language"), 8),
    clip(request.headers.get("Referer"), 300),
    ip,
    clip(request.headers.get("user-agent"), 300),
  ];

  try {
    await insert(env, values);
  } catch (_) {
    // Either the table does not exist yet (first subscription on a fresh
    // database) or the address is already subscribed. Create the table and
    // retry once; a second failure on a valid address means it is a duplicate,
    // which is a success from the subscriber's point of view.
    try {
      await createTable(env);
      await insert(env, values);
    } catch (_e) {
      return json({ success: true, message: "أنت مشترك بالفعل في النشرة." });
    }
  }

  return json({ success: true, message: "تمّ اشتراكك في النشرة البريدية." });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
}

/* ── helpers ───────────────────────────────────────────────── */

function insert(env, values) {
  return env.DB.prepare(
    "INSERT INTO newsletter_subscribers (id, created_at, email, lang, page, ip, ua) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(...values)
    .run();
}

/** Mirrors migrations/0003_newsletter_subscribers.sql. */
async function createTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS newsletter_subscribers (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, email TEXT NOT NULL UNIQUE, lang TEXT, page TEXT, status TEXT NOT NULL DEFAULT 'subscribed', ip TEXT, ua TEXT)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_newsletter_created_at ON newsletter_subscribers (created_at)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_newsletter_status ON newsletter_subscribers (status)"
  ).run();
}

async function parseBody(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) {
      const raw = await request.text();
      if (!raw || raw.length > MAX_BODY_BYTES) return null;
      return JSON.parse(raw);
    }
    const fd = await request.formData();
    const obj = {};
    for (const [k, v] of fd.entries()) obj[k] = typeof v === "string" ? v : "";
    return obj;
  } catch (_) {
    return null;
  }
}

function pick(obj, keys) {
  const lower = {};
  for (const k in obj) lower[k.toLowerCase()] = obj[k];
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function clip(value, max) {
  const s = String(value == null ? "" : value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

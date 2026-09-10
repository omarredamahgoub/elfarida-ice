/**
 * POST /api/contact-event — records a contact-intent tap (WhatsApp or phone).
 *
 * Called by js/conversion-kit.js via navigator.sendBeacon the moment a visitor
 * taps a wa.me or tel: link, so the tap is captured even though the browser is
 * already navigating away. The endpoint therefore must be fast, must never
 * block, and must always answer 204 — a failure here must never cost the
 * visitor their click.
 *
 * Why this exists: the `leads` table only ever recorded people who completed a
 * form. Most Saudi B2B buyers open WhatsApp or dial instead, so that traffic
 * was invisible to the owner. GA4 counts it, but only in aggregate and behind a
 * separate login; it cannot answer "who contacted us and from which page".
 *
 * Anti-abuse: honeypot-free by nature (no user input), but bounded by a payload
 * cap and a per-IP rate limit, both failing open.
 *
 * Bindings: DB — D1 database "elfarida-leads".
 */

const MAX_BODY_BYTES = 2000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_EVENTS = 40;

/** Values the client may send; anything else is rejected rather than stored. */
const CHANNELS = new Set(["whatsapp", "phone"]);

const REF_RE = /^EFI-[0-9A-Z]{4}$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  // Always 204: the visitor is mid-navigation and nothing here is worth failing.
  const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

  if (!env.DB) return done();

  let data;
  try {
    const raw = await request.text();
    if (!raw || raw.length > MAX_BODY_BYTES) return done();
    data = JSON.parse(raw);
  } catch (_) {
    return done();
  }
  if (!data || typeof data !== "object") return done();

  const channel = String(data.channel || "").toLowerCase();
  if (!CHANNELS.has(channel)) return done();

  const ip = request.headers.get("CF-Connecting-IP") || "";

  // Per-IP flood guard. Fails open — a check error must not drop a real event.
  if (ip) {
    try {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      const recent = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM contact_events WHERE ip = ? AND created_at > ?"
      )
        .bind(ip, since)
        .first();
      if (recent && recent.n >= RATE_MAX_EVENTS) return done();
    } catch (_) {
      /* fail open */
    }
  }

  const ref = REF_RE.test(String(data.ref || "")) ? String(data.ref) : null;

  const values = [
    crypto.randomUUID(),
    new Date().toISOString(),
    ref,
    channel,
    clip(data.location, 60),
    clip(data.page, 300),
    clip(data.pageTitle, 200),
    clip(data.lang, 8),
    clip(data.context, 500),
    clip(request.headers.get("Referer"), 300),
    ip,
    clip(request.headers.get("user-agent"), 300),
  ];

  try {
    await insert(env, values);
  } catch (_) {
    // The table is normally created by the admin panel's ensure(), but the
    // first visitor can easily tap WhatsApp before the owner ever opens the
    // panel. Rather than lose that tap, create the table and retry once.
    try {
      await createTable(env);
      await insert(env, values);
    } catch (_e) {
      /* give up silently — a dropped analytics row must never cost a click */
    }
  }

  return done();
}

function insert(env, values) {
  return env.DB.prepare(
    "INSERT INTO contact_events (id, created_at, ref, channel, location, page, page_title, lang, context, referrer, ip, ua) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(...values)
    .run();
}

/** Mirrors migrations/0002_contact_events.sql. */
async function createTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS contact_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ref TEXT, channel TEXT NOT NULL, location TEXT, page TEXT, page_title TEXT, lang TEXT, context TEXT, referrer TEXT, ip TEXT, ua TEXT)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_contact_events_created_at ON contact_events (created_at)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_contact_events_ref ON contact_events (ref)"
  ).run();
}

/** Trims and length-caps a client-supplied string; returns "" for empty input. */
function clip(value, max) {
  const s = String(value == null ? "" : value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** A stray GET (crawler, prefetch) should be cheap and silent, not a 405 page. */
export function onRequestGet() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

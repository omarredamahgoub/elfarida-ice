/**
 * workers/digest — the daily summary, delivered instead of waited for.
 *
 * The admin panel already builds this message; what it cannot do is arrive on
 * its own, because Cloudflare Pages Functions have no scheduler. This Worker
 * exists only to close that gap: one cron a morning, the same D1 database, the
 * same dailyDigest() the panel renders.
 *
 * It exposes no fetch handler on purpose. A "send now" URL would be a public
 * endpoint reading the lead table, and the panel's own WhatsApp button already
 * covers sending on demand — so there is nothing to protect here because there
 * is nothing reachable.
 */

import { dailyDigest, dayDisplay, dayKeyBack } from "../../../functions/admin/_digest-lib.js";

/**
 * How far back to read. The digest names today and yesterday, and the waiting
 * queue reaches further, so the window is generous but still bounded — an
 * unbounded read would grow into a timeout years from now without anyone
 * noticing it had started to.
 */
const LOOKBACK_DAYS = 120;
const ROW_CAP = 20000;

const DEFAULT_FROM = "Elfarida Ice <no-reply@elfaridaice.com>";
const DEFAULT_TO = "info@elfaridaice.com";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, new Date(event.scheduledTime || Date.now())));
  },
};

export async function run(env, now) {
  if (!env.DB) return { sent: false, reason: "no-db" };

  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000).toISOString();
  const [leads, contacts, config] = await Promise.all([
    readLeads(env, since),
    readContacts(env, since),
    readConfig(env),
  ]);

  const digest = dailyDigest(leads, contacts, now);

  // Sent every day, including silent ones. A digest that only arrives when
  // something happened makes its absence ambiguous — the owner cannot tell a
  // quiet Tuesday from a cron that stopped firing three weeks ago, and for this
  // business a quiet week is itself the thing worth knowing.
  const outcome =
    !config.apiKey || !config.to.length
      ? { sent: false, reason: "no-mail-config" }
      : (await send(config, digest, dayDisplay(dayKeyBack(now, 0))))
        ? { sent: true, reason: "" }
        : { sent: false, reason: "send-failed" };

  await recordRun(env, now, outcome);
  return outcome;
}

/**
 * Leaves a trace of what the cron decided, in the settings table the admin
 * panel already reads.
 *
 * A scheduled job whose only output is an email has no way of reporting that
 * it stopped: the owner would see no digest and have no way to tell a broken
 * binding from a quiet inbox. Writing the outcome where the panel can show it
 * turns silence into a visible date that stops advancing.
 *
 * Best-effort on purpose — failing to record must never be the reason a digest
 * that was already sent is treated as failed.
 */
async function recordRun(env, now, outcome) {
  try {
    await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('digest_last_run', ?)")
      .bind(JSON.stringify({ at: now.toISOString(), sent: outcome.sent, reason: outcome.reason }))
      .run();
  } catch (_) {
    /* settings table absent, or read-only — the digest itself already went */
  }
}

async function readLeads(env, since) {
  const { results } = await env.DB.prepare(
    // Open requests are pulled regardless of age: the queue line in the digest
    // is about what is still unanswered, and a request old enough to fall out
    // of the window is exactly the one worth naming.
    `SELECT created_at, status, answered_at FROM leads
      WHERE created_at >= ?1 OR status = 'new'
      ORDER BY created_at DESC LIMIT ${ROW_CAP}`
  )
    .bind(since)
    .all();
  return results || [];
}

async function readContacts(env, since) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT created_at, channel, page, page_title FROM contact_events
        WHERE created_at >= ?1 ORDER BY created_at DESC LIMIT ${ROW_CAP}`
    )
      .bind(since)
      .all();
    return results || [];
  } catch (_) {
    // contact_events predates migration 0002 on a fresh database; a digest
    // without tap counts is still worth sending.
    return [];
  }
}

/**
 * Mail settings live in D1 beside the admin credentials, exactly where
 * /api/quote reads them, so rotating the Resend key stays a one-place change.
 * `digest_to` overrides `lead_to` for owners who want the summary and the lead
 * notifications going to different people.
 */
async function readConfig(env) {
  const row = {};
  try {
    const { results } = await env.DB.prepare(
      "SELECT k, v FROM settings WHERE k IN ('resend_api_key','lead_from','lead_to','digest_to')"
    ).all();
    for (const r of results || []) row[r.k] = r.v;
  } catch (_) {
    /* settings table absent — treated as no configuration */
  }
  return {
    apiKey: row.resend_api_key || "",
    from: row.lead_from || DEFAULT_FROM,
    to: String(row.digest_to || row.lead_to || DEFAULT_TO)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

async function send(config, digest, dayLabel) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: config.to,
      subject: `ملخص ${dayLabel} — الفريدة آيس`,
      // One string, two encodings of it. The HTML is a direction wrapper and
      // nothing more, so there is no second copy of the message to keep in step.
      text: digest,
      html: htmlWrap(digest),
    }),
  });
  return resp.ok;
}

export function htmlWrap(digest) {
  return (
    '<div dir="rtl" style="font-family:system-ui,Tahoma,sans-serif;font-size:15px;line-height:1.9;color:#1e293b">' +
    `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${esc(digest)}</pre>` +
    "</div>"
  );
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

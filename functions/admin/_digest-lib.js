/**
 * functions/admin/_digest-lib.js
 *
 * The overview, said in a sentence.
 *
 * The panel answers questions for someone who has already opened it. The
 * digest is for the far commoner case: the owner is on a site visit and wants
 * yesterday's picture in the ten seconds it takes to read a WhatsApp message.
 * That forces a different discipline — no charts to lean on, so every number
 * has to justify the line it occupies.
 *
 * Pure and dependency-free like its siblings, so it is unit-tested directly
 * and the route only has to hand it rows.
 */

import {
  dayKey,
  riyadhDate,
  responseStats,
  waitLabel,
  hoursLabel,
  requestsLabel,
} from "./_overview-lib.js";

const DAY_MS = 86400000;

/** The Riyadh calendar day `offset` days before `now` (0 = today). */
export function dayKeyBack(now, offset) {
  return dayKey(new Date((now instanceof Date ? now.getTime() : Date.now()) - offset * DAY_MS));
}

/** Rows that fall on one Riyadh calendar day. */
export function onDay(rows, key) {
  return (rows || []).filter((r) => dayKey(r && r.created_at) === key);
}

/** "16/09/2026" from a YYYY-MM-DD Riyadh day key. */
export function dayDisplay(key) {
  const parts = String(key || "").split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(key || "");
}

/**
 * A plain-text daily summary, ready to paste into WhatsApp.
 *
 * Plain text rather than HTML on purpose: it has to survive being pasted into
 * a chat, and a line the owner cannot read on a phone in sunlight is a line
 * that does not belong in it.
 *
 * `leads` and `contacts` may span any period; only the two days the digest
 * names are read out of them, so the caller can pass the same rows the
 * overview already loaded.
 */
export function dailyDigest(leads, contacts, now = new Date()) {
  const today = dayKeyBack(now, 0);
  const yesterday = dayKeyBack(now, 1);

  const count = (rows, key, pred) => onDay(rows, key).filter((r) => (pred ? pred(r) : true)).length;

  const forms = count(leads, today);
  const whatsapp = count(contacts, today, (r) => r.channel === "whatsapp");
  const phone = count(contacts, today, (r) => r.channel === "phone");
  const total = forms + whatsapp + phone;
  const prev =
    count(leads, yesterday) +
    count(contacts, yesterday, (r) => r.channel === "whatsapp") +
    count(contacts, yesterday, (r) => r.channel === "phone");

  const stats = responseStats(leads, now);
  const top = topPage(onDay(contacts, today));

  const lines = [
    `الفريدة آيس — ملخص ${dayDisplay(today)}`,
    "",
    `طلبات النماذج: ${forms}`,
    `واتساب: ${whatsapp}`,
    `مكالمات: ${phone}`,
    `الإجمالي: ${total} (أمس: ${prev})`,
  ];

  lines.push("");
  if (stats.pending) {
    const oldest = stats.oldest ? ` — أقدمها منتظر منذ ${waitLabel(stats.oldest.waitedHours)}` : "";
    lines.push(`بانتظار الرد: ${requestsLabel(stats.pending)}${oldest}`);
    if (stats.overdue) {
      lines.push(`منها ${stats.overdue} بلا رد منذ أكثر من ${hoursLabel(stats.slaHours)}.`);
    }
  } else {
    lines.push("بانتظار الرد: لا شيء.");
  }

  // Stated only once enough replies exist to mean anything; below that it is
  // one or two anecdotes wearing the clothes of a metric.
  if (stats.median != null) {
    lines.push(`وسيط زمن الرد: ${waitLabel(stats.median)}.`);
  }

  if (top) {
    lines.push("", `أكثر صفحة ولّدت تواصلاً اليوم: ${top.title || top.page} (${top.count}).`);
  }

  return lines.join("\n");
}

/** The single page that produced the most taps, or null on a quiet day. */
function topPage(rows) {
  const counts = new Map();
  for (const r of rows || []) {
    const key = String((r && r.page) || "").trim();
    if (!key) continue;
    const entry = counts.get(key) || { page: key, title: (r && r.page_title) || "", count: 0 };
    entry.count += 1;
    if (!entry.title && r.page_title) entry.title = r.page_title;
    counts.set(key, entry);
  }
  const list = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.page.localeCompare(b.page)
  );
  return list.length ? list[0] : null;
}

/** The digest's own "as of" line, in Riyadh time. */
export function digestStamp(now = new Date()) {
  const d = riyadhDate(now);
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} بتوقيت الرياض`;
}

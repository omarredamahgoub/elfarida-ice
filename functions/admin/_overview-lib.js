/**
 * Aggregation helpers for the admin overview (لوحة المراقبة).
 *
 * The three demand streams already existed as separate tables — form quotes in
 * `leads`, WhatsApp and click-to-call taps in `contact_events` — but only as
 * flat lists. A list answers "who contacted us", never "is demand rising",
 * "when do people actually call" or "which page produces contacts". Those are
 * the questions that change what the owner does next, so they are computed
 * here rather than left to be eyeballed.
 *
 * Every bucket is cut in Riyadh local time. Bucketing in UTC would place every
 * contact made between 9pm and midnight Saudi time on the following day, which
 * silently shifts a fifth of the evening traffic into the wrong column and
 * makes the peak-hour histogram point at the wrong shift.
 *
 * Pure functions only: no D1, no Request, no DOM. They are unit-tested in
 * tests/overview-lib.test.mjs.
 */

/** Riyadh is UTC+03:00 year-round — the Kingdom observes no daylight saving. */
export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

const DAY_MS = 86400000;

/** Arabic weekday names, Sunday first, matching the Saudi working week. */
export const WEEKDAY_LABELS_AR = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/**
 * Shifts an instant into Riyadh local time.
 *
 * Returns a Date whose UTC getters read as Riyadh wall-clock values, so
 * getUTCHours() is the local hour and toISOString().slice(0,10) is the local
 * calendar day. Never use it for display without accounting for that.
 */
export function riyadhDate(value) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(t)) return null;
  return new Date(t + RIYADH_OFFSET_MS);
}

/** Riyadh calendar day of a timestamp, as YYYY-MM-DD, or null if unparsable. */
export function dayKey(value) {
  const d = riyadhDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Riyadh hour of day (0–23), or null if unparsable. */
export function hourOf(value) {
  const d = riyadhDate(value);
  return d ? d.getUTCHours() : null;
}

/** Riyadh weekday (0 = Sunday … 6 = Saturday), or null if unparsable. */
export function weekdayOf(value) {
  const d = riyadhDate(value);
  return d ? d.getUTCDay() : null;
}

/** Short day label for a chart axis: "09-14" from "2026-09-14". */
export function shortDayLabel(key) {
  return typeof key === "string" && key.length >= 10 ? key.slice(5) : "";
}

/**
 * Counts rows per Riyadh day across the last `days` days, ending today.
 *
 * Days with no activity are present with a count of zero — a chart that skips
 * empty days hides exactly the gaps worth noticing.
 */
export function dailySeries(rows, days = 30, now = new Date()) {
  const counts = new Map();
  for (const r of rows || []) {
    const k = dayKey(r && r.created_at);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }

  const end = riyadhDate(now);
  const out = [];
  if (!end || !Number.isFinite(days) || days < 1) return out;

  for (let i = Math.floor(days) - 1; i >= 0; i -= 1) {
    const key = new Date(end.getTime() - i * DAY_MS).toISOString().slice(0, 10);
    out.push({ key, count: counts.get(key) || 0 });
  }
  return out;
}

/**
 * Merges the three streams into one day-indexed series so a stacked chart can
 * show both the total and its composition without a second pass.
 */
export function combinedSeries(streams, days = 30, now = new Date()) {
  const quotes = dailySeries((streams || {}).quotes, days, now);
  const whatsapp = dailySeries((streams || {}).whatsapp, days, now);
  const phone = dailySeries((streams || {}).phone, days, now);

  return quotes.map((d, i) => {
    const q = d.count;
    const w = (whatsapp[i] || {}).count || 0;
    const p = (phone[i] || {}).count || 0;
    return { key: d.key, quotes: q, whatsapp: w, phone: p, total: q + w + p };
  });
}

/** Rows falling inside the last `hours` hours, counted from `now`. */
function within(rows, hours, now) {
  const cutoff = (now instanceof Date ? now.getTime() : Date.parse(now)) - hours * 3600000;
  let n = 0;
  for (const r of rows || []) {
    const t = Date.parse((r && r.created_at) || "");
    if (Number.isFinite(t) && t >= cutoff) n += 1;
  }
  return n;
}

/**
 * Headline counts for one stream: today (Riyadh calendar day), the trailing 7
 * and 30 days, and the change against the preceding 7 days.
 *
 * The comparison window matters more than the raw number: "19 this week" means
 * nothing until you know last week was 31.
 */
export function windowCounts(rows, now = new Date()) {
  const todayKey = dayKey(now);
  let today = 0;
  for (const r of rows || []) {
    if (dayKey(r && r.created_at) === todayKey) today += 1;
  }

  const last7 = within(rows, 24 * 7, now);
  const last14 = within(rows, 24 * 14, now);
  const prev7 = last14 - last7;

  return {
    today,
    last7,
    prev7,
    last30: within(rows, 24 * 30, now),
    total: (rows || []).length,
    trend: deltaPct(last7, prev7),
  };
}

/**
 * Percentage change, or null when there is no baseline to compare against.
 *
 * Returning null rather than 0 or 100 keeps "no data yet" visually distinct
 * from "flat" — an arrow claiming +100% on a single event is worse than no
 * arrow at all.
 */
export function deltaPct(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return Math.round(((c - p) / p) * 100);
}

/** Counts per Riyadh hour of day, always 24 buckets. */
export function hourHistogram(rows) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const r of rows || []) {
    const h = hourOf(r && r.created_at);
    if (h != null) buckets[h].count += 1;
  }
  return buckets;
}

/** Counts per Riyadh weekday, Sunday first, always 7 buckets. */
export function weekdayHistogram(rows) {
  const buckets = WEEKDAY_LABELS_AR.map((label, weekday) => ({ weekday, label, count: 0 }));
  for (const r of rows || []) {
    const d = weekdayOf(r && r.created_at);
    if (d != null) buckets[d].count += 1;
  }
  return buckets;
}

/**
 * The busiest bucket, or null when nothing has been recorded.
 *
 * Ties resolve to the earliest bucket, which keeps the reported peak stable
 * from one page load to the next instead of flipping between equal hours.
 */
export function busiest(buckets) {
  let best = null;
  for (const b of buckets || []) {
    if (!b || !Number.isFinite(b.count) || b.count === 0) continue;
    if (!best || b.count > best.count) best = b;
  }
  return best;
}

/** "من 4 إلى 5 مساءً" — a peak hour is a range, not an instant. */
export function hourRangeLabel(hour) {
  if (!Number.isFinite(hour)) return "";
  const fmt = (h) => {
    const h24 = ((h % 24) + 24) % 24;
    const period = h24 < 12 ? "صباحاً" : "مساءً";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return { h12, period };
  };
  const a = fmt(hour);
  const b = fmt(hour + 1);
  return a.period === b.period
    ? `${a.h12}–${b.h12} ${a.period}`
    : `${a.h12} ${a.period} – ${b.h12} ${b.period}`;
}

/**
 * Normalises a reference code typed or pasted by the owner.
 *
 * The code reaches him inside the visitor's own WhatsApp message, so it
 * arrives surrounded by whatever the visitor typed around it — with or without
 * the EFI- prefix, in any case, sometimes wrapped in punctuation.
 */
export function normalizeRef(input) {
  const raw = String(input == null ? "" : input)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  const body = raw.startsWith("EFI") ? raw.slice(3) : raw;
  return body ? `EFI-${body}` : "";
}

/** Every recorded tap carrying a given reference code, newest first. */
export function findByRef(rows, input) {
  const ref = normalizeRef(input);
  if (!ref) return [];
  return (rows || [])
    .filter((r) => normalizeRef(r && r.ref) === ref)
    .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
}

/**
 * Share of each stream over the window, as whole percentages that sum to 100.
 *
 * The largest share absorbs the rounding remainder so the bar never renders a
 * one-pixel gap or overflows its track.
 */
export function shareOf(values) {
  const entries = Object.entries(values || {});
  const total = entries.reduce((n, [, v]) => n + (Number(v) || 0), 0);
  if (!total) return entries.map(([key]) => ({ key, value: 0, pct: 0 }));

  const raw = entries.map(([key, v]) => ({
    key,
    value: Number(v) || 0,
    exact: ((Number(v) || 0) / total) * 100,
  }));
  const out = raw.map((r) => ({ key: r.key, value: r.value, pct: Math.floor(r.exact) }));
  const remainder = 100 - out.reduce((n, r) => n + r.pct, 0);
  if (remainder > 0) {
    let biggest = 0;
    for (let i = 1; i < out.length; i += 1) if (out[i].value > out[biggest].value) biggest = i;
    out[biggest].pct += remainder;
  }
  return out;
}

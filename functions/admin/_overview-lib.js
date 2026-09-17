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
 * Axis-tick weekday names: the same seven days without the definite article.
 * Seven full names do not clear each other on a 320px axis; the full form stays
 * in the tooltip and the peak sentence, where there is room for it.
 */
export const WEEKDAY_SHORT_AR = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

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
export function windowCounts(rows, now = new Date(), days = 30) {
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
    // The count over whichever window the owner selected, so every number on
    // the page describes the same period as the chart beside it.
    window: within(rows, 24 * (Number(days) || 30), now),
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
  const buckets = WEEKDAY_LABELS_AR.map((label, weekday) => ({
    weekday,
    label,
    short: WEEKDAY_SHORT_AR[weekday],
    count: 0,
  }));
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

/* ── window selection ─────────────────────────────────────── */

/** Windows the owner can switch between. 90 days covers a Saudi summer peak. */
export const WINDOW_OPTIONS = [7, 30, 90];
export const DEFAULT_WINDOW = 30;

/** Clamps a user-supplied window to one we actually offer. */
export function normalizeWindow(input) {
  const n = Number.parseInt(String(input == null ? "" : input), 10);
  return WINDOW_OPTIONS.includes(n) ? n : DEFAULT_WINDOW;
}

/* ── reliability of a claimed peak ────────────────────────── */

/**
 * A peak is only reported when the sample can carry it.
 *
 * With 23 taps spread over 24 hourly buckets the busiest bucket holds one or
 * two events, and naming it "the busiest hour" states chance as fact. The
 * thresholds below are deliberately blunt: enough total events that the
 * distribution means something, and a winning bucket that is not a single
 * stray tap. Everything else reports honestly that it does not know yet.
 */
export const PEAK_MIN_TOTAL = 30;
export const PEAK_MIN_BUCKET = 3;

export function peakClaim(buckets, minTotal = PEAK_MIN_TOTAL, minBucket = PEAK_MIN_BUCKET) {
  const list = buckets || [];
  const total = list.reduce((n, b) => n + ((b && b.count) || 0), 0);
  const top = busiest(list);
  const reliable = Boolean(top && total >= minTotal && top.count >= minBucket);
  return { top, total, reliable };
}

/* ── generic grouping ─────────────────────────────────────── */

/**
 * Counts rows by one field, largest first.
 *
 * Rows whose field is empty are grouped under `emptyKey` rather than dropped:
 * a large "unknown" bucket is itself a finding about the tracking, and
 * silently discarding it would make the totals disagree with the KPI cards.
 */
export function breakdownBy(rows, field, limit = 8, emptyKey = "—") {
  const counts = new Map();
  for (const r of rows || []) {
    const raw = r && r[field];
    const key = raw == null || String(raw).trim() === "" ? emptyKey : String(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, limit));
}

/**
 * Distinct non-empty values of a field — used to separate "ten people tapped"
 * from "one person tapped ten times", which are the same number and opposite
 * situations.
 */
export function uniqueCount(rows, field) {
  const seen = new Set();
  for (const r of rows || []) {
    const v = r && r[field];
    if (v != null && String(v).trim() !== "") seen.add(String(v));
  }
  return seen.size;
}

/**
 * Taps per distinct person, to one decimal. Null when there is nothing to
 * divide — a ratio printed as 0.0 would read as a finding rather than a gap.
 */
export function repeatRatio(rows, field = "ip") {
  const people = uniqueCount(rows, field);
  const taps = (rows || []).length;
  if (!people || !taps) return null;
  return Math.round((taps / people) * 10) / 10;
}

/* ── response tracking ────────────────────────────────────── */

/**
 * How long a request may sit untouched before the panel calls it overdue.
 *
 * Deliberately a full day rather than an office-hours figure: a buyer who
 * submits at 21:00 does not expect an answer at 21:30, but one still waiting
 * the next evening has almost certainly asked someone else by then.
 */
export const SLA_HOURS = 24;

/** A lead counts as answered once it leaves the `new` status. */
export function isAnswered(row) {
  if (!row) return false;
  if (row.answered_at) return true;
  const s = String(row.status || "new");
  return s !== "" && s !== "new";
}

/** Hours between two instants, or null when either is unusable. */
export function hoursBetween(from, to) {
  const a = Date.parse(String(from || ""));
  const b = to instanceof Date ? to.getTime() : Date.parse(String(to || ""));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3600000;
}

/**
 * Leads still waiting for a reply, longest wait first.
 *
 * Sorted oldest-first on purpose: the list is a work queue, and the request
 * that has been waiting longest is the one closest to being lost.
 */
export function pendingLeads(rows, now = new Date()) {
  return (rows || [])
    .filter((r) => !isAnswered(r))
    .map((r) => ({ ...r, waitedHours: hoursBetween(r.created_at, now) }))
    .filter((r) => r.waitedHours != null)
    .sort((a, b) => b.waitedHours - a.waitedHours);
}

/** Median of a numeric list, or null when empty. Even lengths average the pair. */
export function median(values) {
  const list = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/**
 * The reply picture over a set of leads.
 *
 * Median rather than mean: one request answered a week late would drag an
 * average far past anything the owner recognises, while the median keeps
 * saying what a typical buyer actually experienced.
 *
 * `median` is null until MIN_RESPONSE_SAMPLE replies exist — the same rule the
 * peak charts follow, for the same reason.
 */
export const MIN_RESPONSE_SAMPLE = 5;

export function responseStats(rows, now = new Date(), slaHours = SLA_HOURS) {
  const list = rows || [];
  const pending = pendingLeads(list, now);
  const overdue = pending.filter((r) => r.waitedHours >= slaHours);
  const answeredTimes = list
    .filter((r) => r.answered_at)
    .map((r) => hoursBetween(r.created_at, r.answered_at))
    .filter((h) => h != null);
  const withinSla = answeredTimes.filter((h) => h < slaHours).length;
  return {
    total: list.length,
    pending: pending.length,
    overdue: overdue.length,
    oldest: pending.length ? pending[0] : null,
    answered: answeredTimes.length,
    median: answeredTimes.length >= MIN_RESPONSE_SAMPLE ? median(answeredTimes) : null,
    withinSla,
    slaPct: answeredTimes.length ? Math.round((withinSla / answeredTimes.length) * 100) : null,
    slaHours,
  };
}

/**
 * A counted noun in Arabic, which does not simply take a plural.
 *
 * One and two are carried by the noun's own form with no numeral, three to ten
 * take the broken plural, and eleven upward returns to the singular. Writing
 * "5 ساعة" or "2 ساعات" reads as machine output and quietly costs the panel its
 * credibility, so the rule is encoded once here rather than at each call site.
 */
export function arabicCount(n, forms) {
  const v = Math.abs(Math.round(Number(n) || 0));
  if (v === 1) return forms.one;
  if (v === 2) return forms.two;
  if (v >= 3 && v <= 10) return `${v} ${forms.few}`;
  return `${v} ${forms.many}`;
}

const MINUTE_FORMS = { one: "دقيقة", two: "دقيقتين", few: "دقائق", many: "دقيقة" };
const HOUR_FORMS = { one: "ساعة", two: "ساعتين", few: "ساعات", many: "ساعة" };
const DAY_FORMS = { one: "يوم", two: "يومين", few: "أيام", many: "يوماً" };
const REPLY_FORMS = { one: "ردّ واحد", two: "ردّان", few: "ردود", many: "رداً" };
const PERSON_FORMS = { one: "شخص واحد", two: "شخصان", few: "أشخاص", many: "شخصاً" };
const TAP_FORMS = { one: "ضغطة واحدة", two: "ضغطتان", few: "ضغطات", many: "ضغطة" };
const REQUEST_FORMS = { one: "طلب واحد", two: "طلبان", few: "طلبات", many: "طلباً" };

/** A duration in the coarsest unit that still carries the urgency. */
export function waitLabel(hours) {
  if (hours == null || !Number.isFinite(hours)) return "";
  if (hours < 1) return arabicCount(Math.max(1, hours * 60), MINUTE_FORMS);
  if (hours < 24) return arabicCount(hours, HOUR_FORMS);
  return arabicCount(Math.floor(hours / 24), DAY_FORMS);
}

/**
 * A threshold, always in hours.
 *
 * waitLabel would render 24 as "يوم", which reads well after "انتظر" and badly
 * after "تجاوز" or "منذ أكثر من", where the counted noun is expected. The two
 * phrasings are kept apart rather than one being bent to cover both.
 */
export function hoursLabel(n) {
  return arabicCount(n, HOUR_FORMS);
}

export function repliesLabel(n) {
  return arabicCount(n, REPLY_FORMS);
}

export function peopleLabel(n) {
  return arabicCount(n, PERSON_FORMS);
}

export function tapsLabel(n) {
  return arabicCount(n, TAP_FORMS);
}

export function requestsLabel(n) {
  return arabicCount(n, REQUEST_FORMS);
}

/* ── tap → request attribution ────────────────────────────── */

/**
 * Which contact taps turned into a submitted form.
 *
 * The reference code is minted once per page view and travels into both the
 * WhatsApp message and any form submitted from that same view, so a shared
 * code is real evidence that one visitor did both — unlike matching on IP,
 * which collapses everyone behind a mobile carrier's NAT into one person.
 *
 * Only taps are counted as the denominator: a form submitted without a tap
 * never had a tap to convert.
 */
export function tapConversion(leads, events) {
  const leadRefs = new Set((leads || []).map((r) => normalizeRef(r && r.ref)).filter((v) => v));
  const tapRefs = new Set((events || []).map((r) => normalizeRef(r && r.ref)).filter((v) => v));
  let converted = 0;
  for (const ref of tapRefs) if (leadRefs.has(ref)) converted += 1;
  return {
    taps: tapRefs.size,
    converted,
    pct: tapRefs.size ? Math.round((converted / tapRefs.size) * 100) : null,
  };
}

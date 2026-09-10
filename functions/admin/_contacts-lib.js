/**
 * functions/admin/_contacts-lib.js
 *
 * Pure, dependency-free helpers for the contact-events view of the admin panel
 * (/admin/leads?view=contacts). Same convention as _leads-lib.js: the leading
 * underscore keeps Cloudflare Pages Functions from routing this file, and every
 * export avoids D1/crypto/Request so it can be unit-tested under node:test.
 */

export const CHANNELS = ["whatsapp", "phone"];

export const CHANNEL_LABELS_AR = {
  whatsapp: "واتساب",
  phone: "مكالمة",
};

/** Where on the page the tap happened, in the owner's language. */
export const LOCATION_LABELS_AR = {
  dock: "الزر العائم",
  header: "أعلى الصفحة",
  "inline-capture": "نموذج داخل الصفحة",
  "calculator-result": "نتيجة الحاسبة",
  "maintenance-estimator": "حاسبة عقود الصيانة",
  "maintenance-final-cta": "صفحة عقود الصيانة",
  inline: "رابط داخل المحتوى",
};

export function channelLabel(channel) {
  return CHANNEL_LABELS_AR[channel] || String(channel || "");
}

export function locationLabel(location) {
  return LOCATION_LABELS_AR[location] || String(location || "");
}

export function isValidChannel(channel) {
  return CHANNELS.includes(channel);
}

/**
 * Free-text match across a contact event's searchable fields. Matching the
 * reference code is the important case: the owner receives a WhatsApp message
 * containing "مرجع: EFI-7K3M" and pastes that code into the search box to find
 * out which page produced it.
 *
 * An empty query always matches.
 */
export function matchesContactQuery(row, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  const haystack = [row.ref, row.page, row.page_title, row.context, row.location, row.channel]
    .map((v) => String(v || "").toLowerCase())
    .join("   ");
  return haystack.includes(q);
}

/** Channel filter. An empty filter always matches. */
export function matchesChannel(row, channel) {
  if (!channel) return true;
  return row.channel === channel;
}

/**
 * Counts per channel plus the overall total, over the rows given.
 * Unknown channels are counted in `total` but not attributed to a channel,
 * so the numbers never silently disagree.
 */
export function channelBreakdown(rows) {
  const out = { whatsapp: 0, phone: 0, total: 0 };
  for (const r of rows || []) {
    out.total++;
    if (r.channel === "whatsapp") out.whatsapp++;
    else if (r.channel === "phone") out.phone++;
  }
  return out;
}

/**
 * The pages that produced the most contact taps, most first.
 * Answers the question the owner actually cares about: which pages make the
 * phone ring.
 */
export function topPages(rows, limit = 8) {
  const counts = new Map();
  for (const r of rows || []) {
    const key = String(r.page || "").trim();
    if (!key) continue;
    const entry = counts.get(key) || { page: key, title: r.page_title || "", count: 0 };
    entry.count++;
    if (!entry.title && r.page_title) entry.title = r.page_title;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.page.localeCompare(b.page))
    .slice(0, Math.max(0, limit));
}

/**
 * Combines form leads and contact events into one reverse-chronological
 * timeline, each entry tagged with its `kind`, so the owner sees every way a
 * visitor reached out in a single list instead of two disconnected tables.
 */
export function mergeTimeline(leads, events) {
  const a = (leads || []).map((r) => ({
    kind: "lead",
    created_at: r.created_at,
    channel: "form",
    label: r.name || r.phone || r.email || "",
    detail: r.subject || "",
    page: r.payload_page || "",
    ref: "",
    raw: r,
  }));
  const b = (events || []).map((r) => ({
    kind: "event",
    created_at: r.created_at,
    channel: r.channel,
    label: channelLabel(r.channel),
    detail: r.context || r.page_title || "",
    page: r.page || "",
    ref: r.ref || "",
    raw: r,
  }));
  return [...a, ...b].sort((x, y) => {
    const tx = Date.parse(x.created_at);
    const ty = Date.parse(y.created_at);
    const nx = Number.isNaN(tx) ? 0 : tx;
    const ny = Number.isNaN(ty) ? 0 : ty;
    return ny - nx;
  });
}

/**
 * A device hint from the user-agent — enough to tell a phone from a desktop
 * without pretending to do real device detection.
 */
export function deviceHint(ua) {
  const s = String(ua || "").toLowerCase();
  if (!s) return "";
  if (/ipad|tablet/.test(s)) return "جهاز لوحي";
  if (/mobi|android|iphone/.test(s)) return "جوال";
  return "كمبيوتر";
}

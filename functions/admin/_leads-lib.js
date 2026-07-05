/**
 * functions/admin/_leads-lib.js
 *
 * Pure, dependency-free helper functions for the /admin/leads panel.
 * The leading underscore keeps Cloudflare Pages Functions from treating
 * this file as a routable page (same convention as _middleware.js).
 *
 * Every export here is free of D1/crypto/Request usage on purpose, so
 * each one can be unit-tested with Node's built-in test runner (see
 * tests/admin-leads-lib.test.mjs) without mocking the Workers runtime.
 */

export const STATUS_OPTIONS = ["new", "contacted", "closed"];
export const DEFAULT_STATUS = "new";

export const STATUS_LABELS_AR = {
  new: "جديد",
  contacted: "تم التواصل",
  closed: "مغلق",
};

export function isValidStatus(status) {
  return STATUS_OPTIONS.includes(status);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Decide whether an IP should be blocked from attempting another admin
 * login, given the ISO timestamps of its recent attempts, the current
 * time, the size of the sliding window (ms) and the max attempts allowed
 * inside that window.
 */
export function isRateLimited(attemptTimestamps, now, windowMs, maxAttempts) {
  const cutoff = now.getTime() - windowMs;
  const recent = (attemptTimestamps || []).filter((ts) => {
    const t = Date.parse(ts);
    return !Number.isNaN(t) && t > cutoff;
  });
  return recent.length >= maxAttempts;
}

/**
 * Case-insensitive free-text match of a query against a lead row's
 * searchable fields. An empty/blank query always matches.
 */
export function matchesQuery(row, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  const haystack = [row.name, row.email, row.phone, row.subject]
    .map((v) => String(v || "").toLowerCase())
    .join("   ");
  return haystack.includes(q);
}

/**
 * Status filter match. An empty status filter always matches; a row with
 * no status recorded yet is treated as DEFAULT_STATUS.
 */
export function matchesStatus(row, status) {
  if (!status) return true;
  return (row.status || DEFAULT_STATUS) === status;
}

/** Asia/Riyadh has a fixed UTC+3 offset year-round (no daylight saving). */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Format a UTC ISO timestamp as "DD/MM/YYYY HH:mm" in Asia/Riyadh time.
 * Computed with plain date arithmetic (no Intl/ICU dependency) so the
 * output is identical on every machine.
 */
export function toRiyadhDisplay(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString || "");
  const riyadh = new Date(d.getTime() + RIYADH_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${pad(riyadh.getUTCDate())}/${pad(riyadh.getUTCMonth() + 1)}/${riyadh.getUTCFullYear()} ` +
    `${pad(riyadh.getUTCHours())}:${pad(riyadh.getUTCMinutes())}`
  );
}

/**
 * Whether a lead's created_at timestamp falls within the last `hours`
 * hours relative to `now`.
 */
export function isRecent(isoString, now, hours = 24) {
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= hours * 60 * 60 * 1000;
}

/**
 * Quick stats (today / this week / total) over a list of rows carrying a
 * created_at ISO timestamp, relative to `now`.
 *
 * "Today" is the current calendar day in Asia/Riyadh time, not the host
 * machine's local time or a plain 24h lookback — computed with UTC-only
 * date math (no local Date getters/setters) so the result is identical
 * regardless of the runtime's own timezone.
 */
export function computeStats(rows, now) {
  const riyadhNow = new Date(now.getTime() + RIYADH_OFFSET_MS);
  const riyadhMidnightUtc = Date.UTC(
    riyadhNow.getUTCFullYear(),
    riyadhNow.getUTCMonth(),
    riyadhNow.getUTCDate(),
  );
  const startOfDayUtc = riyadhMidnightUtc - RIYADH_OFFSET_MS;
  const weekAgoUtc = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  let today = 0;
  let week = 0;
  for (const r of rows || []) {
    const t = Date.parse(r.created_at);
    if (Number.isNaN(t)) continue;
    if (t >= startOfDayUtc) today++;
    if (t >= weekAgoUtc) week++;
  }
  return { today, week, total: (rows || []).length };
}

/**
 * Build a tel: href from a raw phone string, keeping only a leading "+"
 * and digits. Returns "" for an empty/unusable phone value.
 */
export function buildTelHref(phone) {
  const p = String(phone || "").trim();
  if (!p) return "";
  const cleaned = p.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

/**
 * Build a wa.me href from a raw phone string. Normalizes a leading "0"
 * (Saudi local format) to the "966" country code; any other leading
 * digits (already-international format) are left as-is.
 */
export function buildWaHref(phone) {
  const p = String(phone || "").trim();
  if (!p) return "";
  let digits = p.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = "966" + digits.slice(1);
  return `https://wa.me/${digits}`;
}

/** Build a mailto: href, or "" for an empty email value. */
export function buildMailtoHref(email) {
  const e = String(email || "").trim();
  return e ? `mailto:${e}` : "";
}

/* ── pagination ───────────────────────────────────────────── */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Slice `rows` into the requested page. `page` may be a string (as read
 * from a URL query param), 1-based, and is clamped to [1, totalPages].
 * Any non-numeric or out-of-range value falls back to page 1.
 */
export function paginate(rows, page, pageSize = DEFAULT_PAGE_SIZE) {
  const list = rows || [];
  const size =
    Number.isFinite(pageSize) && pageSize > 0
      ? Math.floor(pageSize)
      : DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const rawPage = Number.parseInt(page, 10);
  const current =
    Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, totalPages) : 1;
  const start = (current - 1) * size;
  return {
    pageRows: list.slice(start, start + size),
    page: current,
    totalPages,
    total: list.length,
    pageSize: size,
  };
}

/* ── sorting ──────────────────────────────────────────────── */
export const SORT_FIELDS = ["created_at", "name", "status"];
export const DEFAULT_SORT_FIELD = "created_at";
export const DEFAULT_SORT_DIR = "desc";

export function isValidSortField(field) {
  return SORT_FIELDS.includes(field);
}

export function isValidSortDir(dir) {
  return dir === "asc" || dir === "desc";
}

function sortValue(row, field) {
  if (field === "created_at") {
    const t = Date.parse(row.created_at);
    return Number.isNaN(t) ? 0 : t;
  }
  return String(row[field] || "").toLowerCase();
}

/**
 * Stable sort of `rows` by one of SORT_FIELDS. Falls back to
 * DEFAULT_SORT_FIELD / DEFAULT_SORT_DIR for an invalid field/dir.
 * Stability is enforced explicitly (decorate-sort-undecorate) rather
 * than relying on the engine's Array#sort guarantee.
 */
export function sortRows(rows, field, dir) {
  const key = isValidSortField(field) ? field : DEFAULT_SORT_FIELD;
  const direction = isValidSortDir(dir) ? dir : DEFAULT_SORT_DIR;
  const factor = direction === "asc" ? 1 : -1;
  return (rows || [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = sortValue(a.row, key);
      const bv = sortValue(b.row, key);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * Decide the next sort direction when the user clicks a column header.
 * Clicking the currently-active column toggles its direction; switching
 * to a new column resets to a sensible default (newest-first for dates,
 * A→Z for text columns).
 */
export function toggleSortDir(currentField, currentDir, targetField) {
  if (currentField === targetField) {
    return currentDir === "asc" ? "desc" : "asc";
  }
  return targetField === "created_at" ? "desc" : "asc";
}

/* ── duplicate-contact detection ─────────────────────────── */
function normalizeContactKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Return a new array of rows, each augmented with `isDuplicate: boolean`,
 * true when the row's phone or email also appears on another row in the
 * same input list. Blank phone/email values never count as a match
 * (avoids flagging every lead that simply omitted an email). The
 * comparison is scoped to the rows passed in (e.g. the most recent 500
 * leads), not the full historical table.
 */
export function markDuplicates(rows) {
  const list = rows || [];
  const phoneCounts = new Map();
  const emailCounts = new Map();
  for (const r of list) {
    const phoneKey = normalizeContactKey(r.phone);
    const emailKey = normalizeContactKey(r.email);
    if (phoneKey)
      phoneCounts.set(phoneKey, (phoneCounts.get(phoneKey) || 0) + 1);
    if (emailKey)
      emailCounts.set(emailKey, (emailCounts.get(emailKey) || 0) + 1);
  }
  return list.map((r) => {
    const phoneKey = normalizeContactKey(r.phone);
    const emailKey = normalizeContactKey(r.email);
    const isDuplicate = Boolean(
      (phoneKey && phoneCounts.get(phoneKey) > 1) ||
      (emailKey && emailCounts.get(emailKey) > 1),
    );
    return { ...r, isDuplicate };
  });
}

/* ── admin password change ───────────────────────────────── */
/** Minimum acceptable length for a new admin password (same rule as setup). */
export function isValidNewPassword(pass) {
  return typeof pass === "string" && pass.length >= 8;
}

/* ── query-string helper ──────────────────────────────────── */
/**
 * Build a URL query string from a plain object, dropping null/undefined/
 * empty-string values. Used to construct sort/pagination links that
 * preserve the current filters.
 */
export function buildQueryString(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  return usp.toString();
}

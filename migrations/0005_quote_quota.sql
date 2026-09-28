-- Site-wide intake and mail budgets for /api/quote (functions/api/quote.js → takeQuota).
--
-- Added after the 2026-09-25 → 09-28 spam run: 17 480 fake submissions from
-- 866 IP addresses, each sending two mails, exhausted the Resend account and
-- real leads stopped reaching the owner. A per-IP limit cannot stop traffic
-- spread across hundreds of addresses; one row per consumed unit, pruned to
-- the longest budget window (24 h) on every write, bounds unverified intake
-- (hourly) and every class of outbound mail (daily, sized to the mail plan)
-- regardless of how many addresses a sender controls.
--
-- The Function also creates this table on first use, so applying this file is
-- optional; it exists so the schema is reproducible from migrations/ alone.
CREATE TABLE IF NOT EXISTS quote_quota (
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quote_quota_kind_created ON quote_quota (kind, created_at);

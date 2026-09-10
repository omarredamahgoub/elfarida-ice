-- Newsletter subscribers, kept out of the `leads` table.
--
-- The footer subscription form posted to /api/quote, so every e-mail address
-- typed into it was stored as a sales lead and triggered the "new quote
-- request" notification. The owner therefore could not tell a buyer from a
-- newsletter signup, and the lead count in the admin panel was inflated by
-- traffic that had expressed no purchase intent at all.
--
-- A subscription is an entirely different object: one column of interest,
-- no sales follow-up, and an address that must never be inserted twice.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,  -- re-subscribing must not create a duplicate
  lang          TEXT,
  page          TEXT,
  status        TEXT NOT NULL DEFAULT 'subscribed',
  ip            TEXT,
  ua            TEXT
);

CREATE INDEX IF NOT EXISTS idx_newsletter_created_at ON newsletter_subscribers (created_at);
CREATE INDEX IF NOT EXISTS idx_newsletter_status     ON newsletter_subscribers (status);

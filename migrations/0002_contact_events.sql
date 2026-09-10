-- Contact-intent events: every WhatsApp / click-to-call tap made from the site.
--
-- The forms table (`leads`) only ever saw visitors who filled in a form. In the
-- Saudi market most buyers open WhatsApp or dial instead, so that traffic was
-- invisible to the owner and visible only as an aggregate count in GA4.
--
-- `ref` is the short code embedded in the pre-filled WhatsApp message
-- (e.g. EFI-7K3M). When the visitor actually sends that message, the code
-- travels with it, letting the owner match a real conversation back to the
-- exact page, moment and context that produced it.
CREATE TABLE IF NOT EXISTS contact_events (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  ref         TEXT,
  channel     TEXT NOT NULL,          -- 'whatsapp' | 'phone'
  location    TEXT,                   -- dock | header | inline-capture | calculator-result | ...
  page        TEXT,
  page_title  TEXT,
  lang        TEXT,
  context     TEXT,                   -- carried detail, e.g. the calculator result
  referrer    TEXT,
  ip          TEXT,
  ua          TEXT
);

CREATE INDEX IF NOT EXISTS idx_contact_events_created_at ON contact_events (created_at);
CREATE INDEX IF NOT EXISTS idx_contact_events_ref        ON contact_events (ref);
CREATE INDEX IF NOT EXISTS idx_contact_events_channel    ON contact_events (channel);

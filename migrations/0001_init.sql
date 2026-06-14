-- Leads captured from the website quote/contact forms.
CREATE TABLE IF NOT EXISTS leads (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  subject     TEXT,
  payload     TEXT,
  ip          TEXT,
  ua          TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email);

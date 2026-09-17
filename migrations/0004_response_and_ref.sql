-- Response tracking and tap-to-request attribution on `leads`.
--
-- `status` already recorded whether a request had been dealt with, but not
-- WHEN. Without that instant the panel could say "2 requests are still open"
-- and never "this one has been open since Tuesday", which is the sentence that
-- actually makes someone pick up the phone. `answered_at` is stamped the first
-- time a lead leaves the `new` status and cleared if it is put back.
--
-- `ref` is the same short code as contact_events.ref: minted once per page
-- view and carried into both the pre-filled WhatsApp message and any form
-- submitted from that view. A shared code is evidence one visitor did both,
-- which matching on IP cannot give — mobile carriers put thousands of buyers
-- behind one address.
ALTER TABLE leads ADD COLUMN answered_at TEXT;
ALTER TABLE leads ADD COLUMN ref TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_answered_at ON leads (answered_at);
CREATE INDEX IF NOT EXISTS idx_leads_ref         ON leads (ref);

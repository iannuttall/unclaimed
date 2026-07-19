-- Tracking store for curated brandable words across tracked TLDs.
-- One row per domain (word × tld). The cron re-checks the stalest rows and
-- records availability, expiry, drop estimate and site presence over time.

CREATE TABLE IF NOT EXISTS domains (
  domain               TEXT PRIMARY KEY,          -- "prompt.io"
  word                 TEXT NOT NULL,             -- "prompt"
  tld                  TEXT NOT NULL,             -- "io"
  status               TEXT NOT NULL DEFAULT 'unknown', -- available | registered | unknown
  source               TEXT,                      -- rdap | whois
  expiry               TEXT,                      -- ISO, when registered + known
  estimated_available  TEXT,                      -- ISO drop estimate (expiry + 80d)
  site_status          TEXT,                      -- live | parked | none | unknown
  has_site             INTEGER,                   -- 1 = real site, 0 = not, NULL = unchecked
  cold_outreach        INTEGER NOT NULL DEFAULT 0,-- 1 = registered but parked/no-site
  http_status          INTEGER,
  first_seen           TEXT NOT NULL,             -- ISO, row created
  last_checked         TEXT,                      -- ISO, NULL = never checked
  became_available_at  TEXT,                      -- ISO, set when it flips to available
  check_count          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_status        ON domains(status);
CREATE INDEX IF NOT EXISTS idx_last_checked  ON domains(last_checked);
CREATE INDEX IF NOT EXISTS idx_estimated     ON domains(status, estimated_available);
CREATE INDEX IF NOT EXISTS idx_cold          ON domains(cold_outreach);
CREATE INDEX IF NOT EXISTS idx_word          ON domains(word);

-- Append-only log of status changes, so you can see when a name dropped or got
-- taken without polling the live endpoints.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT NOT NULL,
  at          TEXT NOT NULL,                      -- ISO
  from_status TEXT,
  to_status   TEXT NOT NULL,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_domain ON events(domain);
CREATE INDEX IF NOT EXISTS idx_events_at     ON events(at);

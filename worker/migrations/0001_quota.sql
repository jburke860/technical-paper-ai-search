CREATE TABLE IF NOT EXISTS demo_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

INSERT OR IGNORE INTO demo_control (id, enabled) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS daily_quota (
  quota_date TEXT PRIMARY KEY,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  quota_limit INTEGER NOT NULL CHECK (quota_limit > 0 AND quota_limit <= 200),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS browser_daily_quota (
  quota_date TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  quota_limit INTEGER NOT NULL CHECK (quota_limit > 0 AND quota_limit <= 20),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (quota_date, browser_hash)
) STRICT;

CREATE TABLE IF NOT EXISTS browser_burst_quota (
  window_start TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  quota_limit INTEGER NOT NULL CHECK (quota_limit > 0 AND quota_limit <= 3),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (window_start, browser_hash)
) STRICT;

CREATE INDEX IF NOT EXISTS browser_daily_quota_date_idx
  ON browser_daily_quota (quota_date);

CREATE INDEX IF NOT EXISTS browser_burst_quota_window_idx
  ON browser_burst_quota (window_start);

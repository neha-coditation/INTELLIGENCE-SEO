-- Read-only Google integrations. No OAuth keys or access tokens stored in D1.
CREATE TABLE IF NOT EXISTS google_sync_runs (
  id TEXT PRIMARY KEY,
  gsc_property TEXT NOT NULL,
  ga_property TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  gsc_rows INTEGER NOT NULL DEFAULT 0,
  ga_rows INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_google_sync_finished ON google_sync_runs(status, finished_at DESC);
CREATE TABLE IF NOT EXISTS google_search_metrics (
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  key_value TEXT NOT NULL,
  clicks REAL NOT NULL DEFAULT 0,
  impressions REAL NOT NULL DEFAULT 0,
  ctr REAL NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY(start_date,end_date,kind,key_value)
);
CREATE INDEX IF NOT EXISTS idx_google_search_kind ON google_search_metrics(kind, impressions DESC);
CREATE TABLE IF NOT EXISTS google_analytics_metrics (
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  key_value TEXT NOT NULL,
  sessions INTEGER NOT NULL DEFAULT 0,
  engaged_sessions INTEGER NOT NULL DEFAULT 0,
  active_users INTEGER NOT NULL DEFAULT 0,
  key_events REAL NOT NULL DEFAULT 0,
  PRIMARY KEY(start_date,end_date,kind,key_value)
);
CREATE INDEX IF NOT EXISTS idx_google_analytics_kind ON google_analytics_metrics(kind,sessions DESC);
CREATE TABLE IF NOT EXISTS google_url_inspections (
  url TEXT PRIMARY KEY,
  property TEXT NOT NULL,
  verdict TEXT NOT NULL,
  coverage_state TEXT,
  indexing_state TEXT,
  last_crawl_time TEXT,
  google_canonical TEXT,
  user_canonical TEXT,
  fetched_at TEXT NOT NULL
);

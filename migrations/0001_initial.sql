CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  max_pages INTEGER NOT NULL DEFAULT 40,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  message TEXT,
  robots_text TEXT
);
CREATE TABLE IF NOT EXISTS queue (
  run_id TEXT NOT NULL,
  url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (run_id, url)
);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON queue(run_id, status);
CREATE TABLE IF NOT EXISTS pages (
  run_id TEXT NOT NULL,
  url TEXT NOT NULL,
  final_url TEXT,
  status_code INTEGER NOT NULL,
  title TEXT,
  description TEXT,
  canonical TEXT,
  h1 TEXT,
  h1_count INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  image_alt_missing INTEGER NOT NULL DEFAULT 0,
  jsonld_count INTEGER NOT NULL DEFAULT 0,
  og_title TEXT,
  og_image TEXT,
  robots TEXT,
  lang TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, url)
);
CREATE TABLE IF NOT EXISTS links (
  run_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  PRIMARY KEY (run_id, source_url, target_url)
);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(run_id, target_url);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  url TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  evidence TEXT NOT NULL,
  advice TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_issues_run ON issues(run_id, severity);
CREATE TABLE IF NOT EXISTS backlinks (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  anchor TEXT,
  state TEXT NOT NULL DEFAULT 'unverified',
  rel TEXT,
  note TEXT,
  http_status INTEGER,
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_backlinks_state ON backlinks(state);

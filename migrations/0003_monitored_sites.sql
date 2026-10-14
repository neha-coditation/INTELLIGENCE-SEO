CREATE TABLE IF NOT EXISTS monitored_sites (
 id TEXT PRIMARY KEY, 
 name TEXT NOT NULL,
 origin TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_monitored_sites_enabled ON monitored_sites(enabled,created_at);

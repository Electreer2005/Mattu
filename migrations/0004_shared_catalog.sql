CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_products_active_updated
  ON catalog_products(active, updated_at);

CREATE TABLE IF NOT EXISTS catalog_services (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_services_active_updated
  ON catalog_services(active, updated_at);

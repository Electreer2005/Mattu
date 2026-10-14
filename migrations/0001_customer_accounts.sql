CREATE TABLE IF NOT EXISTS customer_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES customer_users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_sessions_user ON customer_sessions(user_id);
CREATE TABLE IF NOT EXISTS customer_order_links (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES orders(id),
  user_id TEXT NOT NULL REFERENCES customer_users(id),
  request_key TEXT NOT NULL,
  UNIQUE(user_id, request_key)
);
CREATE INDEX IF NOT EXISTS customer_orders_user ON customer_order_links(user_id);
CREATE TABLE IF NOT EXISTS customer_reset_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES customer_users(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

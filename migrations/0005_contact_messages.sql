CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'in_progress', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contact_messages_created
  ON contact_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS contact_messages_status_created
  ON contact_messages(status, created_at DESC);

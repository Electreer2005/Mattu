-- Add server-controlled roles without changing existing customer or order records.
ALTER TABLE customer_users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';

CREATE INDEX IF NOT EXISTS idx_customer_users_role ON customer_users(role);

-- Expand inventory order-line lifecycle without losing any existing reservations.
DROP INDEX IF EXISTS inventory_order_lines_status;
ALTER TABLE inventory_order_lines RENAME TO inventory_order_lines_legacy;
CREATE TABLE inventory_order_lines (
  order_id TEXT NOT NULL,
  line_key TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  status TEXT NOT NULL CHECK(status IN ('planned', 'reserved', 'consumed', 'produced', 'released', 'dispatched')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(order_id, line_key)
);
INSERT INTO inventory_order_lines(order_id,line_key,product_id,quantity,status,created_at,updated_at)
SELECT order_id,line_key,product_id,quantity,status,created_at,updated_at
FROM inventory_order_lines_legacy;
DROP TABLE inventory_order_lines_legacy;
CREATE INDEX inventory_order_lines_status ON inventory_order_lines(status, order_id);

-- A guard row makes the optimistic order revision part of the same D1 batch as
-- inventory movements. A stale concurrent update aborts and rolls back the batch.
CREATE TABLE IF NOT EXISTS inventory_order_sync_guard (
  order_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS inventory_order_sync_guard_insert
BEFORE INSERT ON inventory_order_sync_guard
WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND revision=NEW.revision)
BEGIN
  SELECT RAISE(ABORT, 'order-revision-conflict');
END;
CREATE TRIGGER IF NOT EXISTS inventory_order_sync_guard_update
BEFORE UPDATE ON inventory_order_sync_guard
WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND revision=NEW.revision)
BEGIN
  SELECT RAISE(ABORT, 'order-revision-conflict');
END;

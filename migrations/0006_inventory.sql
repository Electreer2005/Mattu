-- Inventory foundation for finished goods, raw materials, recipes and auditable movements.
CREATE TABLE IF NOT EXISTS inventory_materials (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  unit TEXT NOT NULL DEFAULT 'unidad',
  stock_quantity REAL NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
  minimum_quantity REAL NOT NULL DEFAULT 0 CHECK(minimum_quantity >= 0),
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_materials_active_name
  ON inventory_materials(active, name);

CREATE TABLE IF NOT EXISTS inventory_finished_stock (
  product_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_products(id),
  on_hand REAL NOT NULL DEFAULT 0 CHECK(on_hand >= 0),
  reserved REAL NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= on_hand),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_recipes (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL UNIQUE REFERENCES catalog_products(id),
  output_quantity REAL NOT NULL DEFAULT 1 CHECK(output_quantity > 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_recipe_items (
  id TEXT PRIMARY KEY NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES inventory_recipes(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES inventory_materials(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  UNIQUE(recipe_id, material_id)
);
CREATE INDEX IF NOT EXISTS inventory_recipe_items_recipe
  ON inventory_recipe_items(recipe_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('material', 'finished_product')),
  entity_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('initial', 'entry', 'consumption', 'production', 'adjustment', 'reservation', 'release', 'dispatch')),
  quantity REAL NOT NULL CHECK(quantity > 0),
  reference_type TEXT NOT NULL DEFAULT 'manual',
  reference_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_movements_entity_date
  ON inventory_movements(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_reference
  ON inventory_movements(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS inventory_order_lines (
  order_id TEXT NOT NULL,
  line_key TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  status TEXT NOT NULL CHECK(status IN ('reserved', 'consumed', 'released', 'dispatched')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(order_id, line_key)
);
CREATE INDEX IF NOT EXISTS inventory_order_lines_status
  ON inventory_order_lines(status, order_id);

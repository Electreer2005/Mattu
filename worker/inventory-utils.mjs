// Inventory API helpers. All writes are performed by the authenticated admin route in worker/index.mjs.
export const inventoryUnits = ['unidad', 'g', 'kg', 'ml', 'l', 'cm', 'm', 'mm', 'par', 'hoja'];
export const inventoryCategories = ['madera', 'cuero', 'metales', 'virola', 'insumos', 'otros'];
export function inventoryId() { return crypto.randomUUID(); }
export function inventoryStamp() { return new Date().toISOString(); }
export function inventoryNumber(value, { min = 0, max = 100000000 } = {}) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

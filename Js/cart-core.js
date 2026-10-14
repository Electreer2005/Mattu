/* Funciones compartidas por el carrito y sus pruebas. */
(function (root) {
  const text = (value, max = 1500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  function normalizeItem(item, allowedIds) {
    if (!item || !allowedIds.includes(item.serviceId)) return null;
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return null;
    const piece = text(item.piece, 80), design = text(item.design);
    if (!piece || !design) return null;
    return { id: text(item.id, 100), serviceId: item.serviceId, piece, material: text(item.material, 80), design, qty };
  }
  function readCart(raw, allowedIds) {
    try { const data = JSON.parse(raw || '[]'); return Array.isArray(data) ? data.slice(0, 100).map(x => normalizeItem(x, allowedIds)).filter(Boolean) : []; }
    catch { return []; }
  }
  function addItem(cart, item) {
    const duplicate = cart.find(x => x.serviceId === item.serviceId && x.piece === item.piece && x.material === item.material && x.design === item.design);
    if (duplicate) { if (duplicate.qty + item.qty > 9999) throw Error('La cantidad máxima por diseño es 9999.'); return cart.map(x => x.id === duplicate.id ? { ...x, qty: x.qty + item.qty } : x); }
    if (cart.length >= 100) throw Error('La solicitud admite hasta 100 diseños distintos.');
    return [...cart, item];
  }
  function quoteMessage(items, services, customer) {
    const lines = ['Hola Mattu, quisiera solicitar un presupuesto.', '', 'Nombre / joyería: ' + text(customer.name, 120), 'Teléfono: ' + text(customer.phone, 40)];
    if (text(customer.email, 160)) lines.push('Correo: ' + text(customer.email, 160));
    lines.push('', 'Piezas y grabados:');
    items.forEach((item, i) => {
      const service = services.find(x => x.id === item.serviceId);
      lines.push(`${i + 1}. ${service ? service.name : 'Grabado'} · ${item.qty} unidad(es)`, 'Pieza: ' + item.piece, 'Material: ' + (item.material || 'A confirmar'), 'Detalles: ' + item.design, '');
    });
    if (text(customer.notes, 2000)) lines.push('Observaciones: ' + text(customer.notes, 2000), '');
    lines.push('Solicito confirmar precio, viabilidad del diseño y fecha de entrega.');
    return lines.join('\n');
  }
  root.MATTU_CART_CORE = { normalizeItem, readCart, addItem, quoteMessage };
})(globalThis);

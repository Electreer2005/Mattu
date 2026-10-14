import { randomToken, sha256, passwordHash, constantEqual, emailOf, validEmail, validPassword, cookie, readToken } from './security.mjs';
const now = () => Math.floor(Date.now() / 1000);
const names = { nombres: 'Nombres y fechas', miradas: 'Miradas y detalles', retratos: 'Retratos en metal', simbolos: 'Símbolos y diseños', madera: 'Grabado en madera', cuero: 'Grabado en cuero', virola: 'Grabado en virola' };
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function json(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } }); }
async function rate(db, bucket, limit, seconds) {
  const t = now();
  const row = await db.prepare('INSERT INTO customer_rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING hits').bind(bucket, t + seconds, t, t, t + seconds).first();
  return row.hits <= limit;
}
async function userFor(request, db) {
  const token = readToken(request); if (!token) return null;
  return db.prepare('SELECT u.id,u.email,u.name FROM customer_users u JOIN customer_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha256(token), now()).first();
}
async function newSession(db, userId) { const token = randomToken(); await db.prepare('INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256(token), userId, now() + 604800).run(); return token; }
async function bodyOf(request) { const text = await request.text(); if (text.length > 50000) throw Error('body-size'); return JSON.parse(text); }
async function api(request, env) {
  const path = new URL(request.url).pathname, method = request.method, db = env.DB;
  if (!db) return json({ error: 'La base de datos aún no está conectada.' }, 503);
  if (method !== 'GET' && request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Solicitud de otro origen rechazada.' }, 403);
  if (method === 'GET' && path === '/api/customer/session') return json({ user: await userFor(request, db) });
  let b = {};
  if (method === 'POST') { try { b = await bodyOf(request); } catch { return json({ error: 'Datos inválidos o demasiado grandes.' }, 400); } }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (path.startsWith('/api/customer/auth/') && method === 'POST') {
    if (!await rate(db, 'auth-ip:' + ip, 15, 60)) return json({ error: 'Demasiados intentos. Esperá un minuto.' }, 429);
    const email = emailOf(b.email);
    if (['/api/customer/auth/register', '/api/customer/auth/login'].includes(path)) {
      if (!validEmail(email) || !validPassword(b.password)) return json({ error: 'Ingresá un correo válido y una contraseña de 10 a 128 caracteres.' }, 400);
      if (!await rate(db, 'login-email:' + await sha256(email), 12, 900)) return json({ error: 'Demasiados intentos con ese correo. Probá más tarde.' }, 429);
      if (path.endsWith('/register')) {
        const name = str(b.name, 120); if (!name) return json({ error: 'Completá tu nombre.' }, 400);
        const existing = await db.prepare('SELECT id FROM customer_users WHERE email=?').bind(email).first();
        if (existing) return json({ error: 'Ese correo ya tiene una cuenta. Iniciá sesión o recuperá tu contraseña.' }, 409);
        const id = crypto.randomUUID(), salt = randomToken(), hash = await passwordHash(b.password, salt);
        try { await db.prepare('INSERT INTO customer_users(id,email,name,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)').bind(id, email, name, hash, salt, now()).run(); } catch { return json({ error: 'No se pudo crear la cuenta. Probá iniciar sesión.' }, 409); }
        const token = await newSession(db, id);
        return json({ user: { id, name, email } }, 201, { 'Set-Cookie': cookie(token) });
      }
      const u = await db.prepare('SELECT * FROM customer_users WHERE email=?').bind(email).first();
      const hash = await passwordHash(b.password, u?.salt || 'dummy-unregistered-email-salt');
      if (!u || !constantEqual(hash, u.password_hash)) return json({ error: 'Correo o contraseña incorrectos.' }, 401);
      return json({ user: { id: u.id, name: u.name, email: u.email } }, 200, { 'Set-Cookie': cookie(await newSession(db, u.id)) });
    }
    if (path.endsWith('/logout')) { const token = readToken(request); if (token) await db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').bind(await sha256(token)).run(); return json({ ok: true }, 200, { 'Set-Cookie': cookie('') }); }
    if (path.endsWith('/forgot')) {
      if (!validEmail(email)) return json({ error: 'Ingresá un correo válido.' }, 400);
      if (!env.RESEND_API_KEY || !env.MAIL_FROM || env.PUBLIC_ORIGIN !== new URL(request.url).origin) return json({ error: 'La recuperación por correo todavía no está habilitada. Contactá a Mattu.' }, 503);
      if (!await rate(db, 'reset-email:' + await sha256(email), 3, 900)) return json({ error: 'Esperá unos minutos antes de pedir otro correo.' }, 429);
      const u = await db.prepare('SELECT id FROM customer_users WHERE email=?').bind(email).first();
      if (u) {
        const token = randomToken(), hash = await sha256(token);
        await db.prepare('INSERT INTO customer_reset_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash, u.id, now() + 1800).run();
        const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: 'Recuperá tu acceso a Mattu', text: 'Para cambiar tu contraseña, abrí este enlace. Vence en 30 minutos:\n' + env.PUBLIC_ORIGIN + '/Auth.html?reset=' + token + '\n\nSi no lo pediste, ignorá este mensaje.' }) });
        if (!response.ok) { await db.prepare('DELETE FROM customer_reset_tokens WHERE token_hash=?').bind(hash).run(); return json({ error: 'No se pudo enviar el correo. Probá más tarde.' }, 503); }
      }
      return json({ message: 'Si existe una cuenta con ese correo, recibirás un enlace para recuperar el acceso.' });
    }
    if (path.endsWith('/reset')) {
      if (!validPassword(b.password) || !/^[a-f0-9]{64}$/.test(b.token || '')) return json({ error: 'El enlace o la contraseña no son válidos.' }, 400);
      const tokenHash = await sha256(b.token), row = await db.prepare('SELECT user_id FROM customer_reset_tokens WHERE token_hash=? AND expires_at>?').bind(tokenHash, now()).first();
      if (!row) return json({ error: 'El enlace venció o ya fue utilizado.' }, 400);
      const salt = randomToken(), hash = await passwordHash(b.password, salt);
      const result = await db.batch([
        db.prepare('UPDATE customer_users SET password_hash=?,salt=? WHERE id=? AND EXISTS(SELECT 1 FROM customer_reset_tokens WHERE token_hash=? AND expires_at>?)').bind(hash, salt, row.user_id, tokenHash, now()),
        db.prepare('DELETE FROM customer_sessions WHERE user_id=?').bind(row.user_id),
        db.prepare('DELETE FROM customer_reset_tokens WHERE user_id=?').bind(row.user_id)
      ]);
      if (!result[0].meta.changes) return json({ error: 'El enlace ya fue utilizado.' }, 400);
      return json({ message: 'Contraseña actualizada. Iniciá sesión con la nueva contraseña.' }, 200, { 'Set-Cookie': cookie('') });
    }
  }
  if (path === '/api/customer/orders') {
    const u = await userFor(request, db); if (!u) return json({ error: 'Iniciá sesión para acceder a tus pedidos.' }, 401);
    if (method === 'GET') {
      const result = await db.prepare('SELECT o.data,o.updated_at FROM orders o JOIN customer_order_links l ON l.order_id=o.id WHERE l.user_id=? ORDER BY o.updated_at DESC LIMIT 200').bind(u.id).all();
      return json({ orders: result.results.map(r => { const o = JSON.parse(r.data); return { id: o.id, number: o.number, status: o.status, type: o.type, createdAt: o.createdAt, updatedAt: r.updated_at, due: o.due, delivery: o.delivery, items: o.items.map(x => ({ description: x.description, qty: x.qty, price: x.price })), deposit: o.deposit, pendingReview: o.history.length === 1 && o.history[0].text === 'Solicitud de cliente pendiente de revisión' }; }) });
    }
    if (method === 'POST') {
      if (!await rate(db, 'orders-user:' + u.id, 10, 3600)) return json({ error: 'Alcanzaste el límite de solicitudes por hora. Contactá al equipo.' }, 429);
      if (!/^[a-f0-9-]{36}$/i.test(b.requestKey || '') || !Array.isArray(b.items) || !b.items.length || b.items.length > 30 || !str(b.phone, 40)) return json({ error: 'Completá teléfono y piezas; máximo 30 diseños por solicitud.' }, 400);
      const items = [];
      for (const x of b.items) { if (!names[x.serviceId] || !Number.isInteger(x.qty) || x.qty < 1 || x.qty > 9999 || !str(x.design, 1500) || !str(x.piece, 80)) return json({ error: 'Una de las piezas tiene datos inválidos.' }, 400); items.push({ description: names[x.serviceId] + ' · ' + str(x.piece, 80) + ' · ' + (str(x.material, 80) || 'Material a confirmar') + '\n' + str(x.design, 1500), qty: x.qty, price: 0 }); }
      const existing = await db.prepare('SELECT order_id FROM customer_order_links WHERE user_id=? AND request_key=?').bind(u.id, b.requestKey).first(); if (existing) return json({ id: existing.order_id, duplicate: true });
      const id = crypto.randomUUID(), stamp = new Date().toISOString();
      const o = { id, number: 'MT-' + id.slice(0, 8).toUpperCase(), customer: u.name, customerId: u.id, email: u.email, phone: str(b.phone, 40), address: '', cuit: '', type: 'Por encargo', due: '', delivery: 'A confirmar', notes: 'SOLICITUD WEB PENDIENTE DE REVISIÓN. Precios a cotizar.\n' + str(b.notes, 2000), items, deposit: 0, status: 'Recibido', createdAt: stamp, updatedAt: stamp, updatedBy: 'Cliente', history: [{ date: stamp, text: 'Solicitud de cliente pendiente de revisión', actor: 'Cliente' }], pending: false };
      try { await db.batch([db.prepare('INSERT INTO orders(id,data,revision,updated_at) VALUES(?,?,1,?)').bind(id, JSON.stringify(o), stamp), db.prepare('INSERT INTO customer_order_links(order_id,user_id,request_key) VALUES(?,?,?)').bind(id, u.id, b.requestKey)]); }
      catch (e) { const retry = await db.prepare('SELECT order_id FROM customer_order_links WHERE user_id=? AND request_key=?').bind(u.id, b.requestKey).first(); if (retry) return json({ id: retry.order_id, duplicate: true }); throw e; }
      return json({ id, number: o.number }, 201);
    }
  }
  return json({ error: 'Ruta no encontrada.' }, 404);
}
export default {
  async fetch(request, env) { const path = new URL(request.url).pathname; if (!path.startsWith('/api/customer/')) return env.ASSETS.fetch(request); try { return await api(request, env); } catch { return json({ error: 'No se pudo completar la operación. Intentá más tarde.' }, 500); } },
  async scheduled(event, env) { const t = now(); await env.DB.batch(['customer_sessions', 'customer_reset_tokens', 'customer_rate_limits'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).bind(t))); }
};

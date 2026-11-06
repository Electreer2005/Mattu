import { randomToken, sha256, passwordHash, constantEqual, emailOf, validEmail, validPassword, cookie, readToken } from './security.mjs';

const now = () => Math.floor(Date.now() / 1000);
const names = { nombres: 'Nombres y fechas', miradas: 'Miradas y detalles', retratos: 'Retratos en metal', simbolos: 'Símbolos y diseños', madera: 'Grabado en madera', cuero: 'Grabado en cuero', virola: 'Grabado en virola' };
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

async function rate(db, bucket, limit, seconds) {
  const t = now();
  const row = await db.prepare('INSERT INTO customer_rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING hits').bind(bucket, t + seconds, t, t, t + seconds).first();
  return row.hits <= limit;
}

async function userFor(request, db) {
  const token = readToken(request);
  if (!token) return null;
  return db.prepare('SELECT u.id,u.email,u.name,u.phone,u.address,u.bio,u.avatar FROM customer_users u JOIN customer_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.verified_at IS NOT NULL').bind(await sha256(token), now()).first();
}

async function newSession(db, userId) {
  const token = randomToken();
  await db.prepare('INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256(token), userId, now() + 604800).run();
  return token;
}

async function bodyOf(request) {
  const text = await request.text();
  if (text.length > 100000) throw Error('body-size');
  return JSON.parse(text);
}

function mailConfigured(env, trustedOrigins) {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM && env.PUBLIC_ORIGIN && trustedOrigins.has(env.PUBLIC_ORIGIN));
}

async function sendEmail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html })
    });
    return response.ok;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function api(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  const db = env.DB;
  if (!db) return json({ error: 'La base de datos aún no está conectada.' }, 503);

  const trustedOrigins = new Set([
    new URL(request.url).origin,
    'https://mattu-chi.vercel.app',
    'https://mattu-app.vercel.app'
  ]);
  if (method !== 'GET' && !trustedOrigins.has(request.headers.get('Origin'))) {
    return json({ error: 'Solicitud de otro origen rechazada.' }, 403);
  }

  if (method === 'GET' && path === '/api/customer/session') {
    return json({ user: await userFor(request, db) });
  }

  let b = {};
  if (method === 'POST') {
    try { b = await bodyOf(request); }
    catch { return json({ error: 'Datos inválidos o demasiado grandes.' }, 400); }
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (path.startsWith('/api/customer/auth/') && method === 'POST') {
    if (!await rate(db, 'auth-ip:' + ip, 15, 60)) {
      return json({ error: 'Demasiados intentos. Esperá un minuto.' }, 429);
    }

    const email = emailOf(b.email);

    if (path.endsWith('/register')) {
      if (!validEmail(email) || !validPassword(b.password)) {
        return json({ error: 'Ingresá un correo válido y una contraseña de 10 a 128 caracteres.' }, 400);
      }
      if (!mailConfigured(env, trustedOrigins)) {
        return json({ error: 'El registro por correo todavía no está habilitado. Contactá a Mattu.' }, 503);
      }
      if (!await rate(db, 'login-email:' + await sha256(email), 5, 900)) {
        return json({ error: 'Demasiados intentos con ese correo. Probá más tarde.' }, 429);
      }

      const name = str(b.name, 120);
      if (!name) return json({ error: 'Completá tu nombre.' }, 400);
      const existing = await db.prepare('SELECT id,verified_at FROM customer_users WHERE email=?').bind(email).first();
      if (existing) {
        return json({ error: existing.verified_at ? 'Ese correo ya tiene una cuenta. Iniciá sesión o recuperá tu contraseña.' : 'Ya existe un registro pendiente para ese correo. Solicitá un nuevo enlace de verificación.' }, 409);
      }

      const id = crypto.randomUUID();
      const salt = randomToken();
      const hash = await passwordHash(b.password, salt);
      try {
        await db.prepare('INSERT INTO customer_users(id,email,name,password_hash,salt,created_at,verified_at) VALUES(?,?,?,?,?,?,NULL)').bind(id, email, name, hash, salt, now()).run();
      } catch {
        return json({ error: 'No se pudo crear la cuenta. Probá nuevamente.' }, 409);
      }

      const token = randomToken();
      const tokenHash = await sha256(token);
      await db.prepare('INSERT INTO customer_email_verification_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(tokenHash, id, now() + 86400).run();

      const verifyUrl = env.PUBLIC_ORIGIN + '/verify-email?token=' + token;
      const sent = await sendEmail(env, {
        to: email,
        subject: 'Verificá tu correo para activar tu cuenta Mattu',
        text: 'Hola ' + name + '. Para activar tu cuenta de Mattu, abrí este enlace dentro de las próximas 24 horas: ' + verifyUrl + '. Si no creaste esta cuenta, ignorá este mensaje.',
        html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#29231f"><h1 style="color:#72533d">Bienvenido a Mattu</h1><p>Hola ' + escapeHtml(name) + ', gracias por registrarte.</p><p>Confirmá tu correo para activar tu cuenta y poder consultar tus pedidos.</p><p><a href="' + verifyUrl + '" style="display:inline-block;padding:13px 20px;background:#72533d;color:#fff;text-decoration:none;border-radius:8px">Verificar mi correo</a></p><p>El enlace vence en 24 horas. Si no creaste esta cuenta, podés ignorar este mensaje.</p></div>'
      });

      if (!sent) {
        await db.batch([
          db.prepare('DELETE FROM customer_email_verification_tokens WHERE user_id=?').bind(id),
          db.prepare('DELETE FROM customer_users WHERE id=?').bind(id)
        ]);
        return json({ error: 'No pudimos enviar el correo de verificación. Revisá la configuración de email e intentá nuevamente.' }, 503);
      }

      return json({ message: 'Te enviamos un correo para verificar tu cuenta. Revisá también la carpeta de spam.' }, 202);
    }

    if (path.endsWith('/verify')) {
      if (!/^[a-f0-9]{64}$/.test(b.token || '')) {
        return json({ error: 'El enlace de verificación no es válido.' }, 400);
      }
      const tokenHash = await sha256(b.token);
      const row = await db.prepare('SELECT user_id FROM customer_email_verification_tokens WHERE token_hash=? AND expires_at>?').bind(tokenHash, now()).first();
      if (!row) return json({ error: 'El enlace venció o ya fue utilizado. Solicitá uno nuevo.' }, 400);

      const result = await db.batch([
        db.prepare('UPDATE customer_users SET verified_at=? WHERE id=? AND verified_at IS NULL').bind(now(), row.user_id),
        db.prepare('DELETE FROM customer_email_verification_tokens WHERE user_id=?').bind(row.user_id)
      ]);
      if (!result[0].meta.changes) return json({ error: 'La cuenta ya fue verificada o el enlace dejó de ser válido.' }, 400);

      const user = await db.prepare('SELECT name,email FROM customer_users WHERE id=?').bind(row.user_id).first();
      if (user) {
        await sendEmail(env, {
          to: user.email,
          subject: 'Tu cuenta Mattu ya está activa',
          text: 'Hola ' + user.name + '. Tu correo fue verificado y tu cuenta Mattu ya está activa. Ya podés iniciar sesión y consultar tus pedidos.',
          html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#29231f"><h1 style="color:#72533d">¡Cuenta activada!</h1><p>Hola ' + escapeHtml(user.name) + ', tu correo fue verificado correctamente.</p><p>Ya podés iniciar sesión en Mattu y seguir tus solicitudes desde tu perfil.</p></div>'
        });
      }
      return json({ message: 'Correo verificado. Ya podés iniciar sesión.' });
    }

    if (path.endsWith('/login')) {
      if (!validEmail(email) || !validPassword(b.password)) {
        return json({ error: 'Ingresá un correo válido y una contraseña de 10 a 128 caracteres.' }, 400);
      }
      if (!await rate(db, 'login-email:' + await sha256(email), 12, 900)) {
        return json({ error: 'Demasiados intentos con ese correo. Probá más tarde.' }, 429);
      }
      const user = await db.prepare('SELECT * FROM customer_users WHERE email=?').bind(email).first();
      const hash = await passwordHash(b.password, user?.salt || 'dummy-unregistered-email-salt');
      if (!user || !constantEqual(hash, user.password_hash)) {
        return json({ error: 'Correo o contraseña incorrectos.' }, 401);
      }
      if (!user.verified_at) {
        return json({ error: 'Antes de iniciar sesión, verificá tu correo desde el enlace que te enviamos.' }, 403);
      }
      return json({ user: { id: user.id, name: user.name, email: user.email } }, 200, {
        'Set-Cookie': cookie(await newSession(db, user.id))
      });
    }

    if (path.endsWith('/logout')) {
      const token = readToken(request);
      if (token) await db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').bind(await sha256(token)).run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('') });
    }

    if (path.endsWith('/forgot')) {
      if (!validEmail(email)) return json({ error: 'Ingresá un correo válido.' }, 400);
      if (!mailConfigured(env, trustedOrigins)) {
        return json({ error: 'La recuperación por correo todavía no está habilitada. Contactá a Mattu.' }, 503);
      }
      if (!await rate(db, 'reset-email:' + await sha256(email), 3, 900)) {
        return json({ error: 'Esperá unos minutos antes de pedir otro correo.' }, 429);
      }

      const user = await db.prepare('SELECT id FROM customer_users WHERE email=? AND verified_at IS NOT NULL').bind(email).first();
      if (user) {
        const token = randomToken();
        const hash = await sha256(token);
        await db.prepare('INSERT INTO customer_reset_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash, user.id, now() + 1800).run();
        const resetUrl = env.PUBLIC_ORIGIN + '/reset-password?token=' + token;
        const sent = await sendEmail(env, {
          to: email,
          subject: 'Recuperá tu acceso a Mattu',
          text: 'Para cambiar tu contraseña, abrí este enlace. Vence en 30 minutos: ' + resetUrl + '. Si no lo pediste, ignorá este mensaje.',
          html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#29231f"><h1 style="color:#72533d">Recuperá tu acceso</h1><p>Recibimos una solicitud para cambiar la contraseña de tu cuenta Mattu.</p><p><a href="' + resetUrl + '" style="display:inline-block;padding:13px 20px;background:#72533d;color:#fff;text-decoration:none;border-radius:8px">Crear nueva contraseña</a></p><p>El enlace vence en 30 minutos. Si no solicitaste este cambio, ignorá este correo.</p></div>'
        });
        if (!sent) {
          await db.prepare('DELETE FROM customer_reset_tokens WHERE token_hash=?').bind(hash).run();
          return json({ error: 'No se pudo enviar el correo. Probá más tarde.' }, 503);
        }
      }
      return json({ message: 'Si existe una cuenta verificada con ese correo, recibirás un enlace para recuperar el acceso.' });
    }

    if (path.endsWith('/reset')) {
      if (!validPassword(b.password) || !/^[a-f0-9]{64}$/.test(b.token || '')) {
        return json({ error: 'El enlace o la contraseña no son válidos.' }, 400);
      }
      const tokenHash = await sha256(b.token);
      const row = await db.prepare('SELECT user_id FROM customer_reset_tokens WHERE token_hash=? AND expires_at>?').bind(tokenHash, now()).first();
      if (!row) return json({ error: 'El enlace venció o ya fue utilizado.' }, 400);

      const salt = randomToken();
      const hash = await passwordHash(b.password, salt);
      const result = await db.batch([
        db.prepare('UPDATE customer_users SET password_hash=?,salt=? WHERE id=? AND verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM customer_reset_tokens WHERE token_hash=? AND expires_at>?)').bind(hash, salt, row.user_id, tokenHash, now()),
        db.prepare('DELETE FROM customer_sessions WHERE user_id=?').bind(row.user_id),
        db.prepare('DELETE FROM customer_reset_tokens WHERE user_id=?').bind(row.user_id)
      ]);
      if (!result[0].meta.changes) return json({ error: 'El enlace ya fue utilizado.' }, 400);
      return json({ message: 'Contraseña actualizada. Iniciá sesión con la nueva contraseña.' }, 200, { 'Set-Cookie': cookie('') });
    }
  }

  if (path === '/api/customer/profile/avatar' && method === 'POST') {
    const user = await userFor(request, db);
    if (!user) return json({ error: 'Iniciá sesión para cambiar tu foto.' }, 401);
    const avatar = typeof b.avatar === 'string' ? b.avatar : '';
    if (avatar.length > 80000 || !avatar.startsWith('data:image/jpeg;base64,') || !/^[A-Za-z0-9+/=]+$/.test(avatar.slice(23))) {
      return json({ error: 'La foto debe ser JPEG y tener un tamaño reducido.' }, 400);
    }
    await db.prepare('UPDATE customer_users SET avatar=? WHERE id=?').bind(avatar, user.id).run();
    return json({ user: { ...user, avatar } });
  }

  if (path === '/api/customer/profile/avatar/remove' && method === 'POST') {
    const user = await userFor(request, db);
    if (!user) return json({ error: 'Iniciá sesión para cambiar tu foto.' }, 401);
    await db.prepare("UPDATE customer_users SET avatar='' WHERE id=?").bind(user.id).run();
    return json({ user: { ...user, avatar: '' } });
  }

  if (path === '/api/customer/profile' && method === 'POST') {
    const user = await userFor(request, db);
    if (!user) return json({ error: 'Iniciá sesión para editar tu perfil.' }, 401);
    const name = str(b.name, 120);
    const phone = str(b.phone, 40);
    const address = str(b.address, 180);
    const bio = str(b.bio, 500);
    if (!name) return json({ error: 'El nombre es obligatorio.' }, 400);
    if (phone && !/^[\d\s+()-]{6,40}$/.test(phone)) return json({ error: 'El teléfono no es válido.' }, 400);
    await db.prepare('UPDATE customer_users SET name=?,phone=?,address=?,bio=? WHERE id=?').bind(name, phone, address, bio, user.id).run();
    return json({ user: { ...user, name, phone, address, bio } });
  }

  if (path === '/api/customer/orders') {
    const user = await userFor(request, db);
    if (!user) return json({ error: 'Iniciá sesión para acceder a tus pedidos.' }, 401);

    if (method === 'GET') {
      const result = await db.prepare('SELECT o.data,o.updated_at FROM orders o JOIN customer_order_links l ON l.order_id=o.id WHERE l.user_id=? ORDER BY o.updated_at DESC LIMIT 200').bind(user.id).all();
      return json({ orders: result.results.map((r) => {
        const order = JSON.parse(r.data);
        return {
          id: order.id, number: order.number, status: order.status, type: order.type,
          createdAt: order.createdAt, updatedAt: r.updated_at, due: order.due,
          delivery: order.delivery,
          items: order.items.map((item) => ({ description: item.description, qty: item.qty, price: item.price })),
          deposit: order.deposit,
          pendingReview: order.history.length === 1 && order.history[0].text === 'Solicitud de cliente pendiente de revisión'
        };
      }) });
    }

    if (method === 'POST') {
      if (!await rate(db, 'orders-user:' + user.id, 10, 3600)) {
        return json({ error: 'Alcanzaste el límite de solicitudes por hora. Contactá al equipo.' }, 429);
      }
      if (!/^[a-f0-9-]{36}$/i.test(b.requestKey || '') || !Array.isArray(b.items) || !b.items.length || b.items.length > 30 || !str(b.phone, 40)) {
        return json({ error: 'Completá teléfono y piezas; máximo 30 diseños por solicitud.' }, 400);
      }

      const items = [];
      for (const item of b.items) {
        const label = names[item.serviceId] || str(item.productName || item.name, 120);
        const piece = str(item.piece || item.productName || item.name, 80);
        const design = str(item.design || item.customization || item.description, 1500);
        if (!label || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 9999 || !design || !piece) {
          return json({ error: 'Una de las piezas tiene datos inválidos.' }, 400);
        }
        items.push({
          description: label + ' · ' + piece + ' · ' + (str(item.material, 80) || 'Material a confirmar') + '\n' + design,
          qty: item.qty,
          price: 0
        });
      }

      const existing = await db.prepare('SELECT order_id FROM customer_order_links WHERE user_id=? AND request_key=?').bind(user.id, b.requestKey).first();
      if (existing) return json({ id: existing.order_id, duplicate: true });

      const id = crypto.randomUUID();
      const stamp = new Date().toISOString();
      const order = {
        id, number: 'MT-' + id.slice(0, 8).toUpperCase(), customer: user.name, customerId: user.id,
        email: user.email, phone: str(b.phone, 40), address: '', cuit: '', type: 'Por encargo',
        due: '', delivery: 'A confirmar',
        notes: 'SOLICITUD WEB PENDIENTE DE REVISIÓN. Precios a cotizar.\n' + str(b.notes, 2000),
        items, deposit: 0, status: 'Recibido', createdAt: stamp, updatedAt: stamp,
        updatedBy: 'Cliente',
        history: [{ date: stamp, text: 'Solicitud de cliente pendiente de revisión', actor: 'Cliente' }],
        pending: false
      };

      try {
        await db.batch([
          db.prepare('INSERT INTO orders(id,data,revision,updated_at) VALUES(?,?,1,?)').bind(id, JSON.stringify(order), stamp),
          db.prepare('INSERT INTO customer_order_links(order_id,user_id,request_key) VALUES(?,?,?)').bind(id, user.id, b.requestKey)
        ]);
      } catch {
        const retry = await db.prepare('SELECT order_id FROM customer_order_links WHERE user_id=? AND request_key=?').bind(user.id, b.requestKey).first();
        if (retry) return json({ id: retry.order_id, duplicate: true });
        throw Error('order-create-failed');
      }

      await sendEmail(env, {
        to: user.email,
        subject: 'Recibimos tu solicitud ' + order.number,
        text: 'Hola ' + user.name + '. Recibimos tu solicitud ' + order.number + ' en Mattu. El equipo revisará las piezas y se pondrá en contacto para confirmar presupuesto, pago y entrega.',
        html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#29231f"><h1 style="color:#72533d">Solicitud recibida</h1><p>Hola ' + escapeHtml(user.name) + ', recibimos tu solicitud <strong>' + order.number + '</strong>.</p><p>El equipo de Mattu revisará las piezas y se pondrá en contacto para confirmar presupuesto, pago y entrega.</p></div>'
      });

      return json({ id, number: order.number }, 201);
    }
  }

  return json({ error: 'Ruta no encontrada.' }, 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/customer/')) return env.ASSETS.fetch(request);
    try { return await api(request, env); }
    catch { return json({ error: 'No se pudo completar la operación. Intentá más tarde.' }, 500); }
  },
  async scheduled(event, env) {
    const timestamp = now();
    await env.DB.batch(['customer_sessions', 'customer_reset_tokens', 'customer_email_verification_tokens', 'customer_rate_limits'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).bind(timestamp)
    ));
  }
};

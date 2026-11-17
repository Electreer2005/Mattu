import { randomToken, sha256, passwordHash, constantEqual, emailOf, validEmail, validPassword, cookie, readToken } from './security.mjs';

const now = () => Math.floor(Date.now() / 1000);
const OWNER_EMAIL = 'solismauricioezequiel@gmail.com';
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
  const user = await db.prepare('SELECT u.id,u.email,u.name,u.phone,u.address,u.bio,u.avatar,u.role FROM customer_users u JOIN customer_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.verified_at IS NOT NULL').bind(await sha256(token), now()).first();
  if (!user) return null;
  const isOwner = emailOf(user.email) === OWNER_EMAIL;
  return { ...user, role: isOwner ? 'admin' : (user.role || 'customer'), is_owner: isOwner };
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


async function mediaApi(request, env, path) {
  const origin = request.headers.get('Origin');
  const trustedOrigins = new Set([
    new URL(request.url).origin,
    'https://mattu-chi.vercel.app',
    'https://mattu-app.vercel.app',
    'https://prueba.mattulife.com.ar',
    'https://www.mattulife.com.ar',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ]);
  if (request.method !== 'GET' && !trustedOrigins.has(origin)) {
    return json({ error: 'Solicitud de otro origen rechazada.' }, 403);
  }
  const key = decodeURIComponent(path.slice('/api/customer/media/'.length));
  if (!env.MEDIA_BUCKET) return json({ error: 'El almacenamiento de imágenes todavía no está configurado.' }, 503);

  if (request.method === 'GET' && key && key !== 'media') {
    const object = await env.MEDIA_BUCKET.get(key);
    if (!object) return json({ error: 'Imagen no encontrada.' }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { headers });
  }

  if (request.method !== 'POST' || key !== 'upload') {
    return json({ error: 'Ruta no encontrada.' }, 404);
  }

  const db = env.DB;
  const admin = await userFor(request, db);
  if (!admin) return json({ error: 'Iniciá sesión.' }, 401);
  if (admin.role !== 'admin') return json({ error: 'No tenés permisos de administrador.' }, 403);

  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 5 * 1024 * 1024) return json({ error: 'La imagen supera el límite de 5 MB.' }, 413);

  let form;
  try { form = await request.formData(); }
  catch { return json({ error: 'Formulario de imagen inválido.' }, 400); }

  const file = form.get('file');
  if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024) {
    return json({ error: 'Seleccioná una imagen de hasta 5 MB.' }, 400);
  }
  const allowed = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif']
  ]);
  const extension = allowed.get(file.type);
  if (!extension) return json({ error: 'Formato no permitido. Usá JPG, PNG, WEBP o AVIF.' }, 415);

  const keyName = 'catalog/' + crypto.randomUUID() + '.' + extension;
  await env.MEDIA_BUCKET.put(keyName, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000, immutable'
    },
    customMetadata: { uploadedBy: admin.id }
  });
  const url = new URL('/api/customer/media/' + encodeURIComponent(keyName), request.url).toString();
  return json({ key: keyName, url, contentType: file.type, size: file.size }, 201);
}

async function api(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  const db = env.DB;
  if (!db) return json({ error: 'La base de datos aún no está conectada.' }, 503);

  const trustedOrigins = new Set([
    new URL(request.url).origin,
    'https://mattu-chi.vercel.app',
    'https://mattu-app.vercel.app',
    'https://prueba.mattulife.com.ar',
    'https://www.mattulife.com.ar',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ]);
  if (method !== 'GET' && !trustedOrigins.has(request.headers.get('Origin'))) {
    return json({ error: 'Solicitud de otro origen rechazada.' }, 403);
  }

  if (method === 'GET' && path === '/api/customer/session') {
    return json({ user: await userFor(request, db) });
  }


  let b = {};
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    try { b = await bodyOf(request); }
    catch { return json({ error: 'Datos inválidos o demasiado grandes.' }, 400); }
  }

  const catalogMatch = path.match(/^\/api\/customer\/catalog\/(products|services)(?:\/([^/]+))?$/);
  if (catalogMatch) {
    const kind = catalogMatch[1];
    const itemId = catalogMatch[2] ? decodeURIComponent(catalogMatch[2]) : '';
    const table = kind === 'products' ? 'catalog_products' : 'catalog_services';
    if (method === 'GET') {
      const rows = await db.prepare(`SELECT id,data,updated_at FROM ${table} WHERE active=1 ORDER BY updated_at DESC`).all();
      const deleted = await db.prepare(`SELECT id FROM ${table} WHERE active=0`).all();
      return json({
        [kind]: rows.results.map((row) => ({ ...JSON.parse(row.data), id: row.id, updatedAt: row.updated_at })),
        deletedIds: deleted.results.map((row) => row.id)
      });
    }

    const admin = await userFor(request, db);
    if (!admin) return json({ error: 'Iniciá sesión.' }, 401);
    if (admin.role !== 'admin') return json({ error: 'No tenés permisos de administrador.' }, 403);

    if (method === 'POST') {
      const id = str(b.id, 100) || crypto.randomUUID();
      const data = { ...b, id };
      delete data.updatedAt;
      const stamp = new Date().toISOString();
      await db.prepare(`INSERT INTO ${table}(id,data,active,created_at,updated_at) VALUES(?,?,1,?,?)`)
        .bind(id, JSON.stringify(data), stamp, stamp).run();
      return json({ item: { ...data, updatedAt: stamp } }, 201);
    }

    if (method === 'PUT' && itemId) {
      const current = await db.prepare(`SELECT id,data FROM ${table} WHERE id=?`).bind(itemId).first();
      const data = { ...(current ? JSON.parse(current.data) : {}), ...b, id: itemId };
      delete data.updatedAt;
      const stamp = new Date().toISOString();
      await db.prepare(`INSERT INTO ${table}(id,data,active,created_at,updated_at) VALUES(?,?,1,?,?)
        ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=1,updated_at=excluded.updated_at`)
        .bind(itemId, JSON.stringify(data), stamp, stamp).run();
      return json({ item: { ...data, updatedAt: stamp } });
    }

    if (method === 'DELETE' && itemId) {
      const current = await db.prepare(`SELECT id,data FROM ${table} WHERE id=?`).bind(itemId).first();
      const stamp = new Date().toISOString();
      const data = current ? current.data : JSON.stringify({ id: itemId });
      await db.prepare(`INSERT INTO ${table}(id,data,active,created_at,updated_at) VALUES(?,?,0,?,?)
        ON CONFLICT(id) DO UPDATE SET active=0,updated_at=excluded.updated_at`)
        .bind(itemId, data, stamp, stamp).run();
      return json({ ok: true });
    }
    return json({ error: 'Método no permitido.' }, 405);
  }


  if (path.startsWith('/api/customer/admin/inventory')) {
    const admin = await userFor(request, db);
    if (!admin) return json({ error: 'Iniciá sesión.' }, 401);
    if (admin.role !== 'admin') return json({ error: 'No tenés permisos de administrador.' }, 403);
    const stamp = new Date().toISOString();
    const routePart = path.slice('/api/customer/admin/inventory'.length);
    const route = (routePart.endsWith('/') ? routePart.slice(0, -1) : routePart) || '/';
    if (method === 'GET' && route === '/') {
      const [materials, products, movements] = await Promise.all([
        db.prepare('SELECT * FROM inventory_materials ORDER BY active DESC, name COLLATE NOCASE').all(),
        db.prepare(`SELECT p.id,p.data,COALESCE(s.on_hand,0) AS on_hand,COALESCE(s.reserved,0) AS reserved FROM catalog_products p LEFT JOIN inventory_finished_stock s ON s.product_id=p.id WHERE p.active=1 ORDER BY p.updated_at DESC`).all(),
        db.prepare('SELECT * FROM inventory_movements ORDER BY created_at DESC LIMIT 100').all()
      ]);
      return json({ materials: materials.results, products: products.results.map(row => ({ ...JSON.parse(row.data), id: row.id, onHand: row.on_hand, reserved: row.reserved, available: row.on_hand-row.reserved })), movements: movements.results });
    }
    if (method === 'POST' && route === '/materials') {
      const name=str(b.name,120), category=str(b.category,40)||'otros', unit=str(b.unit,20)||'unidad';
      const quantity=Number(b.stockQuantity??0), minimum=Number(b.minimumQuantity??0);
      if(!name||!Number.isFinite(quantity)||quantity<0||!Number.isFinite(minimum)||minimum<0||!['madera','cuero','metales','virola','insumos','otros'].includes(category)||!['unidad','g','kg','ml','l','cm','m','mm','par','hoja'].includes(unit)) return json({error:'Revisá nombre, categoría, unidad y cantidades.'},400);
      const id=crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO inventory_materials(id,name,category,unit,stock_quantity,minimum_quantity,notes,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)`).bind(id,name,category,unit,quantity,minimum,str(b.notes,1000),stamp,stamp),
        ...(quantity>0?[db.prepare(`INSERT INTO inventory_movements(id,entity_type,entity_id,movement_type,quantity,reference_type,note,created_by,created_at) VALUES(?,'material',?,'initial',?,'manual',?,?,?)`).bind(crypto.randomUUID(),id,quantity,'Stock inicial',admin.email,stamp)]:[])
      ]);
      return json({id},201);
    }
    const materialMatch = route.startsWith('/materials/') ? [route, route.slice('/materials/'.length)] : null;
    if(materialMatch&&method==='PATCH'){
      const id=decodeURIComponent(materialMatch[1]), current=await db.prepare('SELECT * FROM inventory_materials WHERE id=?').bind(id).first();
      if(!current)return json({error:'No se encontró el material.'},404);
      const name=b.name===undefined?current.name:str(b.name,120), category=b.category===undefined?current.category:str(b.category,40), unit=b.unit===undefined?current.unit:str(b.unit,20), minimum=b.minimumQuantity===undefined?current.minimum_quantity:Number(b.minimumQuantity);
      if(!name||!['madera','cuero','metales','virola','insumos','otros'].includes(category)||!['unidad','g','kg','ml','l','cm','m','mm','par','hoja'].includes(unit)||!Number.isFinite(minimum)||minimum<0)return json({error:'Datos del material inválidos.'},400);
      await db.prepare('UPDATE inventory_materials SET name=?,category=?,unit=?,minimum_quantity=?,notes=?,active=?,updated_at=? WHERE id=?').bind(name,category,unit,minimum,b.notes===undefined?current.notes:str(b.notes,1000),b.active===false?0:1,stamp,id).run();
      return json({ok:true});
    }
    if(method==='POST'&&route==='/movements'){
      const entityType=str(b.entityType,30),entityId=str(b.entityId,100),movementType=str(b.movementType,30),quantity=Number(b.quantity),note=str(b.note,500);
      if(!entityId||!['material','finished_product'].includes(entityType)||!['entry','consumption','adjustment','production','dispatch'].includes(movementType)||!Number.isFinite(quantity)||quantity<=0||quantity>10000000)return json({error:'Movimiento inválido.'},400);
      const id=crypto.randomUUID();
      if(entityType==='material'){
        const row=await db.prepare('SELECT stock_quantity FROM inventory_materials WHERE id=? AND active=1').bind(entityId).first();
        if(!row)return json({error:'No se encontró el material.'},404);
        const next=movementType==='entry'?row.stock_quantity+quantity:movementType==='adjustment'?quantity:row.stock_quantity-quantity;
        if(next<0)return json({error:'No hay suficiente stock para realizar ese movimiento.'},409);
        await db.batch([
          db.prepare('UPDATE inventory_materials SET stock_quantity=?,updated_at=? WHERE id=?').bind(next,stamp,entityId),
          db.prepare(`INSERT INTO inventory_movements(id,entity_type,entity_id,movement_type,quantity,reference_type,note,created_by,created_at) VALUES(?,'material',?,?,?,?,?,?,?)`).bind(id,movementType,entityId,quantity,'manual',note,admin.email,stamp)
        ]);
      }else{
        if(!await db.prepare('SELECT id FROM catalog_products WHERE id=? AND active=1').bind(entityId).first())return json({error:'No se encontró el producto.'},404);
        const row=await db.prepare('SELECT on_hand,reserved FROM inventory_finished_stock WHERE product_id=?').bind(entityId).first();
        const onHand=row?.on_hand||0,reserved=row?.reserved||0,next=['entry','production'].includes(movementType)?onHand+quantity:movementType==='adjustment'?quantity:onHand-quantity;
        if(next<reserved)return json({error:'El ajuste dejaría menos unidades que las ya reservadas.'},409);
        if(next<0)return json({error:'No hay suficiente stock disponible.'},409);
        await db.batch([
          db.prepare(`INSERT INTO inventory_finished_stock(product_id,on_hand,reserved,updated_at) VALUES(?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET on_hand=excluded.on_hand,updated_at=excluded.updated_at`).bind(entityId,next,reserved,stamp),
          db.prepare(`INSERT INTO inventory_movements(id,entity_type,entity_id,movement_type,quantity,reference_type,note,created_by,created_at) VALUES(?,'finished_product',?,?,?,?,?,?,?)`).bind(id,entityId,movementType,quantity,'manual',note,admin.email,stamp)
        ]);
      }
      return json({ok:true,movementId:id},201);
    }
    if(method==='POST'&&route==='/recipes'){
      const productId=str(b.productId,100),outputQuantity=Number(b.outputQuantity||1),items=Array.isArray(b.items)?b.items:[];
      if(!productId||!Number.isFinite(outputQuantity)||outputQuantity<=0||!items.length||items.length>50)return json({error:'La receta necesita producto, rendimiento y al menos un material.'},400);
      if(!await db.prepare('SELECT id FROM catalog_products WHERE id=? AND active=1').bind(productId).first())return json({error:'Producto no encontrado.'},404);
      const normalized=[];
      for(const item of items){const materialId=str(item.materialId,100),quantity=Number(item.quantity);if(!materialId||!Number.isFinite(quantity)||quantity<=0||!await db.prepare('SELECT id FROM inventory_materials WHERE id=? AND active=1').bind(materialId).first())return json({error:'Hay materiales o cantidades inválidas en la receta.'},400);normalized.push({materialId,quantity});}
      const existing=await db.prepare('SELECT id FROM inventory_recipes WHERE product_id=?').bind(productId).first(),recipeId=existing?.id||crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO inventory_recipes(id,product_id,output_quantity,notes,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET output_quantity=excluded.output_quantity,notes=excluded.notes,updated_at=excluded.updated_at`).bind(recipeId,productId,outputQuantity,str(b.notes,1000),stamp,stamp),
        db.prepare('DELETE FROM inventory_recipe_items WHERE recipe_id=?').bind(recipeId)
      ]);
      await db.batch(normalized.map(item=>db.prepare('INSERT INTO inventory_recipe_items(id,recipe_id,material_id,quantity) VALUES(?,?,?,?)').bind(crypto.randomUUID(),recipeId,item.materialId,item.quantity)));
      return json({ok:true,recipeId},201);
    }
    if(method==='GET'&&route==='/recipes'){
      const rows=await db.prepare(`SELECT r.id,r.product_id,r.output_quantity,r.notes,p.data FROM inventory_recipes r JOIN catalog_products p ON p.id=r.product_id ORDER BY p.updated_at DESC`).all(),recipes=[];
      for(const row of rows.results){const items=await db.prepare(`SELECT i.material_id,i.quantity,m.name,m.unit FROM inventory_recipe_items i JOIN inventory_materials m ON m.id=i.material_id WHERE i.recipe_id=?`).bind(row.id).all();recipes.push({id:row.id,productId:row.product_id,product:JSON.parse(row.data),outputQuantity:row.output_quantity,notes:row.notes,items:items.results});}
      return json({recipes});
    }
    return json({error:'Ruta de inventario no encontrada.'},404);
  }

  if (path === '/api/customer/admin/users' && method === 'GET') {
    const admin = await userFor(request, db);
    if (!admin) return json({ error: 'Iniciá sesión.' }, 401);
    if (admin.role !== 'admin') return json({ error: 'No tenés permisos de administrador.' }, 403);
    const result = await db.prepare('SELECT id,email,name,role,created_at,verified_at FROM customer_users ORDER BY created_at DESC LIMIT 200').all();
    return json({ users: result.results.map((user) => ({ ...user, role: emailOf(user.email) === OWNER_EMAIL ? 'admin' : (user.role || 'customer'), is_owner: emailOf(user.email) === OWNER_EMAIL })), isOwner: admin.is_owner });
  }


  if (path === '/api/customer/admin/role' && method === 'POST') {
    const actor = await userFor(request, db);
    if (!actor) return json({ error: 'Iniciá sesión.' }, 401);
    if (!actor.is_owner) return json({ error: 'Solo el administrador principal puede modificar roles.' }, 403);
    const userId = str(b.userId, 80);
    const role = b.role;
    if (!userId || !['admin', 'customer'].includes(role)) return json({ error: 'Usuario o rol inválido.' }, 400);
    const target = await db.prepare('SELECT id,email,verified_at FROM customer_users WHERE id=?').bind(userId).first();
    if (!target) return json({ error: 'No se encontró el usuario.' }, 404);
    if (emailOf(target.email) === OWNER_EMAIL) return json({ error: 'El administrador principal no puede ser modificado.' }, 403);
    if (!target.verified_at) return json({ error: 'El usuario debe verificar su correo antes de recibir permisos.' }, 409);
    await db.batch([
      db.prepare('UPDATE customer_users SET role=? WHERE id=?').bind(role, userId),
      db.prepare('DELETE FROM customer_sessions WHERE user_id=?').bind(userId)
    ]);
    return json({ ok: true, userId, role, message: 'Rol actualizado. El usuario deberá iniciar sesión nuevamente.' });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (path === '/api/customer/contact' && method === 'POST') {
    if (!await rate(db, 'contact-ip:' + await sha256(ip), 5, 3600)) {
      return json({ error: 'Recibimos varias consultas desde esta conexión. Probá nuevamente más tarde.' }, 429);
    }
    // Honeypot: bots que completan este campo reciben una respuesta neutra.
    if (str(b.website, 160)) return json({ ok: true, message: 'Consulta recibida.' }, 201);

    const name = str(b.name, 120);
    const phone = str(b.phone, 40);
    const email = emailOf(b.email);
    const message = str(b.message, 2000);
    if (!name || !phone || !message) {
      return json({ error: 'Completá nombre, teléfono y mensaje.' }, 400);
    }
    if (!/^[\d\s+().-]{6,40}$/.test(phone)) {
      return json({ error: 'Ingresá un teléfono válido.' }, 400);
    }
    if (email && !validEmail(email)) {
      return json({ error: 'El correo electrónico no es válido.' }, 400);
    }

    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await db.prepare(`INSERT INTO contact_messages(id,name,phone,email,message,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'new',?,?)`).bind(id, name, phone, email, message, stamp, stamp).run();

    const subject = 'Nueva consulta desde Mattu · ' + name;
    const text = 'Nueva consulta recibida desde el sitio Mattu.\n\nNombre: ' + name +
      '\nTeléfono: ' + phone + '\nCorreo: ' + (email || 'No informado') +
      '\n\nMensaje:\n' + message + '\n\nID: ' + id;
    const html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#29231f">' +
      '<h1 style="color:#72533d">Nueva consulta desde Mattu</h1>' +
      '<p><strong>Nombre:</strong> ' + escapeHtml(name) + '</p>' +
      '<p><strong>Teléfono:</strong> ' + escapeHtml(phone) + '</p>' +
      '<p><strong>Correo:</strong> ' + escapeHtml(email || 'No informado') + '</p>' +
      '<p><strong>Mensaje:</strong></p><p style="white-space:pre-wrap">' + escapeHtml(message) + '</p>' +
      '<small>Consulta ' + id + '</small></div>';
    const notificationSent = await sendEmail(env, {
      to: env.CONTACT_TO || OWNER_EMAIL,
      subject, text, html
    });
    return json({
      ok: true,
      id,
      message: 'Tu consulta quedó registrada. El equipo de Mattu se pondrá en contacto.',
      notificationSent
    }, 201);
  }

  if (path === '/api/customer/admin/contacts' && (method === 'GET' || method === 'PATCH')) {
    const admin = await userFor(request, db);
    if (!admin) return json({ error: 'Iniciá sesión.' }, 401);
    if (admin.role !== 'admin') return json({ error: 'No tenés permisos de administrador.' }, 403);

    if (method === 'GET') {
      const result = await db.prepare('SELECT id,name,phone,email,message,status,created_at,updated_at FROM contact_messages ORDER BY created_at DESC LIMIT 200').all();
      return json({ contacts: result.results });
    }

    const id = str(b.id, 80);
    const status = str(b.status, 20);
    if (!id || !['new', 'in_progress', 'resolved'].includes(status)) {
      return json({ error: 'Consulta o estado inválido.' }, 400);
    }
    const result = await db.prepare('UPDATE contact_messages SET status=?,updated_at=? WHERE id=?')
      .bind(status, new Date().toISOString(), id).run();
    if (!result.meta.changes) return json({ error: 'No se encontró la consulta.' }, 404);
    return json({ ok: true });
  }

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

    if (path.endsWith('/resend-verification')) {
      if (!validEmail(email)) return json({ error: 'Ingresá un correo válido.' }, 400);
      if (!mailConfigured(env, trustedOrigins)) return json({ error: 'El envío de correos todavía no está habilitado.' }, 503);
      if (!await rate(db, 'verify-email:' + await sha256(email), 3, 900)) {
        return json({ error: 'Esperá unos minutos antes de pedir otro correo.' }, 429);
      }
      const pending = await db.prepare('SELECT id,name FROM customer_users WHERE email=? AND verified_at IS NULL').bind(email).first();
      if (pending) {
        const token = randomToken();
        const tokenHash = await sha256(token);
        await db.batch([
          db.prepare('DELETE FROM customer_email_verification_tokens WHERE user_id=?').bind(pending.id),
          db.prepare('INSERT INTO customer_email_verification_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(tokenHash, pending.id, now() + 86400)
        ]);
        const verifyUrl = env.PUBLIC_ORIGIN + '/verify-email?token=' + token;
        const sent = await sendEmail(env, {
          to: email,
          subject: 'Verificá tu correo para activar tu cuenta Mattu',
          text: 'Hola ' + pending.name + '. Para activar tu cuenta de Mattu, abrí este enlace dentro de las próximas 24 horas: ' + verifyUrl + '.',
          html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#29231f"><h1 style="color:#72533d">Activá tu cuenta Mattu</h1><p>Hola ' + escapeHtml(pending.name) + '.</p><p><a href="' + verifyUrl + '" style="display:inline-block;padding:13px 20px;background:#72533d;color:#fff;text-decoration:none;border-radius:8px">Verificar mi correo</a></p><p>El enlace vence en 24 horas.</p></div>'
        });
        if (!sent) {
          await db.prepare('DELETE FROM customer_email_verification_tokens WHERE token_hash=?').bind(tokenHash).run();
          return json({ error: 'No se pudo enviar el correo. Probá más tarde.' }, 503);
        }
      }
      return json({ message: 'Si la cuenta necesita verificación, te enviaremos un nuevo enlace.' });
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
      const isOwner = emailOf(user.email) === OWNER_EMAIL;
      const role = isOwner ? 'admin' : (user.role || 'customer');
      if (isOwner && user.role !== 'admin') await db.prepare('UPDATE customer_users SET role=? WHERE id=?').bind('admin', user.id).run();
      return json({ user: { id: user.id, name: user.name, email: user.email, role, is_owner: isOwner } }, 200, {
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
      const visible = result.results.filter((r) => !JSON.parse(r.data).deletedAt);
      return json({ orders: visible.map((r) => {
        const order = JSON.parse(r.data);
        return {
          id: order.id, number: order.number, status: order.status, type: order.type, webType: order.webType,
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
        pending: false,
        origin: 'web',
        webType: (() => {
          const hasService = b.items.some((item) => Boolean(names[item.serviceId]));
          const hasProduct = b.items.some((item) => Boolean(item.productId));
          return hasService && hasProduct ? 'mixed' : hasProduct ? 'product' : 'service';
        })()
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
    try {
      if (path.startsWith('/api/customer/media/')) return await mediaApi(request, env, path);
      return await api(request, env);
    } catch {
      return json({ error: 'No se pudo completar la operación. Intentá más tarde.' }, 500);
    }
  },
  async scheduled(event, env) {
    const timestamp = now();
    await env.DB.batch(['customer_sessions', 'customer_reset_tokens', 'customer_email_verification_tokens', 'customer_rate_limits'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).bind(timestamp)
    ));
  }
};

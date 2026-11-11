import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.mjs';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL)');
  sqlite.exec(readFileSync('migrations/0001_customer_accounts.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0002_email_verification.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0003_customer_roles.sql', 'utf8'));

  function prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() {
        const result = sqlite.prepare(sql).run(...args);
        return { meta: { changes: result.changes } };
      }
    };
  }

  const env = {
    DB: {
      prepare,
      async batch(statements) {
        sqlite.exec('BEGIN');
        try {
          const output = [];
          for (const statement of statements) output.push(await statement.run());
          sqlite.exec('COMMIT');
          return output;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      }
    },
    ASSETS: { fetch: async () => new Response('static') },
    RESEND_API_KEY: 'test-key',
    MAIL_FROM: 'Mattu <cuentas@example.test>',
    PUBLIC_ORIGIN: 'https://mattu.test'
  };
  return { env, sqlite };
}

async function call(env, path, data, cookieValue = '', origin = 'https://mattu.test') {
  return worker.fetch(new Request('https://mattu.test/api/customer/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Cookie: cookieValue,
      'CF-Connecting-IP': '127.0.0.1'
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  }), env);
}

async function withMailCapture(callback) {
  const original = globalThis.fetch;
  let lastEmail;
  globalThis.fetch = async (_url, options) => {
    lastEmail = JSON.parse(options.body);
    return Response.json({ id: 'email-test' });
  };
  try {
    return await callback(() => lastEmail);
  } finally {
    globalThis.fetch = original;
  }
}

async function register(env, email = 'ana@example.test', origin = 'https://mattu.test') {
  return withMailCapture(async (getEmail) => {
    const response = await call(env, 'auth/register', {
      email, name: 'Ana', password: 'mi-clave-segura'
    }, '', origin);
    assert.equal(response.status, 202);
    assert.equal((await (await call(env, 'session')).json()).user, null);

    const verificationToken = getEmail().text.match(/verify-email\?token=([a-f0-9]{64})/)[1];
    const verified = await call(env, 'auth/verify', { token: verificationToken }, '', origin);
    assert.equal(verified.status, 200);

    const login = await call(env, 'auth/login', {
      email, password: 'mi-clave-segura'
    }, '', origin);
    assert.equal(login.status, 200);
    return login.headers.get('Set-Cookie').split(';')[0];
  });
}

const requestBody = () => ({
  requestKey: crypto.randomUUID(),
  phone: '123456',
  notes: 'Mi idea',
  items: [{ serviceId: 'nombres', piece: 'Pulsera', material: 'Plata', design: 'Ana', qty: 2 }]
});

test('el registro exige verificación antes de crear una sesión', async () => {
  const { env, sqlite } = setup();
  await withMailCapture(async (getEmail) => {
    const response = await call(env, 'auth/register', {
      email: 'ana@example.test', name: 'Ana', password: 'mi-clave-segura'
    });
    assert.equal(response.status, 202);
    assert.equal((await call(env, 'auth/login', {
      email: 'ana@example.test', password: 'mi-clave-segura'
    })).status, 403);
    const row = sqlite.prepare('SELECT * FROM customer_users').get();
    assert.notEqual(row.password_hash, 'mi-clave-segura');
    assert.equal(row.verified_at, null);
    const token = getEmail().text.match(/verify-email\?token=([a-f0-9]{64})/)[1];
    assert.equal((await call(env, 'auth/verify', { token })).status, 200);
    assert.equal((await call(env, 'auth/verify', { token })).status, 400);
    assert.equal((await call(env, 'auth/login', {
      email: 'ana@example.test', password: 'mi-clave-segura'
    })).status, 200);
  });
});

test('login rechaza contraseña incorrecta y acepta la correcta tras verificar', async () => {
  const { env } = setup();
  await register(env);
  assert.equal((await call(env, 'auth/login', {
    email: 'ana@example.test', password: 'otra-clave-incorrecta'
  })).status, 401);
  assert.equal((await call(env, 'auth/login', {
    email: 'ana@example.test', password: 'mi-clave-segura'
  })).status, 200);
});

test('sesión y logout funcionan con cookie segura', async () => {
  const { env } = setup();
  const session = await register(env);
  assert.equal((await (await call(env, 'session', undefined, session)).json()).user.email, 'ana@example.test');
  const logout = await call(env, 'auth/logout', {}, session);
  assert.match(logout.headers.get('Set-Cookie'), /Secure; HttpOnly; SameSite=Lax/);
  assert.equal((await (await call(env, 'session', undefined, session)).json()).user, null);
});

test('no permite solicitudes anónimas ni de otro origen', async () => {
  const { env } = setup();
  assert.equal((await call(env, 'orders', requestBody())).status, 401);
  assert.equal((await call(env, 'auth/register', {
    email: 'ana@example.test', name: 'Ana', password: 'mi-clave-segura'
  }, '', 'https://otra.test')).status, 403);
});

test('aísla pedidos por usuario y evita duplicados al reintentar', async () => {
  const { env, sqlite } = setup();
  const firstUser = await register(env);
  const secondUser = await register(env, 'bea@example.test');
  const body = requestBody();
  assert.equal((await call(env, 'orders', body, firstUser)).status, 201);
  assert.equal((await (await call(env, 'orders', body, firstUser)).json()).duplicate, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
  assert.equal((await (await call(env, 'orders', undefined, firstUser)).json()).orders.length, 1);
  assert.equal((await (await call(env, 'orders', undefined, secondUser)).json()).orders.length, 0);
});

test('los cambios del equipo aparecen sin exponer notas internas', async () => {
  const { env, sqlite } = setup();
  const session = await register(env);
  await call(env, 'orders', requestBody(), session);
  const row = sqlite.prepare('SELECT * FROM orders').get();
  const order = JSON.parse(row.data);
  order.status = 'Listo';
  order.notes = 'Nota privada del equipo';
  order.items[0].price = 1500;
  order.history.push({ text: 'Estado actualizado: Listo' });
  sqlite.prepare('UPDATE orders SET data=?').run(JSON.stringify(order));
  const result = await (await call(env, 'orders', undefined, session)).json();
  assert.equal(result.orders[0].status, 'Listo');
  assert.equal(result.orders[0].items[0].price, 1500);
  assert.equal(result.orders[0].notes, undefined);
  assert.equal(result.orders[0].pendingReview, false);
});

test('el cliente no puede establecer precios ni pagos', async () => {
  const { env, sqlite } = setup();
  const session = await register(env);
  const body = requestBody();
  body.items[0].price = 100;
  body.deposit = 100;
  body.status = 'Entregado';
  await call(env, 'orders', body, session);
  const order = JSON.parse(sqlite.prepare('SELECT data FROM orders').get().data);
  assert.equal(order.items[0].price, 0);
  assert.equal(order.deposit, 0);
  assert.equal(order.status, 'Recibido');
});

test('recuperación no simula envío cuando falta el proveedor', async () => {
  const { env } = setup();
  delete env.RESEND_API_KEY;
  assert.equal((await call(env, 'auth/forgot', { email: 'ana@example.test' })).status, 503);
});

test('el enlace de recuperación es de un solo uso e invalida sesiones', async () => {
  const { env } = setup();
  const session = await register(env);
  await withMailCapture(async (getEmail) => {
    assert.equal((await call(env, 'auth/forgot', { email: 'ana@example.test' })).status, 200);
    const token = getEmail().text.match(/reset-password\?token=([a-f0-9]{64})/)[1];
    assert.equal((await call(env, 'auth/reset', {
      token, password: 'nueva-clave-segura'
    })).status, 200);
    assert.equal((await (await call(env, 'session', undefined, session)).json()).user, null);
    assert.equal((await call(env, 'auth/reset', {
      token, password: 'segunda-clave-segura'
    })).status, 400);
    assert.equal((await call(env, 'auth/login', {
      email: 'ana@example.test', password: 'nueva-clave-segura'
    })).status, 200);
  });
});

for (const [id, name] of [
  ['madera', 'Grabado en madera'],
  ['cuero', 'Grabado en cuero'],
  ['virola', 'Grabado en virola']
]) {
  test('recibe y permite seguir solicitudes de ' + id, async () => {
    const { env, sqlite } = setup();
    const session = await register(env);
    const body = requestBody();
    body.items[0].serviceId = id;
    body.items[0].piece = id;
    assert.equal((await call(env, 'orders', body, session)).status, 201);
    const order = JSON.parse(sqlite.prepare('SELECT data FROM orders').get().data);
    assert.match(order.items[0].description, new RegExp(name));
    const result = await (await call(env, 'orders', undefined, session)).json();
    assert.equal(result.orders.length, 1);
    assert.match(result.orders[0].items[0].description, new RegExp(name));
  });
}

test('permite el dominio exacto de la nueva web de Vercel a través del proxy', async () => {
  const { env } = setup();
  env.PUBLIC_ORIGIN = 'https://mattu-app.vercel.app';
  const session = await register(env, 'ana@example.test', 'https://mattu-app.vercel.app');
  assert.equal((await call(env, 'orders', requestBody(), session, 'https://mattu-app.vercel.app')).status, 201);
});

test('rechaza un dominio que imita al de Vercel', async () => {
  const { env } = setup();
  assert.equal((await call(env, 'auth/register', {
    email: 'ana@example.test', name: 'Ana', password: 'mi-clave-segura'
  }, '', 'https://mattu-app.vercel.app.atacante.test')).status, 403);
});

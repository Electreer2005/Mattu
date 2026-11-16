import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.mjs';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL)');
  for (const file of ['0001_customer_accounts.sql','0002_email_verification.sql','0003_customer_roles.sql','0005_contact_messages.sql']) {
    sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
  }
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
    DB: { prepare, async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); } },
    ASSETS: { fetch: async () => new Response('static') },
    RESEND_API_KEY: 'test-key',
    MAIL_FROM: 'Mattu <cuentas@example.test>',
    PUBLIC_ORIGIN: 'https://mattu.test'
  };
  return { env, sqlite };
}

async function call(env, path, data, method = 'POST', cookieValue = '') {
  return worker.fetch(new Request('https://mattu.test/api/customer/' + path, {
    method,
    headers: { Origin: 'https://mattu.test', 'Content-Type': 'application/json', Cookie: cookieValue, 'CF-Connecting-IP': '192.0.2.10' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  }), env);
}

test('public contact saves a consultation and sends notification email', async () => {
  const { env, sqlite } = setup();
  const original = globalThis.fetch;
  let email;
  globalThis.fetch = async (_url, options) => {
    email = JSON.parse(options.body);
    return Response.json({ id: 'test-email' });
  };
  try {
    const response = await call(env, 'contact', {
      name: 'Cliente', phone: '+54 351 1234567', email: 'cliente@example.test',
      message: 'Quiero consultar por grabados.'
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.notificationSent, true);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM contact_messages').get().n, 1);
    assert.equal(email.to[0], 'solismauricioezequiel@gmail.com');
    assert.match(email.text, /Quiero consultar por grabados/);
  } finally {
    globalThis.fetch = original;
  }
});

test('contact validates required fields and email', async () => {
  const { env } = setup();
  assert.equal((await call(env, 'contact', { name: 'A', phone: '123456', message: 'Hola', email: 'mal' })).status, 400);
  assert.equal((await call(env, 'contact', { name: '', phone: '123456', message: 'Hola' })).status, 400);
});

test('contact honeypot avoids storing spam', async () => {
  const { env, sqlite } = setup();
  const response = await call(env, 'contact', { name: 'Bot', phone: '123456', message: 'spam', website: 'filled' });
  assert.equal(response.status, 201);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM contact_messages').get().n, 0);
});

test('admin contact inbox requires an authenticated admin', async () => {
  const { env } = setup();
  assert.equal((await call(env, 'admin/contacts', undefined, 'GET')).status, 401);
});

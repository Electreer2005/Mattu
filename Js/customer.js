(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);
  let user = null;
  async function api(path, body) {
    const r = await fetch('/api/customer/' + path, { credentials: 'same-origin', cache: 'no-store', ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!r.headers.get('Content-Type')?.includes('application/json')) throw Error('Las cuentas necesitan el despliegue de Cloudflare. Este alojamiento todavía no tiene la API activa.');
    const data = await r.json(); if (!r.ok) throw Error(data.error || 'No se pudo completar la operación.'); return data;
  }
  const message = text => { const el = $('#auth-message') || $('#orders-message'); if (el) el.textContent = text; };
  function tab(name) { $$('.auth-form').forEach(f => f.hidden = f.id !== name + '-form'); $$('.auth-tabs button').forEach(b => b.classList.toggle('selected', b.dataset.authTab === name)); message(''); }
  $$('[data-auth-tab]').forEach(b => b.addEventListener('click', () => tab(b.dataset.authTab)));
  $$('[data-toggle-password]').forEach(b => b.addEventListener('click', () => { const field = document.getElementById(b.dataset.togglePassword), visible = field.type === 'password'; field.type = visible ? 'text' : 'password'; b.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña'); }));
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken && $('#reset-form')) tab('reset');
  function destination() { const next = new URLSearchParams(location.search).get('next'); return ['Cart.html', 'Orders.html'].includes(next) ? next : 'Orders.html'; }
  for (const kind of ['login', 'register', 'forgot', 'reset']) {
    $('#' + kind + '-form')?.addEventListener('submit', async e => {
      e.preventDefault(); if (!e.target.reportValidity()) return;
      const data = Object.fromEntries(new FormData(e.target)), button = e.target.querySelector('[type=submit]');
      if (data.confirm !== undefined && data.confirm !== data.password) { message('Las contraseñas no coinciden.'); return; }
      delete data.confirm; if (kind === 'reset') data.token = resetToken;
      button.disabled = true; message('Procesando…');
      try { const result = await api('auth/' + kind, data); if (kind === 'login' || kind === 'register') location.href = destination(); else { if (kind === 'reset') { history.replaceState({}, '', 'Auth.html'); tab('login'); } message(result.message); } }
      catch (error) { message(error.message); } finally { button.disabled = false; }
    });
  }
  $$('[data-logout]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; try { await api('auth/logout', {}); location.href = 'Auth.html'; } catch (e) { message(e.message); b.disabled = false; } }));
  async function loadOrders() {
    if (!$('#customer-orders')) return;
    const button = $('#refresh-orders'); button.disabled = true; message('Cargando pedidos…');
    try {
      const data = await api('orders');
      $('#customer-orders').innerHTML = data.orders.length ? data.orders.map(o => {
        const total = o.items.reduce((s, x) => s + x.price * x.qty, 0);
        return `<article class="customer-order"><div class="customer-order-head"><div><p class="eyebrow">${esc(o.number)}</p><h2>${esc(o.status)}</h2></div><span>${new Date(o.createdAt).toLocaleDateString('es-AR')}</span></div>${o.pendingReview ? '<p class="account-notice">Solicitud recibida, pendiente de revisión y presupuesto del equipo.</p>' : ''}<ul>${o.items.map(x => `<li><b>${x.qty} unidad(es)</b><span>${esc(x.description)}</span></li>`).join('')}</ul><div class="order-amount">${total > 0 ? 'Total: ' + money(total) + ' · Saldo: ' + money(Math.max(0, total - o.deposit)) : 'Importe a cotizar'}</div><p class="form-note">Entrega: ${o.due ? new Date(o.due + 'T12:00:00').toLocaleDateString('es-AR') : 'A confirmar'} · ${esc(o.delivery)}</p></article>`;
      }).join('') : '<div class="empty-state"><h2>Todavía no tenés pedidos.</h2><p>Agregá tus piezas y enviá una solicitud desde tu cuenta.</p><a class="btn primary" href="Service.html">Explorar servicios</a></div>';
      message('');
    } catch (e) { message(e.message); } finally { button.disabled = false; }
  }
  $('#refresh-orders')?.addEventListener('click', loadOrders);
  $('#submit-customer-order')?.addEventListener('click', async e => {
    if (!user) { location.href = 'Auth.html?next=Cart.html'; return; }
    const form = $('#quote-form'); if (!form.reportValidity()) return;
    const b = e.currentTarget; b.disabled = true;
    try {
      const items = window.MATTU_CART_CORE.readCart(localStorage.getItem('mattu-quote-v1'), window.MATTU_SERVICES.map(s => s.id));
      if (!items.length) throw Error('Tu solicitud está vacía.');
      const fields = Object.fromEntries(new FormData(form));
      const fingerprint = JSON.stringify({ items, phone: fields.phone, notes: fields.notes });
      let draft; try { draft = JSON.parse(sessionStorage.getItem('mattu-submission') || 'null'); } catch {}
      if (!draft || draft.fingerprint !== fingerprint) { draft = { fingerprint, requestKey: crypto.randomUUID() }; sessionStorage.setItem('mattu-submission', JSON.stringify(draft)); }
      await api('orders', { items, phone: fields.phone, notes: fields.notes, requestKey: draft.requestKey });
      localStorage.removeItem('mattu-quote-v1'); sessionStorage.removeItem('mattu-submission'); location.href = 'Orders.html';
    } catch (error) { const notice = document.createElement('p'); notice.className = 'account-notice'; notice.setAttribute('role', 'alert'); notice.textContent = error.message; form.querySelector('.account-notice')?.remove(); form.append(notice); b.disabled = false; }
  });
  api('session').then(data => {
    user = data.user;
    if (user) {
      $$('[data-account-link]').forEach(a => { a.href = 'Orders.html'; a.textContent = 'Mis pedidos'; });
      if ($('#quote-name')) $('#quote-name').value = user.name;
      if ($('#quote-email')) $('#quote-email').value = user.email;
      if ($('#signed-in') && !resetToken) { $('#signed-in').hidden = false; $('#auth-forms').hidden = true; $('#signed-in-name').textContent = user.name; }
      loadOrders();
      if ($('#customer-orders')) setInterval(() => { if (!document.hidden && navigator.onLine) loadOrders(); }, 15000);
    } else if ($('#customer-orders')) { $('#customer-orders').innerHTML = '<div class="empty-state"><h2>Iniciá sesión para ver tus pedidos.</h2><a class="btn primary" href="Auth.html?next=Orders.html">Entrar a mi cuenta</a></div>'; $('#refresh-orders').hidden = true; $$('[data-logout]').forEach(b => b.hidden = true); }
  }).catch(error => { if ($('#auth-forms') || $('#customer-orders')) message(error.message); });
})();

(() => {
  'use strict';
  const config = window.MATTU_CONFIG;
  const services = window.MATTU_SERVICES;
  const core = window.MATTU_CART_CORE;
  const key = 'mattu-quote-v1';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let cart = [], editId = null, currentService = null, toastTimer;
  try { cart = core.readCart(localStorage.getItem(key), services.map(s => s.id)); } catch { /* El formulario sigue disponible sin persistencia. */ }
  function toast(message) { const el = $('.toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5000); }
  function save(next) {
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { toast('No se pudo guardar. Permití el almacenamiento del sitio o usá otro navegador.'); return false; }
    cart = next; updateCount(); return true;
  }
  function updateCount() { $$('[data-cart-count]').forEach(el => { el.textContent = cart.reduce((sum, item) => sum + item.qty, 0); }); }
  updateCount();
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
  const menu = $('.menu-toggle'), nav = $('#main-nav');
  menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', open); menu.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú'); nav.classList.toggle('open', open); });
  nav.addEventListener('click', e => { if (e.target.closest('a')) { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });
  window.matchMedia('(min-width: 901px)').addEventListener('change', () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); });
  function showDialog(dialog) { if (dialog.open) return; dialog.showModal(); document.body.classList.add('dialog-open'); }
  document.addEventListener('click', e => { const close = e.target.closest('.dialog-close'); if (close) close.closest('dialog').close(); if (e.target.tagName === 'DIALOG') { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
  document.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open'); }, true);
  function openService(id, item = null) {
    currentService = services.find(x => x.id === id); if (!currentService) return;
    editId = item?.id || null;
    $('#service-form').reset(); $('#dialog-title').textContent = currentService.name; $('#dialog-detail').textContent = currentService.detail;
    $('#dialog-image').src = currentService.image; $('#dialog-image').alt = currentService.alt;
    if (item) { $('#piece').value = item.piece; $('#material').value = item.material; $('#quantity').value = item.qty; $('#design').value = item.design; }
    $('#service-form button[type="submit"]').innerHTML = editId ? 'Guardar cambios' : 'Agregar a mi solicitud <i class="fa-solid fa-plus" aria-hidden="true"></i>';
    if (editId) $('#service-form button[type="submit"]').textContent = 'Guardar cambios';
    showDialog($('#service-dialog'));
  }
  $$('[data-service]').forEach(button => button.addEventListener('click', () => openService(button.dataset.service)));
  $('#service-form').addEventListener('submit', e => {
    e.preventDefault(); if (!e.target.reportValidity()) return;
    const raw = Object.fromEntries(new FormData(e.target));
    const item = core.normalizeItem({ id: editId || (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()), serviceId: currentService.id, ...raw, qty: Number(raw.quantity) }, services.map(s => s.id));
    if (!item) { toast('Completá el tipo de pieza y los detalles del grabado.'); return; }
    try { const next = editId ? cart.map(x => x.id === editId ? item : x) : core.addItem(cart, item); if (!save(next)) return; $('#service-dialog').close(); renderCart(); toast(editId ? 'Los detalles se actualizaron.' : 'Agregado a tu solicitud. Podés seguir eligiendo o revisar Mi solicitud.'); }
    catch (error) { toast(error.message); }
  });
  const param = new URLSearchParams(location.search).get('servicio'); if (param) openService(param);
  let activeFilter = 'Todos';
  function filterCatalog() {
    const query = ($('#service-search')?.value || '').toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, ''); let matches = 0;
    $$('.catalog .service-card').forEach(card => { const text = card.textContent.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, ''); const visible = (activeFilter === 'Todos' || card.dataset.category === activeFilter) && text.includes(query); card.hidden = !visible; if (visible) matches++; });
    if ($('#no-results')) $('#no-results').hidden = matches > 0;
  }
  $$('[data-filter]').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; $$('[data-filter]').forEach(b => { const selected = b === button; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected); }); filterCatalog(); }));
  $('#service-search')?.addEventListener('input', filterCatalog);
  function renderCart() {
    if (!$('#cart-items')) return;
    $('#cart-empty').hidden = cart.length !== 0; $('#cart-content').hidden = cart.length === 0;
    $('#piece-count').textContent = cart.reduce((sum, x) => sum + x.qty, 0);
    $('#cart-items').innerHTML = cart.map(item => { const s = services.find(x => x.id === item.serviceId); return `<article class="cart-item"><img src="${s.image}" alt="${s.alt}" width="112" height="136"><div class="cart-item-body"><span class="eyebrow">${s.category}</span><h3>${s.name}</h3><p>${escape(item.piece)} · ${escape(item.material || 'Material a confirmar')}</p><p class="item-design">${escape(item.design)}</p><button class="quiet-link" data-edit="${escape(item.id)}">Editar detalles</button></div><div class="cart-item-actions"><label for="qty-${escape(item.id)}">Cantidad</label><div class="quantity-control"><button data-quantity="${escape(item.id)}" data-delta="-1" aria-label="Reducir cantidad" ${item.qty === 1 ? 'disabled' : ''}>−</button><input id="qty-${escape(item.id)}" data-qty-input="${escape(item.id)}" type="number" min="1" max="9999" step="1" value="${item.qty}"><button data-quantity="${escape(item.id)}" data-delta="1" aria-label="Aumentar cantidad" ${item.qty === 9999 ? 'disabled' : ''}>+</button></div><button class="remove-item" data-remove="${escape(item.id)}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Quitar</button></div></article>`; }).join('');
  }
  renderCart();
  $('#cart-items')?.addEventListener('click', e => {
    const remove = e.target.closest('[data-remove]'); if (remove && save(cart.filter(x => x.id !== remove.dataset.remove))) { renderCart(); toast('Pieza quitada de la solicitud.'); }
    const edit = e.target.closest('[data-edit]'); if (edit) { const item = cart.find(x => x.id === edit.dataset.edit); openService(item.serviceId, item); }
    const change = e.target.closest('[data-quantity]'); if (change) { const next = cart.map(x => x.id === change.dataset.quantity ? { ...x, qty: Math.min(9999, Math.max(1, x.qty + Number(change.dataset.delta))) } : x); if (save(next)) renderCart(); }
  });
  $('#cart-items')?.addEventListener('change', e => { if (!e.target.matches('[data-qty-input]')) return; const qty = Number(e.target.value); if (!Number.isInteger(qty) || qty < 1 || qty > 9999) { toast('Ingresá una cantidad entre 1 y 9999.'); renderCart(); return; } if (save(cart.map(x => x.id === e.target.dataset.qtyInput ? { ...x, qty } : x))) renderCart(); });
  function makeDialog(id, content) { const d = document.createElement('dialog'); d.id = id; d.className = 'message-dialog'; d.innerHTML = '<button class="dialog-close" type="button" aria-label="Cerrar">×</button>' + content; document.body.append(d); return d; }
  const messageDialog = makeDialog('message-dialog', '<p class="eyebrow">REVISÁ ANTES DE ENVIAR</p><h2>Tu idea, lista para compartir.</h2><p class="muted">La consulta todavía no se envió. Revisá los detalles y compartila con el equipo.</p><label for="message-text">Mensaje preparado</label><textarea id="message-text" rows="10" readonly></textarea><div class="message-actions"><button class="btn primary" id="copy-message">Copiar mensaje</button><button class="btn secondary" id="download-message">Descargar</button><a class="btn secondary" id="whatsapp-message" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Abrir WhatsApp</a></div><p class="form-note" id="whatsapp-note"></p>');
  function prepare(message) {
    $('#message-text').value = message;
    const phone = config.whatsapp.replace(/\D/g, '');
    $('#whatsapp-message').href = `https://wa.me/${phone ? phone : ''}?text=${encodeURIComponent(message)}`;
    $('#whatsapp-note').textContent = phone ? 'WhatsApp abrirá el chat de Mattu. Presioná Enviar para compartir tu consulta.' : 'Al abrir WhatsApp, elegí el contacto de Mattu. También podés copiar el mensaje y consultarnos por Instagram @mattu.ar.';
    showDialog(messageDialog);
  }
  $('#quote-form')?.addEventListener('submit', e => { e.preventDefault(); if (!e.target.reportValidity()) return; if (!cart.length) return; const data = Object.fromEntries(new FormData(e.target)); if (!String(data.name).trim() || !String(data.phone).trim()) { toast('Completá nombre y teléfono.'); return; } prepare(core.quoteMessage(cart, services, data)); });
  $('#contact-form')?.addEventListener('submit', e => { e.preventDefault(); if (!e.target.reportValidity()) return; const d = Object.fromEntries(new FormData(e.target)); if (![d.name, d.phone, d.message].every(x => String(x).trim())) { toast('Completá nombre, teléfono y tu idea.'); return; } prepare(`Hola Mattu, quisiera hacer una consulta.\n\nNombre / joyería: ${d.name}\nTeléfono: ${d.phone}\n${d.email ? 'Correo: ' + d.email + '\n' : ''}\nMi idea:\n${d.message}`); });
  $('#copy-message').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#message-text').value); toast('Mensaje copiado. Pegalo en tu conversación con Mattu.'); } catch { $('#message-text').focus(); $('#message-text').select(); toast('Seleccionamos el mensaje. Copialo con Ctrl+C o el menú de tu celular.'); } });
  $('#download-message').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([$('#message-text').value], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'solicitud-mattu.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  window.addEventListener('storage', e => { if (e.key === key) { cart = core.readCart(e.newValue, services.map(x => x.id)); updateCount(); renderCart(); } });
  const galleryDialog = makeDialog('gallery-dialog', '<img id="gallery-full" src="Img/Banner-1.jpeg" alt=""><p id="gallery-caption"></p>');
  $$('[data-gallery]').forEach(button => button.addEventListener('click', () => { $('#gallery-full').src = button.dataset.gallery; $('#gallery-full').alt = button.dataset.caption; $('#gallery-caption').textContent = button.dataset.caption; showDialog(galleryDialog); }));
  const slides = $$('.hero-slider .slide');
  if (slides.length) {
    let current = 0, timer, paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pause = $('.slider-pause');
    function go(index) { current = index; slides.forEach((slide, i) => { slide.hidden = i !== current; slide.classList.toggle('active', i === current); }); $$('.dot').forEach((dot, i) => { dot.classList.toggle('active', i === current); dot.setAttribute('aria-pressed', i === current); }); }
    function start() { clearInterval(timer); if (!paused && !document.hidden) timer = setInterval(() => go((current + 1) % slides.length), 6000); }
    function updatePause() { pause.setAttribute('aria-label', paused ? 'Reanudar presentación' : 'Pausar presentación'); if (paused) pause.setAttribute('aria-label', 'Reanudar presentación'); pause.innerHTML = `<i class="fa-solid fa-${paused ? 'play' : 'pause'}" aria-hidden="true"></i>`; start(); }
    $$('.dot').forEach((dot, i) => dot.addEventListener('click', () => { go(i); start(); })); pause.addEventListener('click', () => { paused = !paused; updatePause(); }); document.addEventListener('visibilitychange', start);
    $('.hero-visual').addEventListener('mouseenter', () => clearInterval(timer)); $('.hero-visual').addEventListener('mouseleave', start); $('.hero-visual').addEventListener('focusin', () => clearInterval(timer)); $('.hero-visual').addEventListener('focusout', start); updatePause();
  }
})();

/* Mejoras visuales independientes de la lógica de solicitudes y cuentas. */
(() => {
  'use strict';
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.header');
  const sentinel = document.querySelector('.announcement');
  if ('IntersectionObserver' in window && header && sentinel) {
    const headerObserver = new IntersectionObserver(([entry]) => {
      header.classList.toggle('is-scrolled', !entry.isIntersecting);
    });
    headerObserver.observe(sentinel);
  }

  let observer;
  function revealContent() {
    observer?.disconnect();
    const elements = document.querySelectorAll('.hero-copy > *, .hero-visual, .section-heading, .service-card, .story-image, .story-copy, .steps li, .gallery-item, .contact-grid > *, .page-heading, .faq-intro, .faq-list details, .wholesale, .account-story, .account-card, .quote-panel');
    elements.forEach(el => {
      el.classList.remove('reveal-pending', 'reveal-ready');
      el.style.removeProperty('--reveal-delay');
    });
    if (motion.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => {
      let index = 0;
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.style.setProperty('--reveal-delay', `${Math.min(index++, 3) * 65}ms`);
        el.classList.add('is-visible');
        el.classList.remove('reveal-pending');
        observer.unobserve(el);
      });
    }, { threshold: 0.06 });
    elements.forEach(el => {
      // No ocultar controles enfocados ni contenido que ya está en pantalla.
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) return;
      el.classList.remove('is-visible');
      el.classList.add('reveal-pending', 'reveal-ready');
      observer.observe(el);
    });
  }
  revealContent();
  motion.addEventListener('change', revealContent);
  document.addEventListener('focusin', event => {
    const el = event.target.closest('.reveal-pending');
    if (el) { el.classList.remove('reveal-pending'); el.classList.add('is-visible'); observer?.unobserve(el); }
  });
  document.querySelectorAll('[data-cart-count]').forEach(count => {
    new MutationObserver(() => {
      if (motion.matches) return;
      count.classList.remove('is-updated');
      void count.offsetWidth;
      count.classList.add('is-updated');
    }).observe(count, { childList: true });
  });
})();

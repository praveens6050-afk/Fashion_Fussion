(() => {
  'use strict';

  const dashboard = document.getElementById('dashboard');
  if (!dashboard) return;

  const labels = [
    { match: /product management/i, label: 'Catalog', icon: '◈' },
    { match: /order attention|payment review|aftercare|return/i, label: null, icon: '↺' },
    { match: /orders/i, label: 'Orders', icon: '▤' },
    { match: /seller product approvals/i, label: 'Seller listings', icon: '◇' },
    { match: /seller kyc|payout|settlement/i, label: 'Seller accounts', icon: '♙' },
    { match: /business quotes/i, label: 'B2B quotes', icon: '▱' },
    { match: /creator/i, label: 'Creators', icon: '✦' },
    { match: /shipping|shiprocket/i, label: 'Delivery', icon: '➤' },
    { match: /checkout/i, label: 'Checkout', icon: '✓' },
    { match: /launch readiness/i, label: 'Launch check', icon: '◉' },
    { match: /inventory/i, label: 'Inventory', icon: '▦' },
    { match: /promotion|coupon|gift card/i, label: 'Promotions', icon: '％' },
    { match: /notification/i, label: 'Notifications', icon: '♧' },
    { match: /support|customer care/i, label: 'Customer care', icon: '♡' },
    { match: /owner center|workspace/i, label: 'Workspace', icon: '⌂' }
  ];

  function getLabel(title) {
    const entry = labels.find(item => item.match.test(title));
    if (!entry) return { label: title, icon: '•' };
    if (entry.label) return entry;
    if (/payment/i.test(title)) return { label: 'Payments', icon: entry.icon };
    if (/return/i.test(title)) return { label: 'Returns', icon: entry.icon };
    return { label: 'Order attention', icon: entry.icon };
  }

  function cardsIn(container) {
    return [...container.children].filter(node => node.matches('section.card') && node.querySelector('.card-header h2'));
  }

  function ensureStyle() {
    if (document.querySelector('link[data-admin-workspace-style]')) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'admin-workspace.css?v=20261029-admin-workspace';
    style.setAttribute('data-admin-workspace-style', 'true');
    document.head.appendChild(style);
  }

  function buildNav(container, nav) {
    const cards = cardsIn(container);
    const previous = nav.querySelector('[aria-current="location"]')?.getAttribute('href');
    nav.replaceChildren();
    const hint = document.createElement('span');
    hint.className = 'ff-admin-nav-label';
    hint.textContent = 'Jump to';
    nav.append(hint);

    cards.forEach((card, index) => {
      const heading = card.querySelector('.card-header h2');
      const title = heading.textContent.trim();
      if (!title) return;
      if (!card.id) card.id = 'ffAdminSection' + (index + 1);
      const item = getLabel(title);
      const link = document.createElement('a');
      link.href = '#' + card.id;
      link.setAttribute('aria-label', 'Go to ' + item.label);
      if (previous === link.getAttribute('href')) link.setAttribute('aria-current', 'location');
      const icon = document.createElement('span');
      icon.className = 'ff-admin-nav-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.icon;
      const text = document.createElement('span');
      text.textContent = item.label;
      link.append(icon, text);
      nav.append(link);
    });

    if (!nav.querySelector('a[aria-current="location"]')) nav.querySelector('a')?.setAttribute('aria-current', 'location');
    nav.hidden = cards.length === 0;
  }

  function start() {
    if (dashboard.dataset.adminReady !== 'true') return;
    const container = dashboard.querySelector('.container');
    if (!container) return;
    document.documentElement.classList.add('ff-admin-page');
    ensureStyle();

    let nav = document.getElementById('ffAdminWorkspaceNav');
    if (!nav) {
      nav = document.createElement('nav');
      nav.id = 'ffAdminWorkspaceNav';
      nav.className = 'ff-admin-nav';
      nav.setAttribute('aria-label', 'Admin sections');
      const stats = container.querySelector('.stats');
      container.insertBefore(nav, stats || container.children[1] || null);
    }

    buildNav(container, nav);
    const childObserver = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node instanceof Element && node.matches('section.card')))) {
        buildNav(container, nav);
      }
    });
    childObserver.observe(container, { childList: true });

    if ('IntersectionObserver' in window) {
      const sectionObserver = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (!visible.length) return;
        const current = '#' + visible[0].target.id;
        nav.querySelectorAll('a').forEach(link => {
          if (link.getAttribute('href') === current) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }, { rootMargin: '-150px 0px -58% 0px', threshold: 0.05 });
      cardsIn(container).forEach(card => sectionObserver.observe(card));
      childObserver.disconnect();
      const observeNewSections = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('section.card')) sectionObserver.observe(node);
        }
        if (records.some(record => [...record.addedNodes].some(node => node instanceof Element && node.matches('section.card')))) {
          buildNav(container, nav);
        }
      });
      observeNewSections.observe(container, { childList: true });
    }

    nav.addEventListener('click', event => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const target = document.getElementById(link.hash.slice(1));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', link.hash);
    });
  }

  if (dashboard.dataset.adminReady === 'true') start();
  else {
    const readyObserver = new MutationObserver(() => {
      if (dashboard.dataset.adminReady !== 'true') return;
      readyObserver.disconnect();
      start();
    });
    readyObserver.observe(dashboard, { attributes: true, attributeFilter: ['data-admin-ready'] });
  }
})();


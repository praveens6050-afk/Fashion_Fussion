(function () {
  'use strict';
  const buy = document.getElementById('buy');
  const name = document.getElementById('name');
  if (!buy || !name) return;
  const mount = () => {
    const productName = name.textContent.trim();
    if (!productName || productName === 'Details' || document.getElementById('productEnquiryLink')) return;
    const link = document.createElement('a');
    link.id = 'productEnquiryLink';
    link.className = 'btn enquiry';
    const query = new URLSearchParams();
    query.set('interest', productName);
    query.set('landing_page', location.href);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
      const value = new URLSearchParams(location.search).get(key);
      if (value) query.set(key, value);
    }
    link.href = 'enquiry.html?' + query.toString();
    link.textContent = 'ASK ABOUT THIS PRODUCT';
    buy.insertAdjacentElement('afterend', link);
  };
  mount();
  new MutationObserver(mount).observe(name, { childList: true, characterData: true, subtree: true });
})();


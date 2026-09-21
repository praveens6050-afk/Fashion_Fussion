'use strict';

(() => {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-compliance-edit]');
    if (!button) return;
    if (typeof openDrawer === 'function') openDrawer(button.dataset.complianceEdit);
  });
})();

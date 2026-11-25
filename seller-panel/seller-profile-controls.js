'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const form = $('sellerProfileForm');
  if (!form) return;
  const fields = ['profileFirstName','profileLastName','profileStoreName','profileMobile']
    .map($).filter(Boolean);
  const edit = $('editSellerProfile');
  const cancel = $('cancelSellerProfile');
  const save = $('saveSellerProfile');
  const sellerType = $('profileSellerType');
  const email = $('profileEmail');
  let snapshot = null;

  function lock() {
    fields.forEach(field => { field.readOnly = true; });
    if (sellerType) sellerType.disabled = true;
    if (email) email.disabled = true;
    if (edit) edit.hidden = false;
    if (cancel) cancel.hidden = true;
    if (save) save.hidden = true;
    form.dataset.editing = 'false';
  }

  function begin() {
    snapshot = Object.fromEntries(fields.map(field => [field.id, field.value]));
    fields.forEach(field => { field.readOnly = false; });
    if (edit) edit.hidden = true;
    if (cancel) cancel.hidden = false;
    if (save) save.hidden = false;
    form.dataset.editing = 'true';
    fields[0]?.focus();
  }

  function cancelEdit() {
    if (snapshot) fields.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(snapshot, field.id)) field.value = snapshot[field.id];
    });
    snapshot = null;
    lock();
  }

  function complete() {
    snapshot = null;
    lock();
  }

  const card = form.closest('.profile-card');
  const title = card?.querySelector(':scope > h2');
  const actions = form.querySelector('.form-actions');
  if (card && title && actions && !card.querySelector('.profile-card-head')) {
    title.textContent = 'Profile information';
    const description = card.querySelector(':scope > p');
    if (description) description.textContent = 'Manage the required seller contact and store details for your account.';
    const head = document.createElement('div');
    head.className = 'profile-card-head';
    save?.setAttribute('form', form.id);
    head.append(title, actions);
    card.prepend(head);
  }

  edit?.addEventListener('click', begin);
  cancel?.addEventListener('click', cancelEdit);
  window.FFSellerProfileControls = { complete, lock: complete };
  lock();
})();

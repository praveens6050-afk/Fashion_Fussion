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

  const style = document.createElement('style');
  style.textContent = '.profile-support-note{margin-top:14px;padding:12px 14px;border:1px solid #e7ebf1;border-radius:10px;background:#f7f9fc;color:#5f6878;font-size:11px;line-height:1.5}.profile-support-note a{font-weight:700;text-decoration:underline}';
  document.head.appendChild(style);

  edit?.addEventListener('click', begin);
  cancel?.addEventListener('click', cancelEdit);
  window.FFSellerProfileControls = { complete, lock: complete };
  lock();
})();

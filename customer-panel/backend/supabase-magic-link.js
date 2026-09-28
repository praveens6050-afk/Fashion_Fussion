'use strict';

const { SUPABASE_URL, serverHeaders } = require('./lib');

async function getAuthUserById(userId) {
  const response = await fetch(
    SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(String(userId || '')),
    { headers: { ...serverHeaders, Accept: 'application/json' } }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) {
    throw new Error('Could not confirm the customer account for payment recovery.');
  }
  return data;
}

async function getConfirmedAuthEmail(userId) {
  const user = await getAuthUserById(userId);
  const email = String(user.email || '').trim().toLowerCase();
  if (!email || !email.includes('@') || !user.email_confirmed_at) {
    throw new Error('The customer account does not have a confirmed email address.');
  }
  return email;
}

async function generatePaymentRetryMagicLink({ email, redirectTo }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('A confirmed customer email is required for payment recovery.');
  }

  const response = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: {
      ...serverHeaders,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'magiclink',
      email: normalizedEmail,
      redirect_to: String(redirectTo || '')
    })
  });
  const data = await response.json().catch(() => ({}));
  const actionLink = String(data?.action_link || data?.properties?.action_link || '').trim();
  if (!response.ok || !actionLink) {
    throw new Error(data?.msg || data?.message || data?.error_description || 'Could not create the secure payment link.');
  }

  return actionLink;
}

module.exports = { getConfirmedAuthEmail, generatePaymentRetryMagicLink };

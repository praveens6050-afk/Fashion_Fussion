// Sender selection only. This module never sends email or changes OAuth credentials.
// The order confirmation address is a confirmed alias of the EXISTING Zoho mailbox.
// Other notifications retain the sender configured in Cloudflare until approved separately.
export const ORDER_CONFIRMATION_FROM = 'orders@fashionfussion.in';

export function getZohoSenderForEvent(env, eventType) {
  const accountId = String(env.ZOHO_MAIL_ACCOUNT_ID || '').trim();
  const salesFrom = String(env.ZOHO_MAIL_FROM_ADDRESS || '').trim().toLowerCase();
  if (eventType === 'order_confirmed') {
    return { accountId, fromAddress: ORDER_CONFIRMATION_FROM, purpose: 'order_confirmation' };
  }
  return { accountId, fromAddress: salesFrom, purpose: 'outreach' };
}

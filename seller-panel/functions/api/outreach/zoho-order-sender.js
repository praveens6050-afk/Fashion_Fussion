// Independent Zoho mailbox selection; no sends or configuration changes.
// Zoho Admin Console showed orders@ as a separate active USER, not an alias
// of the sales.team mailbox. Never silently fall back to the Sales credentials.
export const ORDER_CONFIRMATION_FROM = 'orders@fashionfussion.in';

export function zohoSenderConfiguration(env, purpose='outreach') {
  if (purpose==='order_confirmation') {
    return {
      purpose,
      accountId: String(env.ZOHO_ORDERS_MAIL_ACCOUNT_ID || '').trim(),
      fromAddress: ORDER_CONFIRMATION_FROM,
      clientId: String(env.ZOHO_ORDERS_CLIENT_ID || '').trim(),
      clientSecret: String(env.ZOHO_ORDERS_CLIENT_SECRET || '').trim(),
      refreshToken: String(env.ZOHO_ORDERS_REFRESH_TOKEN || '').trim(),
      missingConfiguration: [
        'ZOHO_ORDERS_CLIENT_ID', 'ZOHO_ORDERS_CLIENT_SECRET',
        'ZOHO_ORDERS_REFRESH_TOKEN', 'ZOHO_ORDERS_MAIL_ACCOUNT_ID',
      ].filter(name=>!String(env[name]||'').trim()),
    };
  }
  if (purpose !== 'outreach') throw new Error('Unsupported Zoho sender purpose');
  return {
    purpose,
    accountId: String(env.ZOHO_MAIL_ACCOUNT_ID || '').trim(),
    fromAddress: String(env.ZOHO_MAIL_FROM_ADDRESS || '').trim().toLowerCase(),
    clientId: String(env.ZOHO_CLIENT_ID || '').trim(),
    clientSecret: String(env.ZOHO_CLIENT_SECRET || '').trim(),
    refreshToken: String(env.ZOHO_REFRESH_TOKEN || '').trim(),
    missingConfiguration: [
      'ZOHO_CLIENT_ID','ZOHO_CLIENT_SECRET','ZOHO_REFRESH_TOKEN',
      'ZOHO_MAIL_ACCOUNT_ID','ZOHO_MAIL_FROM_ADDRESS',
    ].filter(name=>!String(env[name]||'').trim()),
  };
}
// Used by order preview. This is a configuration choice, never proof of permission.
export function getZohoSenderForEvent(env,eventType){
  return zohoSenderConfiguration(env,eventType==='order_confirmed'?'order_confirmation':'outreach');
}

// Read-only WhatsApp production telemetry. No Meta calls, messages, OTPs or DB mutations.
const GROUPS = Object.freeze({
  incomingTotal: ['whatsapp_inbound_events', 'id', ''],
  incomingNeedsReview: ['whatsapp_inbound_events', 'id', '&routing_status=eq.needs_review'],
  classifiedAdmin: ['whatsapp_inbound_events', 'id', '&sender_role=eq.admin'],
  classifiedSeller: ['whatsapp_inbound_events', 'id', '&sender_role=eq.seller'],
  classifiedCustomer: ['whatsapp_inbound_events', 'id', '&sender_role=eq.customer'],
  orderStagedTotal: ['whatsapp_order_notification_outbox', 'id', ''],
  orderPendingReview: ['whatsapp_order_notification_outbox', 'id', '&status=eq.pending_review'],
  orderReady: ['whatsapp_order_notification_outbox', 'id', '&status=eq.ready'],
  orderSending: ['whatsapp_order_notification_outbox', 'id', '&status=eq.sending'],
  orderAccepted: ['whatsapp_order_notification_outbox', 'id', '&status=eq.accepted'],
  orderDelivered: ['whatsapp_order_notification_outbox', 'id', '&status=eq.delivered'],
  orderBlocked: ['whatsapp_order_notification_outbox', 'id', '&status=eq.blocked'],
  orderFailed: ['whatsapp_order_notification_outbox', 'id', '&status=eq.failed'],
  signedReceipts: ['whatsapp_delivery_status_events', 'id', ''],
  receiptDelivered: ['whatsapp_delivery_status_events', 'id', '&meta_status=eq.delivered'],
  receiptRead: ['whatsapp_delivery_status_events', 'id', '&meta_status=eq.read'],
  receiptFailed: ['whatsapp_delivery_status_events', 'id', '&meta_status=eq.failed'],
  activeTransactionalOptIns: ['whatsapp_contact_consents', 'id', '&purpose=eq.transactional&status=eq.opted_in&revoked_at=is.null'],
  activeMarketingOptIns: ['whatsapp_contact_consents', 'id', '&purpose=eq.marketing&status=eq.opted_in&revoked_at=is.null'],
  orderSpecificConsents: ['whatsapp_order_consents', 'order_id', '&revoked_at=is.null']
});
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {status, headers: {
    'content-type': 'application/json; charset=UTF-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }});
}
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value || '')));
}
async function authorized(request, env) {
  if (!env.OUTREACH_API_TOKEN) return false;
  const header = request.headers.get('authorization') || '';
  const submitted = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [a,b] = await Promise.all([digest(submitted), digest(env.OUTREACH_API_TOKEN)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
async function countRows(base, key, [table, column, filters]) {
  const url = base + '/rest/v1/' + table + '?select=' + column + filters;
  const response = await fetch(url, {method: 'HEAD', headers: {
    apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact'
  }});
  if (!response.ok) throw new Error('Count query failed for ' + table);
  const header = response.headers.get('content-range') || '';
  const match = header.match(/\/(\d+)$/);
  if (!match) throw new Error('Exact count unavailable for ' + table);
  return Number(match[1]);
}
// HEAD-only schema probe: never invokes the side-effecting claim RPC.
async function hasAtomicOutboxColumn(base, key) {
  const response = await fetch(base+'/rest/v1/whatsapp_order_notification_outbox?select=attempt_started_at&limit=0', {
    method:'HEAD', headers:{apikey:key, Authorization:'Bearer '+key, Accept:'application/json'}
  });
  if (response.ok) return true;
  // A PostgREST 400 is expected while the reviewed SQL migration is absent.
  // All other errors may indicate a permissions or connectivity problem.
  if (response.status === 400) return false;
  throw new Error('WhatsApp atomic schema probe unavailable');
}
export async function onRequestGet({request, env}) {
  if (!(await authorized(request, env))) return json({error:'Unauthorized'},401);
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '');
  if (!base || !key) return json({error:'Server database configuration missing'},503);
  const required = ['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_GRAPH_VERSION','WHATSAPP_VERIFY_TOKEN','WHATSAPP_APP_SECRET',
    'WHATSAPP_ALLOWED_TEMPLATES'];
  const missing = required.filter(name => !env[name]);
  if (env.WHATSAPP_PHONE_NUMBER_ID && !/^[0-9]{13,25}$/.test(String(env.WHATSAPP_PHONE_NUMBER_ID).trim())) {
    missing.push('WHATSAPP_PHONE_NUMBER_ID_INVALID');
  }
  try {
    const pairs = await Promise.all(Object.entries(GROUPS)
      .map(async ([name, details]) => [name, await countRows(base,key,details)]));
    const atomicOutboxColumnPresent = await hasAtomicOutboxColumn(base,key);
    return json({
      readOnly: true, messagesSent: 0, noDatabaseChanges: true,
      atomicDispatchSchema: {
        outboxAttemptColumnPresent:atomicOutboxColumnPresent,
        claimRpcVerified:false,
        status:atomicOutboxColumnPresent?'MANUAL_RPC_AND_SQL_REVIEW_REQUIRED':'MIGRATION_REQUIRED',
        note:'This HEAD-only endpoint NEVER invokes the claim/finish RPCs. Verify their grants separately before launch.'
      },
      dispatchLaunchGatePresence: {
        sendingFlagTrue: env.WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED === 'true',
        globalApprovalFlagTrue: env.WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED === 'true',
        internalTokenPresent: Boolean(env.WHATSAPP_ORDER_INTERNAL_TOKEN),
        cutoffPresent: Boolean(env.WHATSAPP_ORDER_CONFIRMATION_NOT_BEFORE)
      },
      configPresenceOnly: {ready:missing.length === 0, missing,
        otpEnvPresent:Boolean(env.WHATSAPP_OTP_SECRET),
        note:'Does not validate Meta credentials, approved template content or live Cloudflare deployment.'},
      counts: Object.fromEntries(pairs),
      caveats:['Delivery receipts may belong to OTP or outreach, not necessarily orders.',
        'Unclassified inbound messages require manual triage; role inference must not be forced.',
        'This endpoint cannot confirm cron deployment or Meta template approval; queue counts alone do not establish sending.']
    });
  } catch (err) {
    console.error('WhatsApp read-only health query failed',String(err?.message || err));
    return json({error:'WhatsApp integration health unavailable; no messages sent'},503);
  }
}

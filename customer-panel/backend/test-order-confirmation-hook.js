'use strict';
// Standalone Node test; never touches the live mail provider, Cloudflare or Supabase.
const assert = require('node:assert/strict');
const { notifyConfirmedOrder, scheduleConfirmedOrder } = require('./order-confirmation-notify');

async function main() {
  const backup = {
    enabled: process.env.FF_ORDER_EMAIL_HOOK_ENABLED,
    token: process.env.ZOHO_ORDER_EVENT_TOKEN,
    fetch: global.fetch
  };
  const calls = [];
  let status = 200;
  let networkFailure = false;
  global.fetch = async (url, options) => {
    calls.push({url,options});
    if(networkFailure)throw new Error('synthetic network error');
    return {ok:status===200,status,json:async()=>({accepted:status===200,sent:status===200?1:0})};
  };
  try {
    delete process.env.FF_ORDER_EMAIL_HOOK_ENABLED;
    delete process.env.ZOHO_ORDER_EVENT_TOKEN;
    assert.equal((await notifyConfirmedOrder(123)).reason,'customer_hook_disabled');
    assert.equal(calls.length,0);

    process.env.FF_ORDER_EMAIL_HOOK_ENABLED='true';
    assert.equal((await notifyConfirmedOrder(123)).reason,'service_token_not_configured');
    process.env.ZOHO_ORDER_EVENT_TOKEN='too-short';
    assert.equal((await notifyConfirmedOrder(123)).reason,'service_token_not_configured');

    process.env.ZOHO_ORDER_EVENT_TOKEN='SYNTHETIC-long-service-token-not-real-0123456789ABCDEFGHIJKLMNOP';
    assert.equal((await notifyConfirmedOrder('-1')).reason,'invalid_order_id');
    assert.equal((await notifyConfirmedOrder('1; SELECT * FROM users')).reason,'invalid_order_id');
    assert.equal(calls.length,0);

    const ok=await notifyConfirmedOrder(123,'node_test');
    assert.equal(ok.accepted,true);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://seller.fashionfussion.in/api/outreach/zoho-confirmation-dispatch');
    assert.equal(calls[0].options.headers.Authorization,'Bearer '+process.env.ZOHO_ORDER_EVENT_TOKEN);
    assert.deepEqual(JSON.parse(calls[0].options.body),{orderId:123,confirmSend:true});
    assert.equal(calls[0].options.body.includes('SYNTHETIC-'),false);

    status=409;
    assert.equal((await notifyConfirmedOrder(123)).reason,'not_eligible_or_duplicate');
    status=423;
    assert.equal((await notifyConfirmedOrder(123)).reason,'seller_sending_disabled');
    status=401;
    assert.equal((await notifyConfirmedOrder(123)).status,401);
    networkFailure=true;
    assert.equal((await notifyConfirmedOrder(123)).uncertainOutcome,true);
    // One call per attempted notification; never retries a failed/ambiguous request.
    assert.equal(calls.length,5);
    networkFailure=false;
    status=200;
    const beforeBackground=calls.length;
    const pending=[];
    const scheduled=await scheduleConfirmedOrder({
      waitUntil(promise) { pending.push(promise); }
    },123,'cloudflare_background');
    assert.equal(scheduled.scheduled,true);
    assert.equal(pending.length,1);
    await Promise.all(pending);
    assert.equal(calls.length,beforeBackground+1);
    const backgroundCall=calls.at(-1);
    assert.deepEqual(JSON.parse(backgroundCall.options.body),{
      orderId:123,confirmSend:true
    });

    delete process.env.FF_ORDER_EMAIL_HOOK_ENABLED;
    const offCount=calls.length;
    const off=await scheduleConfirmedOrder({waitUntil(){throw Error('MUST_NOT_REGISTER')}},123);
    assert.equal(off.reason,'customer_hook_disabled');
    assert.equal(calls.length,offCount);
    console.log('Zoho order-confirmation hook and Cloudflare waitUntil mock tests: PASS (no network requests).');
  } finally {
    if(backup.enabled===undefined)delete process.env.FF_ORDER_EMAIL_HOOK_ENABLED;
    else process.env.FF_ORDER_EMAIL_HOOK_ENABLED=backup.enabled;
    if(backup.token===undefined)delete process.env.ZOHO_ORDER_EVENT_TOKEN;
    else process.env.ZOHO_ORDER_EVENT_TOKEN=backup.token;
    global.fetch=backup.fetch;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});

// Run: node --experimental-default-type=module --test seller-panel/tests/zoho-order-recovery.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { onRequestPost, onRequestGet } from '../functions/api/outreach/zoho-order-recovery.js';

globalThis.crypto ||= webcrypto;
const TOKEN='recovery-test-token-'.padEnd(56,'x');
const EVENT='event-service-test-token-'.padEnd(56,'y');
const armed={
  ZOHO_ORDER_RECOVERY_TOKEN:TOKEN,
  ZOHO_ORDER_EVENT_TOKEN:EVENT,
  ZOHO_ORDER_CONFIRMATION_MODE:'production',
  ZOHO_ORDER_GLOBAL_LAUNCH_APPROVED:'true',
  ZOHO_ORDER_GLOBAL_LAUNCH_ACK:'verified_customers_only_v1',
  ZOHO_ORDER_AUTOMATION_ENABLED:'true',
  ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED:'true',
  ZOHO_ORDER_AUTOMATION_NOT_BEFORE:'2026-10-14T00:00:00Z',
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'fake-supabase-service-key'
};
function makeRequest(body,token=TOKEN){
  return new Request('https://seller.fashionfussion.in/api/outreach/zoho-order-recovery',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
}
function stubResponse(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
}
test('rejects GET and non-recovery credentials',async()=>{
  assert.equal((await onRequestGet()).status,405);
  const result=await onRequestPost({request:makeRequest({dryRun:true},'not-the-token'),env:armed});
  assert.equal(result.status,401);
});
test('rejects accidental requests and fails closed on production gates',async()=>{
  assert.equal((await onRequestPost({request:makeRequest({orderId:25,recover:true}),env:armed})).status,400);
  const locked={...armed,ZOHO_ORDER_GLOBAL_LAUNCH_APPROVED:'false'};
  assert.equal((await onRequestPost({request:makeRequest({recover:true}),env:locked})).status,423);
});
test('checks empty backlog and quotas without calling Zoho',async(t)=>{
  const previous=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async url=>{
    requests++;
    const target=String(url);
    if(target.includes('/rpc/zoho_order_delivery_telemetry'))
      return stubResponse({attemptsLastHour:1,attemptsLast24h:3,
        hourlyAttemptCap:30,rolling24hAttemptCap:150});
    if(target.includes('/zoho_order_email_outbox?'))return stubResponse([]);
    throw Error('Unexpected third-party or dispatch request');
  };
  t.after(()=>{globalThis.fetch=previous});
  const r=await onRequestPost({request:makeRequest({recover:true}),env:armed});
  const data=await r.json();
  assert.equal(r.status,200);
  assert.equal(data.sentAccepted,0);
  assert.equal(requests,2);
});
test('refuses exhausted quota and does not scan the queue',async(t)=>{
  const previous=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async()=>{requests++;return stubResponse({attemptsLastHour:30,
    attemptsLast24h:150,hourlyAttemptCap:30,rolling24hAttemptCap:150});};
  t.after(()=>{globalThis.fetch=previous});
  const r=await onRequestPost({request:makeRequest({recover:true}),env:armed});
  assert.equal(r.status,429);
  assert.equal(requests,1);
});
test('dry run filters already attempted rows and never requests dispatch',async(t)=>{
  const previous=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async (url)=>{
    requests++;
    const target=String(url);
    if(target.includes('/rpc/zoho_order_delivery_telemetry'))
      return stubResponse({attemptsLastHour:0,attemptsLast24h:0,
        hourlyAttemptCap:30,rolling24hAttemptCap:150});
    if(target.includes('/zoho_order_email_outbox?'))
      return stubResponse([{order_id:25,status:'sent',attempt_count:1},
        {order_id:26,status:'pending_review',attempt_count:0}]);
    if(target.includes('/rpc/preview_zoho_order_confirmation_eligibility'))
      return stubResponse({eligible:true});
    throw Error('Recovery dry run tried to dispatch');
  };
  t.after(()=>{globalThis.fetch=previous});
  const r=await onRequestPost({request:makeRequest({dryRun:true}),env:armed});
  const data=await r.json();
  assert.equal(r.status,200);
  assert.equal(data.sentAccepted,0);
  assert.equal(data.skipped,1);
  assert.equal(data.eligibleUnattempted,1);
  assert.equal(requests,3);
});

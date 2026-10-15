import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestPost,onRequestGet} from '../functions/api/outreach/whatsapp-order-confirmation-dispatch.js';
globalThis.crypto ||= webcrypto;
const operator='operator-access-key-only';
const internal='internal-whatsapp-event-token-'.padEnd(54,'y');
const env={
 OUTREACH_API_TOKEN:operator,
 WHATSAPP_ORDER_INTERNAL_TOKEN:internal,
 SUPABASE_URL:'https://example.supabase.co',
 SUPABASE_SERVICE_ROLE_KEY:'test-private-db-key',
 WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED:'false',
 WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'false',
 WHATSAPP_ORDER_GLOBAL_LAUNCH_ACK:'verified_opt_in_orders_v1',
 WHATSAPP_ORDER_CONFIRMATION_NOT_BEFORE:'2026-10-15T00:00:00Z',
 WHATSAPP_PHONE_NUMBER_ID:'123456789012345',
 WHATSAPP_GRAPH_VERSION:'v26.0',
 WHATSAPP_ACCESS_TOKEN:'unit-test-fake-meta-token',
 WHATSAPP_ALLOWED_TEMPLATES:'seller_invitation,order_status_update'
};
const req=(body,token)=>new Request('https://seller.fashionfussion.in/api/outreach/whatsapp-order-confirmation-dispatch',
 {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
 body:JSON.stringify(body)});
const ok=(body)=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
test('GET forbidden and operator cannot dispatch real WhatsApp',async()=>{
 assert.equal((await onRequestGet()).status,405);
 assert.equal((await onRequestPost({request:req({dispatch:true},operator),env})).status,401);
 assert.equal((await onRequestPost({request:req({dispatch:true},internal),env})).status,423);
});
test('rejects requests with unintended fields and secrets',async()=>{
 assert.equal((await onRequestPost({request:req({dispatch:true,orderId:25},internal),env})).status,400);
 assert.equal((await onRequestPost({request:req({dryRun:true},'bad-token'),env})).status,401);
});
test('dry run scans bounded zero-attempt queue but sends nothing',async t=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{
  calls++;
  assert.ok(String(url).includes('supabase.co'));
  assert.ok(String(url).includes('attempt_count=eq.0'));
  assert.ok(String(url).includes('attempt_started_at=is.null'));
  assert.equal(new URL(url).searchParams.getAll('created_at').length,2);
  return ok([]);
 };t.after(()=>{globalThis.fetch=old});
 const response=await onRequestPost({request:req({dryRun:true},operator),env});
 const data=await response.json();
 assert.equal(response.status,200);
 assert.equal(data.dryRun,true);
 assert.equal(data.armed,false);
 assert.equal(data.sent,0);
 assert.equal(data.candidates,0);
 assert.equal(calls,1);
});
test('armed queue with no candidates never submits Meta',async t=>{
 const old=globalThis.fetch;const e={...env,
  WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED:'true',
  WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'true'};
 let calls=0;
 globalThis.fetch=async(url)=>{calls++;assert.match(String(url),/supabase.co/);return ok([])};
 t.after(()=>{globalThis.fetch=old});
 const result=await onRequestPost({request:req({dispatch:true},internal),env:e});
 const data=await result.json();
 assert.equal(result.status,200);
 assert.equal(data.providerAccepted,0);
 assert.equal(data.claimed,0);
 assert.equal(calls,1);
});
test('verified single candidate submits Meta only after atomic claim+consent',async t=>{
 const old=globalThis.fetch;const e={...env,
  WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED:'true',
  WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'true'};
 let submits=0,claimCalls=0,finishCalls=0;
 globalThis.fetch=async(url,opts={})=>{
  const u=String(url);
  if(u.includes('whatsapp_order_notification_outbox?'))return ok([{order_id:33,created_at:'2026-10-15T08:00:00Z'}]);
  if(u.includes('/rpc/claim_whatsapp_order_confirmation')){
   claimCalls++;
   const body=JSON.parse(opts.body);
   assert.equal(body.p_order_id,33);
   assert.equal(body.p_activation_cutoff,'2026-10-15T00:00:00Z');
   return ok({outboxId:98,recipientPhone:'+919876543210',customerName:'Test Customer',displayOrderId:'OD33'});
  }
  if(u.includes('/whatsapp_order_consents?'))return ok([{order_id:33}]);
  if(u.includes('/whatsapp_contact_consents?'))return ok([{phone_e164:'+919876543210'}]);
  if(u.includes('/rpc/finish_whatsapp_order_confirmation')){
   finishCalls++;
   const body=JSON.parse(opts.body);
   assert.equal(body.p_outbox_id,98);assert.equal(body.p_provider_message_id,'wamid.test-ok');
   return ok(true);
  }
  if(u.startsWith('https://graph.facebook.com/')){
   submits++;const payload=JSON.parse(opts.body);
   assert.equal(payload.template.name,'order_status_update');
   assert.equal(payload.template.components[0].parameters[2].text,'Confirmed');
   return ok({messages:[{id:'wamid.test-ok'}]});
  }
  throw Error('unexpected network');
 };t.after(()=>{globalThis.fetch=old});
 const r=await onRequestPost({request:req({dispatch:true},internal),env:e});
 const data=await r.json();
 assert.equal(r.status,200);
 assert.equal(data.providerAccepted,1);
 assert.equal(submits,1);
 assert.equal(claimCalls,1);
 assert.equal(finishCalls,1);
});
test('revoked consent blocks Meta even after claim; no retry',async t=>{
 const old=globalThis.fetch;const e={...env,
  WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED:'true',
  WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'true'};
 let submits=0,finalCode=null;
 globalThis.fetch=async(url,opts={})=>{
  const u=String(url);
  if(u.includes('whatsapp_order_notification_outbox?'))return ok([{order_id:33}]);
  if(u.includes('/rpc/claim_whatsapp_order_confirmation'))return ok({
   outboxId:98,recipientPhone:'+919876543210',customerName:'Test',displayOrderId:'OD33'});
  if(u.includes('/whatsapp_order_consents?'))return ok([]);
  if(u.includes('/whatsapp_contact_consents?'))return ok([{phone_e164:'+919876543210'}]);
  if(u.includes('/rpc/finish_whatsapp_order_confirmation')){
   finalCode=JSON.parse(opts.body).p_error_code;return ok(true);
  }
  if(u.startsWith('https://graph.facebook.com/')){submits++;return ok({messages:[]});}
  throw Error('unexpected');
 };t.after(()=>{globalThis.fetch=old});
 const result=await onRequestPost({request:req({dispatch:true},internal),env:e});
 assert.equal(result.status,200);
 assert.equal(submits,0);
 assert.equal(finalCode,'CONSENT_REVOKED');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {dispatchRoleAlert} from '../functions/_shared/whatsapp-role-alert-dispatch-core.js';
globalThis.crypto ||=webcrypto;
const operator='read-only-operator-token-'.padEnd(48,'o');
const sellerToken='seller-internal-token-'.padEnd(48,'s');
const adminToken='admin-internal-token-'.padEnd(48,'a');
const baseEnv={
 OUTREACH_API_TOKEN:operator,SUPABASE_URL:'https://fake.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-test-key',
 WHATSAPP_GRAPH_VERSION:'v26.0',WHATSAPP_BUSINESS_ACCOUNT_ID:'111222333444555',
 WHATSAPP_PHONE_NUMBER_ID:'123456789012345',WHATSAPP_ACCESS_TOKEN:'fake-meta-token-for-test',
 WHATSAPP_ALLOWED_TEMPLATES:'seller_order_received,fashion_fussion_admin_alert',
 WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'false',WHATSAPP_ORDER_GLOBAL_LAUNCH_ACK:'verified_opt_in_orders_v1',
 WHATSAPP_SELLER_ALERT_SENDING_ENABLED:'false',WHATSAPP_SELLER_ALERT_GLOBAL_LAUNCH_APPROVED:'false',
 WHATSAPP_SELLER_ALERT_GLOBAL_LAUNCH_ACK:'verified_seller_alerts_v1',WHATSAPP_SELLER_ALERT_NOT_BEFORE:'2026-10-15T00:00:00Z',
 WHATSAPP_SELLER_ALERT_INTERNAL_TOKEN:sellerToken,
 WHATSAPP_ADMIN_ALERT_SENDING_ENABLED:'false',WHATSAPP_ADMIN_ALERT_GLOBAL_LAUNCH_APPROVED:'false',
 WHATSAPP_ADMIN_ALERT_GLOBAL_LAUNCH_ACK:'verified_admin_alerts_v1',WHATSAPP_ADMIN_ALERT_NOT_BEFORE:'2026-10-15T00:00:00Z',
 WHATSAPP_ADMIN_ALERT_INTERNAL_TOKEN:adminToken
};
const req=(body,token)=>new Request('https://seller.fashionfussion.in/api/outreach/whatsapp-role-alert-dispatch',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
const ok=body=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
test('operator cannot send; separate role token and launch gates are required',async()=>{
 assert.equal((await dispatchRoleAlert(req({dispatch:true},operator),baseEnv,'seller')).status,401);
 assert.equal((await dispatchRoleAlert(req({dispatch:true},sellerToken),baseEnv,'seller')).status,423);
 assert.equal((await dispatchRoleAlert(req({dispatch:true},adminToken),baseEnv,'admin')).status,423);
});
test('dry run is bounded, private and never calls Meta',async t=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;assert.match(String(url),/fake\.supabase\.co/);return ok([])};
 t.after(()=>{globalThis.fetch=old});
 const r=await dispatchRoleAlert(req({dryRun:true},operator),baseEnv,'seller');
 const data=await r.json();
 assert.equal(r.status,200);assert.equal(data.dryRun,true);assert.equal(data.sent,0);assert.equal(data.candidates,0);assert.equal(calls,1);
});
test('unknown role is rejected',async()=>{
 assert.equal((await dispatchRoleAlert(req({dryRun:true},operator),baseEnv,'customer')).status,404);
});
test('armed dispatch refuses Meta preflight failure before claiming any outbox row',async t=>{
 const old=globalThis.fetch;let claims=0,meta=0;
 const env={...baseEnv,WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'true',
  WHATSAPP_SELLER_ALERT_SENDING_ENABLED:'true',WHATSAPP_SELLER_ALERT_GLOBAL_LAUNCH_APPROVED:'true'};
 globalThis.fetch=async(url,opts={})=>{
  const u=String(url);
  if(u.includes('whatsapp_seller_order_notification_outbox?'))return ok([{id:4,created_at:'2026-10-18T10:00:00Z'}]);
  if(u.includes('/rpc/claim_whatsapp_seller_order_alert')){claims++;return ok({outboxId:4});}
  if(u.startsWith('https://graph.facebook.com/')){meta++;return new Response('{}',{status:403});}
  throw Error('Unexpected network');
 };t.after(()=>{globalThis.fetch=old});
 const r=await dispatchRoleAlert(req({dispatch:true},sellerToken),env,'seller');
 assert.equal(r.status,423);assert.equal(claims,0);assert.equal(meta,2);
});

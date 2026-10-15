import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestPost} from '../functions/api/outreach/order-preview.js';

globalThis.crypto ||= webcrypto;
const token='test-operator-only';
const env={
  OUTREACH_API_TOKEN:token, SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'local-test-db-key',
  WHATSAPP_ALLOWED_TEMPLATES:'order_status_update'
};
const phone='+919876543210';
const user='11111111-1111-4111-8111-111111111111';
const order={
  id:77,user_id:user,created_at:new Date().toISOString(),
  display_order_id:'FF-TEST-77',customer_name:'Test Buyer',customer_phone:phone,
  status:'cod_pending',payment_method:'cod',payment_verified_at:null,
  fulfillment_status:'ordered',fulfillment_updated_at:null
};
const contact={
  status:'opted_in',consented_at:'2026-10-14T12:00:00.000Z',revoked_at:null
};
const orderConsent={phone_e164:phone,consented_at:'2026-10-14T12:00:00.000Z',revoked_at:null};
function request(eventType='order_confirmed',authorization=token){
  return new Request('https://seller.fashionfussion.in/api/outreach/order-preview',{
    method:'POST',headers:{Authorization:'Bearer '+authorization,'Content-Type':'application/json'},
    body:JSON.stringify({dryRun:true,orderId:77,eventType})
  });
}
const ok=(rows)=>new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json'}});
function mockFetch(t, {item=order, globalConsent=contact, specificConsent=orderConsent, shipment=null}={}) {
  const original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (raw, options={})=>{
    const u=new URL(raw);
    calls.push({url:u.toString(),method:options.method||'GET'});
    assert.equal(u.hostname,'example.supabase.co','Must not contact Meta');
    assert.equal(options.method||'GET','GET','Preview must not write records');
    if(u.pathname.endsWith('/orders'))return ok(item?[item]:[]);
    if(u.pathname.endsWith('/order_shipments'))return ok(shipment?[shipment]:[]);
    if(u.pathname.endsWith('/whatsapp_contact_consents'))return ok(globalConsent?[globalConsent]:[]);
    if(u.pathname.endsWith('/whatsapp_order_consents')){
      assert.equal(u.searchParams.get('order_id'),'eq.77');
      assert.equal(u.searchParams.get('user_id'),'eq.'+user);
      assert.equal(u.searchParams.get('phone_e164'),'eq.'+phone);
      return ok(specificConsent?[specificConsent]:[]);
    }
    throw Error('Unexpected endpoint '+u.pathname);
  };
  t.after(()=>{globalThis.fetch=original});
  return calls;
}
test('rejects unauthenticated preview before any database lookup',async t=>{
  const original=globalThis.fetch;let count=0;
  globalThis.fetch=async()=>{count++;throw Error('Must not run')};
  t.after(()=>{globalThis.fetch=original});
  const response=await onRequestPost({request:request('order_confirmed','wrong'),env});
  assert.equal(response.status,401);
  assert.equal(count,0);
});
test('recent COD confirmation needs matching specific and transactional opt-in',async t=>{
  const calls=mockFetch(t);
  const response=await onRequestPost({request:request(),env});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.dryRun,true);
  assert.equal(data.sent,0);
  assert.equal(data.eligible,true);
  assert.equal(data.orderSpecificConsentActive,true);
  assert.equal(data.transactionalConsentActive,true);
  assert.deepEqual(data.blockers,[]);
  assert.ok(calls.some(x=>x.url.includes('/whatsapp_order_consents?')));
  assert.ok(!JSON.stringify(data).includes('Test Buyer'),'Do not expose buyer name');
  assert.ok(!JSON.stringify(data).includes(phone),'Do not expose raw phone');
});
test('global transactional opt-in alone is NOT per-order consent',async t=>{
  mockFetch(t,{specificConsent:null});
  const data=await (await onRequestPost({request:request(),env})).json();
  assert.equal(data.eligible,false);
  assert.equal(data.orderSpecificConsentActive,false);
  assert.ok(data.blockers.includes('order_specific_whatsapp_opt_in_missing'));
});
test('revoked specific consent blocks order updates',async t=>{
  mockFetch(t,{specificConsent:{...orderConsent,revoked_at:new Date().toISOString()}});
  const data=await (await onRequestPost({request:request(),env})).json();
  assert.equal(data.eligible,false);
  assert.ok(data.blockers.includes('order_specific_whatsapp_opt_in_missing'));
});
test('cancelled and unpaid orders do not pass readiness',async t=>{
  mockFetch(t,{item:{...order,status:'cod_cancelled',fulfillment_status:'cancelled'}});
  const data=await (await onRequestPost({request:request(),env})).json();
  assert.equal(data.eligible,false);
  assert.ok(data.blockers.includes('order_not_active'));
  assert.ok(data.blockers.includes('order_not_payment_verified_or_cod_confirmed'));
});
test('prepaid needs provider-verified payment marker',async t=>{
  mockFetch(t,{item:{...order,payment_method:'prepaid',status:'paid',payment_verified_at:null}});
  const data=await (await onRequestPost({request:request(),env})).json();
  assert.equal(data.eligible,false);
  assert.ok(data.blockers.includes('order_not_payment_verified_or_cod_confirmed'));
});
test('historical confirmations older than 24 hours are not ready',async t=>{
  mockFetch(t,{item:{...order,created_at:'2026-10-01T00:00:00.000Z'}});
  const data=await (await onRequestPost({request:request(),env})).json();
  assert.equal(data.eligible,false);
  assert.ok(data.blockers.includes('order_confirmation_not_recent'));
});
test('shipment event prior to WhatsApp opt-in is NOT eligible',async t=>{
  mockFetch(t,{item:{...order,fulfillment_status:'shipped',
    fulfillment_updated_at:'2026-10-14T11:00:00.000Z'},
    shipment:{id:33,awb_code:'TEST-AWB',direction:'forward',status:'shipped'}
  });
  const data=await (await onRequestPost({request:request('shipped'),env})).json();
  assert.equal(data.eligible,false);
  assert.ok(data.blockers.includes('fulfillment_event_before_whatsapp_opt_in'));
});
test('missing DB data returns 503 without messaging anyone',async t=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response('unavailable',{status:503});
  t.after(()=>{globalThis.fetch=original});
  const response=await onRequestPost({request:request(),env});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'Order preview temporarily unavailable; no message sent');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestGet,onRequestPost} from '../functions/api/outreach/whatsapp-shipping-dispatch.js';

globalThis.crypto ||= webcrypto;
const internal='shipping-internal-token-'.padEnd(52,'s');
const operator='operator-token-for-synthetic-dry-run';
const env={
  OUTREACH_API_TOKEN:operator,
  WHATSAPP_SHIPPING_INTERNAL_TOKEN:internal,
  WHATSAPP_SHIPPING_SENDING_ENABLED:'false',
  WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'false',
  WHATSAPP_SHIPPING_GLOBAL_LAUNCH_ACK:'verified_shipping_opt_in_v1',
  WHATSAPP_SHIPPING_NOT_BEFORE:'2026-10-15T00:00:00Z',
  SUPABASE_URL:'https://synthetic.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'synthetic-db-key',
  WHATSAPP_GRAPH_VERSION:'v26.0',WHATSAPP_BUSINESS_ACCOUNT_ID:'123456789012345',
  WHATSAPP_PHONE_NUMBER_ID:'987654321098765',
  WHATSAPP_ACCESS_TOKEN:'synthetic-test-meta-token',
  WHATSAPP_ALLOWED_TEMPLATES:'order_status_update'
};
const armed={...env,WHATSAPP_SHIPPING_SENDING_ENABLED:'true',
  WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'true'};
const request=(body,token=internal)=>new Request(
  'https://seller.fashionfussion.in/api/outreach/whatsapp-shipping-dispatch',
  {method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
   body:JSON.stringify(body)});
const ok=value=>new Response(JSON.stringify(value),{status:200,
  headers:{'content-type':'application/json'}});
const template={
  name:'order_status_update',language:'en',status:'APPROVED',category:'UTILITY',
  components:[{type:'HEADER',format:'TEXT',text:'Fashion Fussion'},
    {type:'BODY',text:'Hi {{1}}, your Fashion Fussion order {{2}} status has been updated to {{3}}. Please check your account for the latest order details.'},
    {type:'FOOTER',text:'Fashion Fussion'}]
};
const labelFor={shipped:'Shipped',out_for_delivery:'Out for Delivery',delivered:'Delivered'};
function mockedNetwork(t,{
  event='shipped',templateEntry=template,phoneMatches=true,
  orderConsent=true,globalConsent=true,metaGetError=false,queue=true
}={}) {
  const old=globalThis.fetch;const calls=[];
  globalThis.fetch=async (url,options={})=>{
    const u=new URL(url);const method=options.method||'GET';
    calls.push({path:u.pathname,method,body:options.body?JSON.parse(options.body):null});
    if(u.hostname==='synthetic.supabase.co'){
      if(u.pathname.endsWith('/whatsapp_order_notification_outbox'))
        return ok(queue?[{order_id:155,event_type:event,created_at:'2026-10-15T08:00:00Z'}]:[]);
      if(u.pathname.endsWith('/rpc/claim_whatsapp_shipping_event')){
        const body=JSON.parse(options.body);
        assert.equal(body.p_order_id,155);
        assert.equal(body.p_event_type,event);
        assert.equal(body.p_activation_cutoff,'2026-10-15T00:00:00Z');
        return ok({outboxId:100,recipientPhone:'+919876543210',
          customerName:'Synthetic Buyer',displayOrderId:'FF-SYNTHETIC',
          statusLabel:labelFor[event]});
      }
      if(u.pathname.endsWith('/whatsapp_order_consents'))return ok(
        orderConsent?[{order_id:155}]:[]);
      if(u.pathname.endsWith('/whatsapp_contact_consents'))return ok(
        globalConsent?[{phone_e164:'+919876543210'}]:[]);
      if(u.pathname.endsWith('/rpc/finish_whatsapp_order_confirmation')){
        const b=JSON.parse(options.body);
        assert.equal(b.p_outbox_id,100);
        return ok(true);
      }
    }
    if(u.hostname==='graph.facebook.com'){
      if(method==='GET'){
        if(metaGetError)return new Response(JSON.stringify({error:'Synthetic forbidden'}),{status:403});
        if(u.pathname.endsWith('/message_templates'))return ok({data:[templateEntry]});
        if(u.pathname.endsWith('/phone_numbers'))
          return ok({data:[{id:phoneMatches?env.WHATSAPP_PHONE_NUMBER_ID:'999999999999999'}]});
      }
      if(method==='POST'&&u.pathname.endsWith('/messages')){
        const b=JSON.parse(options.body);
        assert.equal(b.type,'template');
        assert.equal(b.template.name,'order_status_update');
        assert.equal(b.template.language.code,'en');
        assert.deepEqual(b.template.components[0].parameters.map(x=>x.text),
          ['Synthetic Buyer','FF-SYNTHETIC',labelFor[event]]);
        assert.equal(options.redirect,'error');
        return ok({messages:[{id:'wamid.synthetic-shipment'}]});
      }
    }
    throw Error('Unexpected network: '+u.hostname+u.pathname);
  };
  t.after(()=>{globalThis.fetch=old});
  return calls;
}
test('private shipping endpoint forbids GET, wrong body and operator-initiated sending',async()=>{
  assert.equal(onRequestGet().status,405);
  assert.equal((await onRequestPost({request:request({dispatch:true},operator),env:armed})).status,401);
  assert.equal((await onRequestPost({request:request({dispatch:true,orderId:25}),env:armed})).status,400);
});
test('shipping global flags default OFF, even for internal sender',async t=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('No requests allowed');};
  t.after(()=>{globalThis.fetch=old});
  const r=await onRequestPost({request:request({dispatch:true}),env});
  assert.equal(r.status,423);
  assert.equal(calls,0);
});
test('dry-run reads bounded zero-attempt queue without Meta or claims',async t=>{
  const calls=mockedNetwork(t,{queue:true});
  const r=await onRequestPost({request:request({dryRun:true},operator),env});
  const d=await r.json();
  assert.equal(r.status,200);
  assert.equal(d.sent,0);
  assert.equal(d.dryRun,true);
  assert.equal(d.candidates,1);
  assert.equal(calls.length,1);
  assert.ok(calls[0].path.endsWith('/whatsapp_order_notification_outbox'));
  assert.equal(calls[0].method,'GET');
});
for(const event of ['shipped','out_for_delivery','delivered']){
  test('approved '+event+' sends correct three-body-variable template after atomic claim',async t=>{
    const calls=mockedNetwork(t,{event});
    const r=await onRequestPost({request:request({dispatch:true}),env:armed});
    const d=await r.json();
    assert.equal(r.status,200);
    assert.equal(d.providerAccepted,1);
    assert.equal(d.claimed,1);
    assert.equal(d.autoRetry,false);
    assert.equal(calls.filter(x=>x.path.endsWith('/messages')&&x.method==='POST').length,1);
    const claimIndex=calls.findIndex(x=>x.path.endsWith('/claim_whatsapp_shipping_event'));
    const metaPostIndex=calls.findIndex(x=>x.path.endsWith('/messages')&&x.method==='POST');
    assert.ok(claimIndex>calls.findIndex(x=>x.path.endsWith('/message_templates')));
    assert.ok(metaPostIndex>claimIndex,'Meta send only after atomic claim');
    assert.ok(!JSON.stringify(d).includes('919876543210'));
    assert.ok(!JSON.stringify(d).includes('Synthetic Buyer'));
  });
}
test('Meta WABA mismatch aborts before atomic claim',async t=>{
  const calls=mockedNetwork(t,{phoneMatches:false});
  const r=await onRequestPost({request:request({dispatch:true}),env:armed});
  assert.equal(r.status,423);
  assert.equal((await r.json()).claimed,0);
  assert.equal(calls.filter(x=>x.path.endsWith('/claim_whatsapp_shipping_event')).length,0);
  assert.equal(calls.filter(x=>x.path.endsWith('/messages')&&x.method==='POST').length,0);
});
test('Meta API read failure blocks all claims and sends',async t=>{
  const calls=mockedNetwork(t,{metaGetError:true});
  const r=await onRequestPost({request:request({dispatch:true}),env:armed});
  assert.equal(r.status,423);
  assert.equal(calls.filter(x=>x.path.endsWith('/claim_whatsapp_shipping_event')).length,0);
  assert.equal(calls.filter(x=>x.path.endsWith('/messages')&&x.method==='POST').length,0);
});
test('revoked per-order consent prevents Meta send AFTER first claim, never retries',async t=>{
  const calls=mockedNetwork(t,{orderConsent:false});
  const r=await onRequestPost({request:request({dispatch:true}),env:armed});
  const d=await r.json();
  assert.equal(r.status,200);
  assert.equal(d.providerAccepted,0);
  assert.equal(d.claimed,1);
  assert.ok(d.reviewRequired>0);
  assert.equal(calls.filter(x=>x.path.endsWith('/messages')&&x.method==='POST').length,0);
  const finish=calls.find(x=>x.path.endsWith('/finish_whatsapp_order_confirmation'));
  assert.equal(finish.body.p_error_code,'CONSENT_REVOKED');
});
test('empty queue makes zero Meta GETs or POSTs',async t=>{
  const calls=mockedNetwork(t,{queue:false});
  const r=await onRequestPost({request:request({dispatch:true}),env:armed});
  assert.equal(r.status,200);
  assert.equal((await r.json()).claimed,0);
  assert.equal(calls.length,1);
});

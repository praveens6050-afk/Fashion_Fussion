import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestGet,onRequestPost} from '../functions/api/outreach/whatsapp-roles-readiness.js';

globalThis.crypto ||=webcrypto;
const env={
  OUTREACH_API_TOKEN:'synthetic-private-operator',
  SUPABASE_URL:'https://fake.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-only',
  WHATSAPP_ALLOWED_TEMPLATES:'order_status_update,seller_onboarding',
  WHATSAPP_SELLER_ONBOARDING_TEMPLATE:'seller_onboarding'
};
const request=(token=env.OUTREACH_API_TOKEN)=>new Request('https://seller.fashionfussion.in/api/outreach/whatsapp-roles-readiness',{headers:{authorization:'Bearer '+token}});
function fixture(t, counts=[2,0,1,29,0], schema={schemaVerified:true,missingColumns:[],claimFunctionPresent:true,finishFunctionPresent:true,sellerMappingSchemaVerified:true,sellerMappingMissingColumns:[],sellerRecipientSchemaVerified:true,sellerRecipientMissingColumns:[],sellerAlertStorageVerified:true,sellerAlertStorageMissingColumns:[],adminIdentitySchemaVerified:true,adminIdentityMissingColumns:[],adminAlertStorageVerified:true,adminAlertStorageMissingColumns:[]}) {
  const previous=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
    const u=new URL(url);calls.push(u.toString());
    assert.equal(u.hostname,'fake.supabase.co');
    assert.equal(opts.headers.Authorization,'Bearer synthetic-service-only');
    if (u.pathname.endsWith('/rpc/whatsapp_notification_schema_readiness')) {
      assert.equal(opts.method,'POST');
      assert.equal(opts.body,'{}');
      return new Response(JSON.stringify(schema),{status:200,headers:{'Content-Type':'application/json'}});
    }
    assert.equal(opts.method,'HEAD');
    assert.equal(opts.headers.Prefer,'count=exact');
    const table=u.pathname.split('/').at(-1);
    const map={whatsapp_contact_consents:0,whatsapp_order_consents:2,
      whatsapp_inbound_events:3,whatsapp_order_notification_outbox:4};
    const index=table==='whatsapp_contact_consents'?
      (u.searchParams.get('purpose')==='eq.marketing'?1:0):map[table];
    return new Response(null,{status:200,headers:{'Content-Range':'*/'+counts[index]}});
  };
  t.after(()=>{globalThis.fetch=previous});
  return calls;
}
test('unauthorized caller makes zero database requests',async t=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('No network expected');};
  t.after(()=>{globalThis.fetch=old});
  const r=await onRequestGet({request:request('invalid'),env});
  assert.equal(r.status,401);
  assert.equal(calls,0);
});
test('read-only role inventory distinguishes seller opt-in and admin launch blockers',async t=>{
  const calls=fixture(t,[3,0,1,29,0]);
  const r=await onRequestGet({request:request(),env});
  const data=await r.json();
  assert.equal(r.status,200);
  assert.equal(data.readOnly,true);
  assert.equal(data.messagesSent,0);
  assert.equal(data.roles.customer.transactionalOptIns,3);
  assert.equal(data.roles.customer.schemaVerified,true);
  assert.equal(data.roles.customer.atomicDispatchSchemaVerified,true);
  assert.equal(data.roles.customer.status,'SCHEMA_VERIFIED_META_PREFLIGHT_REQUIRED');
  assert.equal(data.roles.seller.marketingOptIns,0);
  assert.equal(data.roles.seller.status,'MARKETING_OPT_IN_REQUIRED');
  assert.equal(data.roles.seller.sellerMappingSchemaVerified,true);
  assert.equal(data.roles.seller.sellerRecipientSchemaVerified,true);
  assert.equal(data.roles.seller.alertStorageSchemaVerified,true);
  assert.equal(data.roles.admin.adminIdentitySchemaVerified,true);
  assert.equal(data.roles.admin.alertStorageSchemaVerified,true);
  assert.equal(data.roles.seller.requestedTemplateAllowlisted,true);
  assert.equal(data.roles.admin.dedicatedDispatcherVerified,false);
  assert.equal(data.roles.admin.verifiedAdminRecipients,false);
  assert.equal(data.inboundNeedsManualReview,29);
  assert.equal(data.inboundSupportQueues.customerSupport,29);
  assert.equal(data.inboundSupportQueues.sellerSupport,29);
  assert.equal(data.inboundSupportQueues.salesMarketing,29);
  assert.equal(data.inboundSupportQueues.adminOperations,29);
  assert.equal(calls.length,10);
  assert.ok(!JSON.stringify(data).includes('synthetic-service-only'));
  assert.ok(!JSON.stringify(data).includes('synthetic-private-operator'));
});
test('schema probe fails closed when migration or RPCs are missing',async t=>{
  fixture(t,[3,0,1,2,0],{schemaVerified:false,missingColumns:['orders.fulfillment_status'],claimFunctionPresent:true,finishFunctionPresent:false});
  const data=await (await onRequestGet({request:request(),env})).json();
  assert.equal(data.roles.customer.atomicDispatchSchemaVerified,false);
  assert.equal(data.roles.customer.schemaVerified,false);
  assert.deepEqual(data.roles.customer.missingColumns,['orders.fulfillment_status']);
  assert.equal(data.roles.customer.finishFunctionPresent,false);
  assert.equal(data.roles.customer.status,'SCHEMA_NOT_VERIFIED');
});
test('seller and admin schema gaps are reported independently from customer readiness',async t=>{
  fixture(t,[3,2,1,2,0],{schemaVerified:true,missingColumns:[],claimFunctionPresent:true,finishFunctionPresent:true,sellerMappingSchemaVerified:false,sellerMappingMissingColumns:['seller_product_submissions.approved_product_id'],sellerRecipientSchemaVerified:true,sellerRecipientMissingColumns:[],sellerAlertStorageVerified:false,sellerAlertStorageMissingColumns:['whatsapp_seller_order_notification_outbox.seller_id'],adminIdentitySchemaVerified:false,adminIdentityMissingColumns:['profiles.phone_verified_at'],adminAlertStorageVerified:false,adminAlertStorageMissingColumns:['whatsapp_admin_alert_outbox.event_key']});
  const data=await (await onRequestGet({request:request(),env})).json();
  assert.equal(data.roles.customer.schemaVerified,true);
  assert.equal(data.roles.seller.status,'SELLER_SCHEMA_NOT_VERIFIED');
  assert.deepEqual(data.roles.seller.sellerMappingMissingColumns,['seller_product_submissions.approved_product_id']);
  assert.equal(data.roles.seller.alertStorageSchemaVerified,false);
  assert.deepEqual(data.roles.seller.alertStorageMissingColumns,['whatsapp_seller_order_notification_outbox.seller_id']);
  assert.equal(data.roles.admin.status,'ADMIN_IDENTITY_SCHEMA_NOT_VERIFIED');
  assert.equal(data.roles.admin.alertStorageSchemaVerified,false);
  assert.deepEqual(data.roles.admin.alertStorageMissingColumns,['whatsapp_admin_alert_outbox.event_key']);
});
test('missing readiness RPC fails closed without claiming schema is verified',async t=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{
    if(String(url).includes('/rpc/whatsapp_notification_schema_readiness'))return new Response('{}',{status:404});
    const table=new URL(url).pathname.split('/').at(-1);
    return new Response(null,{status:200,headers:{'Content-Range':'*/0'}});
  };
  t.after(()=>{globalThis.fetch=old});
  const data=await (await onRequestGet({request:request(),env})).json();
  assert.equal(data.roles.customer.atomicDispatchSchemaVerified,false);
  assert.equal(data.roles.customer.schemaVerified,false);
  assert.equal(data.roles.customer.status,'SCHEMA_NOT_VERIFIED');
});
test('marketing opt-in count cannot automatically authorize seller messages',async t=>{
  fixture(t,[3,9,4,1,0]);
  const data=await (await onRequestGet({request:request(),env})).json();
  assert.equal(data.roles.seller.marketingOptIns,9);
  assert.equal(data.roles.seller.metaTemplateVerified,false);
  assert.equal(data.roles.seller.automaticSendingConfigured,false);
  assert.equal(data.roles.seller.status,'TEMPLATE_AND_CONTROLLED_OUTREACH_REVIEW_REQUIRED');
});
test('database count errors fail closed',async t=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(null,{status:403});
  t.after(()=>{globalThis.fetch=old});
  const r=await onRequestGet({request:request(),env});
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,'WhatsApp role readiness unavailable; no messages sent');
});
test('invalid database origin fails closed before requests',async t=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('Must not fetch')};
  t.after(()=>{globalThis.fetch=old});
  const r=await onRequestGet({request:request(),env:{...env,SUPABASE_URL:'https://example.com'}});
  assert.equal(r.status,503);
  assert.equal(calls,0);
});
test('POST is never allowed',async()=>{
  assert.equal(onRequestPost().status,405);
});

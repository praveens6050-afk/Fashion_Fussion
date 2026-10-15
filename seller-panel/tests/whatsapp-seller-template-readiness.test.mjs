import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestGet,onRequestPost} from '../functions/api/outreach/whatsapp-seller-template-readiness.js';
globalThis.crypto ||=webcrypto;
const op='synthetic-operator-token';
const env={
 OUTREACH_API_TOKEN:op,
 WHATSAPP_GRAPH_VERSION:'v26.0',
 WHATSAPP_BUSINESS_ACCOUNT_ID:'111222333444555',
 WHATSAPP_PHONE_NUMBER_ID:'987654321098765',
 WHATSAPP_ACCESS_TOKEN:'synthetic-business-access-token',
 WHATSAPP_ALLOWED_TEMPLATES:'order_status_update,seller_onboarding',
 WHATSAPP_SELLER_ONBOARDING_TEMPLATE:'seller_onboarding'
};
const request=(token=op)=>new Request('https://seller.fashionfussion.in/api/outreach/whatsapp-seller-template-readiness',{headers:{authorization:'Bearer '+token}});
const template={name:'seller_onboarding',status:'APPROVED',category:'MARKETING',
 language:'en',components:[{type:'BODY',text:'Hi {{1}}, thanks for considering Fashion Fussion.'}]};
function mock(t,{body=template,phone=env.WHATSAPP_PHONE_NUMBER_ID,status=200}={}) {
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async (url,options)=>{
   const u=new URL(url);calls.push({url:String(url),method:options.method});
   assert.equal(u.hostname,'graph.facebook.com');
   assert.equal(options.method,'GET','Must not send marketing messages');
   assert.equal(options.redirect,'error');
   assert.equal(options.headers.Authorization,'Bearer synthetic-business-access-token');
   if(u.pathname.endsWith('/message_templates')){
     assert.equal(u.searchParams.get('name'),'seller_onboarding');
     return new Response(JSON.stringify({data:[body]}),{status});
   }
   if(u.pathname.endsWith('/phone_numbers'))
     return new Response(JSON.stringify({data:[{id:phone}]}),{status});
   throw Error('Unexpected Meta path');
 };
 t.after(()=>{globalThis.fetch=old});
 return calls;
}
test('operator authentication blocks all Meta fetches',async t=>{
 const old=globalThis.fetch;let count=0;
 globalThis.fetch=async()=>{count++;throw Error('Unexpected fetch')};
 t.after(()=>{globalThis.fetch=old});
 const r=await onRequestGet({request:request('invalid'),env});
 assert.equal(r.status,401);
 assert.equal(count,0);
});
test('template name must be explicitly configured and allowlisted',async t=>{
 const old=globalThis.fetch;let count=0;
 globalThis.fetch=async()=>{count++;throw Error('Unexpected fetch')};
 t.after(()=>{globalThis.fetch=old});
 const r=await onRequestGet({request:request(),env:{...env,WHATSAPP_SELLER_ONBOARDING_TEMPLATE:''}});
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.ready,false);
 assert.ok(data.missing.includes('WHATSAPP_SELLER_ONBOARDING_TEMPLATE'));
 assert.equal(count,0);
});
test('approved marketing template validates Meta config but NEVER authorizes sending',async t=>{
 const calls=mock(t);
 const r=await onRequestGet({request:request(),env});
 const data=await r.json();
 assert.equal(r.status,200);
 assert.equal(data.metaConfigurationValid,true);
 assert.equal(data.readyForSending,false);
 assert.equal(data.manualCopyReviewRequired,true);
 assert.equal(data.recipientMarketingConsentRequired,true);
 assert.equal(data.bodyParameterCount,1);
 assert.equal(data.messagesSent,0);
 assert.equal(calls.length,2);
 assert.ok(!JSON.stringify(data).includes(env.WHATSAPP_ACCESS_TOKEN));
 assert.ok(!JSON.stringify(data).includes(env.WHATSAPP_BUSINESS_ACCOUNT_ID));
 assert.ok(!JSON.stringify(data).includes(env.WHATSAPP_PHONE_NUMBER_ID));
});
test('paused marketing template cannot be treated as valid',async t=>{
 mock(t,{body:{...template,status:'PAUSED'}});
 const data=await (await onRequestGet({request:request(),env})).json();
 assert.equal(data.metaConfigurationValid,false);
 assert.equal(data.readyForSending,false);
});
test('utility-category template is not seller marketing template',async t=>{
 mock(t,{body:{...template,category:'UTILITY'}});
 const data=await (await onRequestGet({request:request(),env})).json();
 assert.equal(data.metaConfigurationValid,false);
});
test('incorrect business phone prevents marketing template configuration pass',async t=>{
 mock(t,{phone:'999999999999999'});
 const data=await (await onRequestGet({request:request(),env})).json();
 assert.equal(data.checks.phoneNumberInBusiness,false);
 assert.equal(data.metaConfigurationValid,false);
});
test('Meta API errors fail closed without token/provider response exposure',async t=>{
 mock(t,{status:403});
 const r=await onRequestGet({request:request(),env});
 assert.equal(r.status,503);
 const data=await r.json();
 assert.equal(data.readyForSending,false);
 assert.equal(data.error,'META_READ_UNAVAILABLE');
});
test('POST is not allowed even with operator credentials',async()=>{
 assert.equal(onRequestPost().status,405);
});

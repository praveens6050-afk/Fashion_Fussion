import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestPost} from '../functions/api/webhooks/zoho-mail.js';
globalThis.crypto ||= webcrypto;
const secret='synthetic-zoho-webhook-secret-long-enough-123456';
const env={ZOHO_CRM_WEBHOOK_SECRET:secret,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role'};
const payload={externalMessageId:'zoho-message-123',from:'buyer@example.com',to:'customer.care@fashionfussion.in',subject:'Order query',text:'Please help with my order.',receivedAt:new Date().toISOString()};
function request(body,token=secret){return new Request('https://crm.fashionfussion.in/api/webhooks/zoho-mail',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})}
test('unauthenticated Zoho intake is rejected before database access',async t=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Must not call database')};t.after(()=>{globalThis.fetch=original});
 const r=await onRequestPost({request:request(payload,'wrong-secret'),env});assert.equal(r.status,401);assert.equal(calls,0);
});
test('valid Zoho event routes to the CRM email support queue without sending email',async t=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://example.supabase.co/rest/v1/rpc/ingest_crm_email_message');assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.p_external_message_id,payload.externalMessageId);assert.equal(body.p_sender_email,payload.from);assert.equal(body.p_recipient_email,payload.to);assert.equal(body.p_subject,payload.subject);assert.equal(body.p_message_text,payload.text);assert.ok(Number.isFinite(Date.parse(body.p_received_at)));assert.deepEqual(Object.keys(body).sort(),['p_external_message_id','p_message_text','p_received_at','p_recipient_email','p_sender_email','p_subject'].sort());return new Response(JSON.stringify({accepted:true,inserted:true,eventId:42,team:'customer_support',status:'needs_review'}),{status:200,headers:{'Content-Type':'application/json'}})};
 t.after(()=>{globalThis.fetch=original});
 const r=await onRequestPost({request:request(payload),env});assert.equal(r.status,200);const data=await r.json();assert.equal(data.ok,true);assert.equal(data.stored,true);assert.equal(data.data.team,'customer_support');assert.equal(calls,1);assert.ok(!String(data).includes('buyer@example.com'));
});
for (const [to,team] of [['customer.care@fashionfussion.in','customer_support'],['seller.support@fashionfussion.in','seller_support'],['sales.team@fashionfussion.in','sales_marketing']]) {
 test('routes '+to+' to '+team,async t=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://example.supabase.co/rest/v1/rpc/ingest_crm_email_message');return new Response(JSON.stringify({accepted:true,inserted:true,eventId:43,team,status:'needs_review'}),{status:200,headers:{'Content-Type':'application/json'}})};
  t.after(()=>{globalThis.fetch=original});
  const r=await onRequestPost({request:request({...payload,to}),env});assert.equal(r.status,200);const data=await r.json();assert.equal(data.ok,true);assert.equal(data.data.team,team);assert.equal(calls,1);
 });
}
test('orders mailbox is excluded from support CRM without database access',async t=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Orders mail must not enter support CRM')};t.after(()=>{globalThis.fetch=original});
 const r=await onRequestPost({request:request({...payload,to:'orders@fashionfussion.in'}),env});assert.equal(r.status,200);const data=await r.json();assert.equal(data.stored,false);assert.equal(data.route,'orders_mailbox_excluded');assert.equal(calls,0);
});
test('unknown mailbox and malformed input fail closed before database call',async t=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:403})};t.after(()=>{globalThis.fetch=original});
 const r=await onRequestPost({request:request({...payload,to:'other@example.com'}),env});assert.equal(r.status,403);assert.equal(calls,0);
 const invalid=await onRequestPost({request:request({...payload,from:'not-an-email'}),env});assert.equal(invalid.status,400);assert.equal(calls,0);
});

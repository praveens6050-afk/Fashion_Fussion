import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestGet} from '../functions/api/outreach/whatsapp-health.js';

globalThis.crypto ||= webcrypto;

const token='test-operator-bearer';
const env={
  OUTREACH_API_TOKEN:token, SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'fake-server-secret',
  WHATSAPP_ACCESS_TOKEN:'fake-meta-token', WHATSAPP_PHONE_NUMBER_ID:'123456789012345',
  WHATSAPP_GRAPH_VERSION:'v26.0', WHATSAPP_VERIFY_TOKEN:'fake-verify',
  WHATSAPP_APP_SECRET:'fake-signature-secret',
  WHATSAPP_ALLOWED_TEMPLATES:'order_status_update',
  WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED:'false',
  WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'false'
};
function request(auth) {
  return new Request('https://seller.fashionfussion.in/api/outreach/whatsapp-health',
    {headers:auth?{Authorization:'Bearer '+auth}:{}});
}
test('rejects missing and invalid operator token without hitting database',async t=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
  t.after(()=>{globalThis.fetch=old});
  assert.equal((await onRequestGet({request:request(null),env})).status,401);
  assert.equal((await onRequestGet({request:request('incorrect'),env})).status,401);
  assert.equal(calls,0);
});
test('read-only status requests exact HEAD counts and exposes no customer information',async t=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;
    assert.equal(new URL(url).hostname,'example.supabase.co');
    assert.equal(options.method,'HEAD');
    assert.equal(options.headers.Authorization,'Bearer fake-server-secret');
    assert.ok(!String(url).includes('graph.facebook.com'));
    if(String(url).includes('select=attempt_started_at')) {
      assert.ok(!options.headers.Prefer,'Schema probe must not trigger an RPC');
      return new Response(null,{status:400});
    }
    assert.equal(options.headers.Prefer,'count=exact');
    return new Response(null,{status:200,headers:{'Content-Range':'0-0/3'}});
  };
  t.after(()=>{globalThis.fetch=old});
  const response=await onRequestGet({request:request(token),env});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.readOnly,true);
  assert.equal(body.messagesSent,0);
  assert.equal(body.noDatabaseChanges,true);
  assert.equal(body.counts.incomingTotal,3);
  assert.equal(body.counts.orderStagedTotal,3);
  assert.equal(body.dispatchLaunchGatePresence.sendingFlagTrue,false);
  assert.equal(body.atomicDispatchSchema.outboxAttemptColumnPresent,false);
  assert.equal(body.atomicDispatchSchema.claimRpcVerified,false);
  assert.equal(body.atomicDispatchSchema.status,'MIGRATION_REQUIRED');
  assert.ok(calls>=15);
  assert.ok(!JSON.stringify(body).includes('fake-server-secret'));
  assert.ok(!JSON.stringify(body).includes('fake-meta-token'));
  assert.ok(!JSON.stringify(body).includes('123456789012345'));
});
test('missing database credentials fail closed without calling external services',async t=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
  t.after(()=>{globalThis.fetch=old});
  const response=await onRequestGet({request:request(token),env:{...env,SUPABASE_SERVICE_ROLE_KEY:''}});
  assert.equal(response.status,503);
  assert.equal(calls,0);
});
test('missing exact count header fails closed instead of reporting healthy zeroes',async t=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(null,{status:200});
  t.after(()=>{globalThis.fetch=old});
  const response=await onRequestGet({request:request(token),env});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'WhatsApp integration health unavailable; no messages sent');
});

test('healthy column schema is not mistaken for a verified claim RPC',async t=>{
  const old=globalThis.fetch;
  globalThis.fetch=async (url, options)=>{
    assert.equal(options.method,'HEAD');
    if(String(url).includes('select=attempt_started_at'))return new Response(null,{status:200});
    return new Response(null,{status:200,headers:{'Content-Range':'*/0'}});
  };
  t.after(()=>{globalThis.fetch=old});
  const r=await onRequestGet({request:request(token),env});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.atomicDispatchSchema.outboxAttemptColumnPresent,true);
  assert.equal(body.atomicDispatchSchema.claimRpcVerified,false);
  assert.equal(body.atomicDispatchSchema.status,'MANUAL_RPC_AND_SQL_REVIEW_REQUIRED');
});
test('schema probe service failure fails closed, not mistaken for missing migration',async t=>{
  const old=globalThis.fetch;
  globalThis.fetch=async (url)=>{
    if(String(url).includes('select=attempt_started_at'))return new Response(null,{status:503});
    return new Response(null,{status:200,headers:{'Content-Range':'*/0'}});
  };
  t.after(()=>{globalThis.fetch=old});
  const r=await onRequestGet({request:request(token),env});
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,'WhatsApp integration health unavailable; no messages sent');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker, {runTick} from './whatsapp-worker.mjs';
globalThis.crypto ||= webcrypto;
const preview={WHATSAPP_AUTOMATION_ENABLED:'true',WHATSAPP_AUTOMATION_MODE:'preview',OUTREACH_API_TOKEN:'synthetic-operator'};
const active={...preview,WHATSAPP_AUTOMATION_MODE:'dispatch',WHATSAPP_AUTOMATION_LAUNCH_ACK:'approved_customer_scheduler_v1',WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED:'true',WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED:'true',WHATSAPP_SHIPPING_SENDING_ENABLED:'true',WHATSAPP_ORDER_INTERNAL_TOKEN:'o'.repeat(48),WHATSAPP_SHIPPING_INTERNAL_TOKEN:'s'.repeat(48)};
const ok=value=>new Response(JSON.stringify(value));
const dispatched={armed:true,dryRun:false,autoRetry:false,reviewRequired:0};
test('default disabled performs no handler calls',async()=>{
  assert.deepEqual(await runTick({},{}),{state:'disabled'});
});
test('public requests cannot invoke automation',async()=>{
  assert.equal((await worker.fetch(new Request('https://example.com'))).status,404);
});
test('invalid mode and unapproved dispatch make no calls',async()=>{
  await assert.rejects(runTick({...preview,WHATSAPP_AUTOMATION_MODE:'other'},{}),/MODE_INVALID/);
  await assert.rejects(runTick({...preview,WHATSAPP_AUTOMATION_MODE:'dispatch'},{}),/NOT_APPROVED/);
});
test('preview uses dryRun and operator auth for both lanes in sequence',async()=>{
  const seen=[];
  const handler=async({request})=>{seen.push([await request.json(),request.headers.get('authorization')]);return ok({dryRun:true,sent:0});};
  assert.equal((await runTick(preview,{confirmation:handler,shipping:handler})).state,'preview');
  assert.deepEqual(seen,[[{dryRun:true},'Bearer synthetic-operator'],[{dryRun:true},'Bearer synthetic-operator']]);
});
test('dispatch uses distinct internal credentials and exact body',async()=>{
  const seen=[];
  const handler=async({request})=>{seen.push([await request.json(),request.headers.get('authorization')]);return ok(dispatched);};
  await runTick(active,{confirmation:handler,shipping:handler});
  assert.deepEqual(seen,[[{dispatch:true},'Bearer '+active.WHATSAPP_ORDER_INTERNAL_TOKEN],[{dispatch:true},'Bearer '+active.WHATSAPP_SHIPPING_INTERNAL_TOKEN]]);
});
test('disabled lanes and short credentials cannot send',async()=>{
  assert.equal((await runTick({...active,WHATSAPP_SHIPPING_SENDING_ENABLED:'false',WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED:'false'},{})).shipping,'disabled');
  await assert.rejects(runTick({...active,WHATSAPP_ORDER_INTERNAL_TOKEN:'short'},{}),/CREDENTIAL_MISSING/);
});
test('failure stops remaining lanes without retries or sensitive error output',async()=>{
  let count=0;
  const handlers={confirmation:async()=>{count++;throw Error('private token');},shipping:async()=>{count++;}};
  await assert.rejects(runTick(active,handlers),{message:'AUTOMATION_HANDLER_FAILED'});
  assert.equal(count,1);
});
test('review required, malformed and unsuccessful responses stop subsequent dispatch',async()=>{
  for(const response of [ok({...dispatched,reviewRequired:1}),ok({}),new Response('{}',{status:503})]) {
    await assert.rejects(runTick(active,{confirmation:async()=>response,shipping:async()=>assert.fail('must stop')}));
  }
});
test('real handlers stay read-only in preview with sending flags set',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,init)=>{calls.push([String(url),init?.method]);return ok([]);};
  try {
    await runTick({...active,WHATSAPP_AUTOMATION_MODE:'preview',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-key'});
    assert.equal(calls.length,2);
    assert.ok(calls.every(([url,method])=>url.startsWith('https://synthetic.supabase.co/rest/v1/whatsapp_order_notification_outbox?')&&method==='GET'));
  } finally {globalThis.fetch=original;}
});

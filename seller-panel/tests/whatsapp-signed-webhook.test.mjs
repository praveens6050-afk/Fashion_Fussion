import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestGet,onRequestPost} from '../functions/api/webhooks/whatsapp.js';

globalThis.crypto ||= webcrypto;
const secret='synthetic-webhook-secret';
const env={
  WHATSAPP_VERIFY_TOKEN:'synthetic-verify-token',
  WHATSAPP_APP_SECRET:secret,
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'synthetic-db-key'
};
async function sign(body) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body));
  return 'sha256='+Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
async function request(body,signature='valid') {
  const raw=typeof body==='string'?body:JSON.stringify(body);
  return new Request('https://seller.fashionfussion.in/api/webhooks/whatsapp',{
    method:'POST',headers:{'Content-Type':'application/json',
      ...(signature==='missing'?{}:{'X-Hub-Signature-256':signature==='valid'?await sign(raw):signature})},
    body:raw
  });
}
function payload(value){return{object:'whatsapp_business_account',entry:[{changes:[{value}]}]}}
const metaNow=()=>Math.floor(Date.now()/1000);
const ok=(r)=>new Response(JSON.stringify(r),{status:200,headers:{'Content-Type':'application/json'}});
test('GET webhook challenge requires correct verification token',async()=>{
  const good=new Request('https://seller.fashionfussion.in/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=123456');
  const bad=new Request('https://seller.fashionfussion.in/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456');
  const yes=await onRequestGet({request:good,env});
  assert.equal(yes.status,200);
  assert.equal(await yes.text(),'123456');
  assert.equal((await onRequestGet({request:bad,env})).status,403);
});
test('unsigned, wrong-signature or missing-secret POST cannot reach database',async t=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('Must not reach database');};
  t.after(()=>{globalThis.fetch=original});
  const body=payload({statuses:[{id:'wamid.test',status:'delivered',timestamp:String(metaNow())}]});
  assert.equal((await onRequestPost({request:await request(body,'missing'),env})).status,401);
  assert.equal((await onRequestPost({request:await request(body,'sha256=bad'),env})).status,401);
  assert.equal((await onRequestPost({request:await request(body),env:{...env,WHATSAPP_APP_SECRET:''}})).status,503);
  assert.equal(calls,0);
});
test('signed delivery statuses are stored without customer data or Meta sends',async t=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),options});
    assert.match(String(url),/\.supabase\.co\/rest\/v1\/rpc\/record_whatsapp_delivery_status$/);
    assert.equal(options.method,'POST');
    const item=JSON.parse(options.body);
    assert.equal(item.p_provider_message_id,'wamid.test-delivery');
    assert.equal(item.p_meta_status,'delivered');
    assert.equal(item.p_error_code,null);
    assert.deepEqual(Object.keys(item).sort(),['p_error_code','p_event_at','p_meta_status','p_provider_message_id'].sort());
    return ok({recorded:true,duplicate:false,matched_order:false});
  };
  t.after(()=>{globalThis.fetch=original});
  const b=payload({statuses:[
    {id:'wamid.test-delivery',status:'delivered',timestamp:String(metaNow()),recipient_id:'919876543210'},
    {id:'other-provider-id',status:'read',timestamp:String(metaNow())},
    {id:'wamid.bad',status:'unrecognized',timestamp:String(metaNow())}
  ]});
  const r=await onRequestPost({request:await request(b),env});
  assert.equal(r.status,200);
  assert.equal(await r.text(),'EVENT_RECEIVED');
  assert.equal(calls.length,1);
  assert.ok(!calls[0].options.body.includes('919876543210'));
  assert.ok(!calls.some(c=>c.url.includes('graph.facebook.com')));
});
test('signed ordinary seller replies do not grant marketing opt-in; JOIN/STOP do',async t=>{
  const original=globalThis.fetch;let optIns=0,optOuts=0,inbound=0;
  globalThis.fetch=async(url,options)=>{
    const p=String(url),body=JSON.parse(options.body);
    assert.ok(p.startsWith('https://example.supabase.co/'));
    if(p.endsWith('/ingest_whatsapp_inbound_event')){
      inbound++;
      return ok({id:inbound,sender_role:'unclassified'});
    }
    if(p.endsWith('/record_whatsapp_consent_command')){
      assert.equal(body.p_phone_e164,'+919876543210');
      if(body.p_status==='opted_in') optIns++;
      else if(body.p_status==='opted_out')optOuts++;
      else throw Error('Unexpected consent change');
      return ok(true);
    }
    throw Error('Unexpected webhook outgoing call');
  };
  t.after(()=>{globalThis.fetch=original});
  for(const [i,textBody] of ['Hi','JOIN FASHION SELLER','STOP'].entries()){
    const item=payload({messages:[{id:'wamid.inbound-'+i,from:'919876543210',type:'text',
      text:{body:textBody},timestamp:String(metaNow())}]});
    assert.equal((await onRequestPost({request:await request(item),env})).status,200);
  }
  assert.equal(inbound,3);
  assert.equal(optIns,1);
  assert.equal(optOuts,1);
});
test('malformed JSON or oversized signed webhook never mutates outbox',async t=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('DB must not be hit');};
  t.after(()=>{globalThis.fetch=original});
  assert.equal((await onRequestPost({request:await request('not-json'),env})).status,400);
  const tooMany=payload({statuses:Array.from({length:201},(_,i)=>({
    id:'wamid.synthetic-'+i,status:'delivered',timestamp:String(metaNow())
  }))});
  assert.equal((await onRequestPost({request:await request(tooMany),env})).status,413);
  assert.equal(calls,0);
});

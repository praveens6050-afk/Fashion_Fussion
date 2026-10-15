import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {onRequest as otpHandler} from '../functions/api/whatsapp-otp.js';
import {onRequestPost as webhookHandler} from '../functions/api/webhooks/whatsapp.js';
globalThis.crypto ||= webcrypto;

const api='https://seller.fashionfussion.in/api/whatsapp-otp';
const supabase='https://example.supabase.co';
const serviceKey='test-only-supabase-service-key';
const challenge='11111111-2222-4333-8444-555555555555';
const userId='99999999-8888-4777-8666-555555555555';
const env={
 SUPABASE_URL:supabase,SUPABASE_SERVICE_ROLE_KEY:serviceKey,
 WHATSAPP_ACCESS_TOKEN:'fake-graph-access-token',
 WHATSAPP_PHONE_NUMBER_ID:'123456789012345', WHATSAPP_OTP_SECRET:'fake-otp-secret'
};
function json(x,status=200){return new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});}
test('signup verified customer finalization delegates only to atomic service-role RPC', async t=>{
 const old=globalThis.fetch,callNames=[];
 globalThis.fetch=async(url,opts={})=>{
  const u=String(url);callNames.push(u);
  if(u.includes('/auth/v1/user'))return json({
    id:userId,email:'test@example.com',
    user_metadata:{account_type:'customer',whatsapp_signup_challenge_id:challenge,
      whatsapp_order_updates_opt_in:true,whatsapp_order_updates_consent_version:'signup_order_updates_v1'}
  });
  if(u.includes('/rest/v1/rpc/finalize_whatsapp_signup_order_updates')){
   const body=JSON.parse(opts.body);
   assert.deepEqual(body,{p_user_id:userId,p_challenge_id:challenge,p_audience:'customer'});
   assert.ok(opts.headers.Authorization.includes(serviceKey));
   return json({ok:true,verified:true,phone_hint:'••••3210',transactional_consent_active:true});
  }
  throw Error('Unexpected API request '+u);
 };t.after(()=>globalThis.fetch=old);
 const request=new Request(api,{method:'POST',headers:{
  Origin:'https://fashionfussion.in',Authorization:'Bearer fake-user-session',
  'Content-Type':'application/json'
 },body:JSON.stringify({action:'finalize',audience:'customer',challenge_id:challenge})});
 const result=await otpHandler({request,env});
 assert.equal(result.status,200);
 assert.equal((await result.json()).transactional_consent_active,true);
 assert.equal(callNames.length,2);
});
test('invalid account-linked challenge is refused before database finalization',async t=>{
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{calls.push(String(url));return json({
  id:userId,email:'test@example.com',
  user_metadata:{account_type:'customer',whatsapp_signup_challenge_id:challenge}
 });};t.after(()=>globalThis.fetch=old);
 const request=new Request(api,{method:'POST',headers:{Authorization:'Bearer fake-session','Content-Type':'application/json'},
  body:JSON.stringify({action:'finalize',audience:'customer',challenge_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})});
 const res=await otpHandler({request,env});
 assert.equal(res.status,409);assert.equal(calls.length,1);
});
function metaMessage(command){
 const id='wamid.'+command.replaceAll(' ','_').toLowerCase();
 return {object:'whatsapp_business_account',entry:[{changes:[{value:{
  metadata:{phone_number_id:'123456789012345'},
  messages:[{id,from:'919876543210',type:'text',text:{body:command},
    timestamp:String(Math.floor(Date.now()/1000))}]
 }}]}]};
}
function signedRequest(payload){
 const body=JSON.stringify(payload),secret='test-app-secret';
 const sig='sha256='+createHmac('sha256',secret).update(body).digest('hex');
 return {request:new Request('https://seller.fashionfussion.in/api/webhooks/whatsapp',{
  method:'POST',headers:{'x-hub-signature-256':sig,'content-type':'application/json'},body
 }),env:{...env,WHATSAPP_APP_SECRET:secret}};
}
for(const [command, expected] of [
 ['STOP',['ingest_whatsapp_inbound_event','record_whatsapp_consent_command','record_whatsapp_transactional_keyword']],
 ['START FASHION UPDATES',['ingest_whatsapp_inbound_event','record_whatsapp_transactional_keyword']],
 ['JOIN FASHION SELLER',['ingest_whatsapp_inbound_event','record_whatsapp_consent_command']]
]){
 test('signed WhatsApp '+command+' routes to proper consent ledger(s)',async t=>{
  const old=globalThis.fetch,paths=[];
  globalThis.fetch=async (url,opts)=>{
   const u=String(url);paths.push(u);
   assert.ok(u.startsWith(supabase+'/rest/v1/rpc/'));
   assert.equal(opts.headers.apikey,serviceKey);
   return json(u.includes('ingest_whatsapp_inbound_event')?[]:true);
  };t.after(()=>globalThis.fetch=old);
  const response=await webhookHandler(signedRequest(metaMessage(command)));
  assert.equal(response.status,200);
  assert.deepEqual(paths.map(p=>p.split('/rpc/')[1]),expected);
 });
}
test('transactional STOP still executes if marketing ledger temporarily fails',async t=>{
 const old=globalThis.fetch,attempted=[];
 globalThis.fetch=async (url,opts)=>{
  const u=String(url);
  attempted.push(u.split('/rpc/')[1]);
  if(u.includes('ingest_whatsapp_inbound_event'))return json([]);
  if(u.includes('record_whatsapp_consent_command'))return json({error:'temporary outage'},503);
  if(u.includes('record_whatsapp_transactional_keyword'))return json(true);
  throw Error('unexpected RPC');
 };
 t.after(()=>globalThis.fetch=old);
 const result=await webhookHandler(signedRequest(metaMessage('STOP')));
 assert.equal(result.status,500,'Meta should retry a partially failed STOP');
 assert.ok(attempted.includes('record_whatsapp_consent_command'));
 assert.ok(attempted.includes('record_whatsapp_transactional_keyword'));
});
test('unsigned STOP is rejected; consent records remain untouched',async t=>{
 const old=globalThis.fetch;let called=0;globalThis.fetch=async()=>{called++;throw Error('unexpected')};
 t.after(()=>globalThis.fetch=old);
 const context=signedRequest(metaMessage('STOP'));
 context.request=new Request(context.request.url,{method:'POST',body:JSON.stringify(metaMessage('STOP'))});
 assert.equal((await webhookHandler(context)).status,401);
 assert.equal(called,0);
});
test('transactional STOP and START reject historical Meta event replays',()=>{
 const sql=readFileSync(new URL('../sql/whatsapp_signup_once_transactional_consent.sql',import.meta.url),'utf8');
 // A signed but delayed STOP older than a newly granted signup consent
 // must not override that newer grant.
 const blockers=sql.match(/p_event_at\s*>\s*greatest\(/g)||[];
 assert.equal(blockers.length,2,'STOP and START must both enforce chronology');
 assert.match(sql,/coalesce\(c\.consented_at,'-infinity'::timestamptz\)/);
 assert.match(sql,/coalesce\(c\.revoked_at,'-infinity'::timestamptz\)/);
 assert.match(sql,/p_status='opted_in'/);
 assert.match(sql,/ledger\.status='opted_in' AND ledger\.revoked_at IS NULL/);
});
test('new-order consent inherits only the verified owner and exact phone',()=>{
 const sql=readFileSync(new URL('../sql/whatsapp_signup_once_transactional_consent.sql',import.meta.url),'utf8');
 assert.match(sql,/cc\.phone_e164=private\.ff_whatsapp_e164\(NEW\.customer_phone\)/);
 assert.match(sql,/JOIN public\.phone_otp_challenges otp/);
 assert.match(sql,/otp\.verified_at IS NOT NULL/);
 assert.match(sql,/otp\.consumed_at IS NOT NULL/);
 assert.match(sql,/otp\.phone_e164=cc\.phone_e164/);
 assert.match(sql,/lower\(otp\.email\)=lower\(u\.email\)/);
 assert.match(sql,/cc\.proof_reference='signup:'/);
 assert.doesNotMatch(sql,/p\.phone_verification_method='whatsapp'/);
 assert.match(sql,/cc\.source='signup_verified_otp'/);
 assert.match(sql,/cc\.status='opted_in'/);
 assert.match(sql,/cc\.revoked_at IS NULL/);
});
test('migration preserves opt-out, signup ownership and no historic order backfill',()=>{
 const sql=readFileSync(new URL('../sql/whatsapp_signup_once_transactional_consent.sql',import.meta.url),'utf8');
 assert.match(sql,/verified_at IS NULL/);
 assert.match(sql,/whatsapp_order_updates_opt_in/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/ledger\.status='opted_in'/);
 assert.match(sql,/cc\.proof_reference='signup:'\|\|NEW\.user_id::text\|\|':'\|\|otp\.id::text/);
 assert.match(sql,/AFTER INSERT ON public\.orders/);
 assert.doesNotMatch(sql,/\bUPDATE public\.orders\b/i);
});

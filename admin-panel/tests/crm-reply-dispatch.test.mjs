import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestPost as emailPost} from '../functions/api/outreach/crm-email-reply-dispatch.js';
import {onRequestPost as waPost} from '../functions/api/outreach/crm-whatsapp-reply-dispatch.js';
globalThis.crypto ||= webcrypto;
const emailEnv={CRM_EMAIL_REPLY_INTERNAL_TOKEN:'x'.repeat(48),SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role'};
const waEnv={CRM_WHATSAPP_REPLY_INTERNAL_TOKEN:'y'.repeat(48),SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role'};
function req(body,token){return new Request('https://crm.fashionfussion.in/api/outreach/reply-dispatch',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})}
test('both reply dispatchers reject unauthenticated requests before network calls',async t=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('no network expected')};t.after(()=>{globalThis.fetch=original});
 assert.equal((await emailPost({request:req({replyId:1,dryRun:false},'bad'),env:emailEnv})).status,401);
 assert.equal((await waPost({request:req({replyId:1,dryRun:false},'bad'),env:waEnv})).status,401);
 assert.equal(calls,0);
});
test('dry run never claims or sends replies and launch gates remain closed by default',async t=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async(url)=>{calls++;assert.match(String(url),/rpc\/crm_get_zoho_mailbox_auth$/);return new Response(JSON.stringify({mailbox_address:'admin@fashionfussion.in',refresh_token:'synthetic-refresh-token-123456789',zoho_account_id:'123456'}),{status:200})};t.after(()=>{globalThis.fetch=original});
 const e=await emailPost({request:req({replyId:7,dryRun:true},emailEnv.CRM_EMAIL_REPLY_INTERNAL_TOKEN),env:emailEnv});
 const w=await waPost({request:req({replyId:9,dryRun:true},waEnv.CRM_WHATSAPP_REPLY_INTERNAL_TOKEN),env:waEnv});
 assert.equal(e.status,200);assert.equal(w.status,200);
 const emailDryRun=await e.json();assert.equal(emailDryRun.messagesSent,0);assert.equal(emailDryRun.oauthConfigurationPresence['customer.care@fashionfussion.in'],true);assert.equal((await w.json()).messagesSent,0);assert.equal(calls,1);
});
test('dispatch cannot run while launch gates are closed',async t=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('closed gate must prevent calls')};t.after(()=>{globalThis.fetch=original});
 const e=await emailPost({request:req({replyId:7,dryRun:false},emailEnv.CRM_EMAIL_REPLY_INTERNAL_TOKEN),env:emailEnv});
 const w=await waPost({request:req({replyId:9,dryRun:false},waEnv.CRM_WHATSAPP_REPLY_INTERNAL_TOKEN),env:waEnv});
 assert.equal(e.status,423);assert.equal(w.status,423);assert.equal(calls,0);
});


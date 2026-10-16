import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../customer-panel/',import.meta.url);
const read=file=>readFileSync(new URL(file,base),'utf8');
test('signup collects a separate unchecked opt-in for future transactional WhatsApp updates',()=>{
 const html=read('signup.html');
 const input=html.match(/<input[^>]*id="whatsappTransactionalOptIn"[^>]*>/);
 assert.ok(input,'signup checkbox missing');
 assert.match(input[0],/type="checkbox"/);
 assert.doesNotMatch(input[0],/\bchecked\b|\brequired\b/);
 assert.match(html,/reply STOP/);
 assert.match(html,/No promotional messages/);
});
test('OTP verification does not silently imply order-updates permission',()=>{
 const code=read('csp-signup.js');
 assert.match(code,/getElementById\('whatsappTransactionalOptIn'\)\?\.checked===true/);
 assert.match(code,/metadata\.whatsapp_order_updates_opt_in=true/);
 assert.match(code,/metadata\.whatsapp_order_updates_consent_version='signup_order_updates_v1'/);
 assert.doesNotMatch(code,/metadata\.whatsapp_order_updates_opt_in\s*=\s*false/);
});
test('checkout does not ask for order-by-order WhatsApp opt-in or impersonate consent',()=>{
 const html=read('checkout.html'),script=read('checkout.js');
 assert.doesNotMatch(html,/<input[^>]+id="whatsappOrderUpdates"/);
 assert.match(html,/If you enabled WhatsApp order updates when creating your account/);
 assert.doesNotMatch(script,/record_checkout_whatsapp_consent|whatsappOrderUpdates/);
});
test('verified order completion is not blocked by WhatsApp preference',()=>{
 const script=read('checkout.js');
 assert.match(script,/async function finish\(storeOrderId\)\{clearCompletedCheckout\(\);location\.href='order-confirmation\.html/);
});

test('login finalizes pending signup verification using signup metadata audience',()=>{
 const code=read('csp-login.js');
 assert.match(code,/metadata\.account_type\|\|p\?\.account_type/);
 assert.match(code,/\['retailer','business','seller'\]\.includes\(accountType\)\?'retailer':'customer'/);
 assert.match(code,/whatsapp_signup_challenge_id/);
 assert.match(code,/throw new Error\(d\.error\|\|'Your verified WhatsApp number could not be linked/);
 assert.doesNotMatch(code,/if\(r\.status===409\)return p/);
});

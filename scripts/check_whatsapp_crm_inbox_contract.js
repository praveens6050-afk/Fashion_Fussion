'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const files={
  api:fs.readFileSync('admin-panel/functions/api/admin-crm-whatsapp-inbox.js','utf8'),
  ui:fs.readFileSync('admin-panel/admin-crm-whatsapp-inbox.js','utf8'),
  html:fs.readFileSync('admin-panel/crm.html','utf8'),
  auth:fs.readFileSync('admin-panel/crm-auth.js','utf8'),
  sql:fs.readFileSync('supabase/migrations/20261019190000_whatsapp_crm_support_inbox.sql','utf8'),
  teamSql:fs.readFileSync('supabase/migrations/20261020110000_crm_whatsapp_team_scoped_access.sql','utf8'),
  whatsappReviewSql:fs.readFileSync('supabase/migrations/20261020181000_crm_whatsapp_identity_review.sql','utf8'),
  supportLogin:fs.readFileSync('admin-panel/support-login.html','utf8'),
  supportPage:fs.readFileSync('admin-panel/support-inbox.html','utf8'),
  supportAuth:fs.readFileSync('admin-panel/support-inbox-auth.js','utf8'),
  loginJs:fs.readFileSync('admin-panel/support-login.js','utf8'),
  emailSql:fs.readFileSync('supabase/migrations/20261020130000_crm_zoho_email_inbox.sql','utf8'),
  emailReplySql:fs.readFileSync('supabase/migrations/20261020140000_crm_zoho_email_reply_queue.sql','utf8'),
  emailReviewSql:fs.readFileSync('supabase/migrations/20261020150000_crm_zoho_email_identity_review.sql','utf8'),
  emailWebhook:fs.readFileSync('admin-panel/functions/api/webhooks/zoho-mail.js','utf8'),
  emailTest:fs.readFileSync('admin-panel/tests/zoho-mail-webhook.test.mjs','utf8'),
  replyReview:fs.readFileSync('supabase/migrations/20261020160000_crm_reply_review_controls.sql','utf8'),
  replyClaims:fs.readFileSync('supabase/migrations/20261020170000_crm_reply_dispatch_claims.sql','utf8'),
  emailDispatch:fs.readFileSync('admin-panel/functions/api/outreach/crm-email-reply-dispatch.js','utf8'),
  waDispatch:fs.readFileSync('admin-panel/functions/api/outreach/crm-whatsapp-reply-dispatch.js','utf8'),
  dispatchTests:fs.readFileSync('admin-panel/tests/crm-reply-dispatch.test.mjs','utf8')
};
for(const marker of ['admin_crm_whatsapp_support_snapshot','admin_crm_queue_whatsapp_reply','Origin not allowed'])
  assert.ok(files.api.includes(marker),'API missing security/action marker: '+marker);
for(const marker of ['ffWaSendReply','ffEmailSendReply','sendWhatsAppReply','sendEmailReply','ffWaTeamFilter','customer_support','seller_support','sales_marketing','admin_operations','crm-send-reply','last_inbound_at','24-hour WhatsApp service window'])
  assert.ok(files.ui.includes(marker),'CRM inbox missing workflow marker: '+marker);
assert.ok(files.html.includes('admin-crm-whatsapp-inbox.js'),'CRM page does not load WhatsApp inbox');
assert.ok(files.supportLogin.includes('support-login.js'),'Restricted support login page missing its login controller');
assert.ok(files.supportPage.includes('support-inbox-auth.js')&&files.supportPage.includes('admin-crm-whatsapp-inbox.js'),'Restricted support page must load team authorization and inbox only');
assert.ok(files.supportAuth.includes("rpc('admin_crm_whatsapp_support_snapshot')"),'Support page must validate access through the team-scoped RPC');
assert.ok(!files.supportPage.includes('admin-crm.js')&&!files.supportPage.includes('admin-crm-directory.js'),'Support page must not load broad admin CRM modules');
assert.ok(files.api.includes("action==='assign_team'"),'Team assignment API action missing');
assert.ok(files.api.includes("action==='classify_whatsapp'"),'WhatsApp identity review API action missing');
assert.ok(files.api.includes("action==='send_approved_reply'")&&files.api.includes("action==='send_approved_email_reply'"),'Explicit admin-triggered dispatch actions missing');
assert.ok(files.api.includes('Administrator approval is required to send replies'),'Dispatch must be admin-only');
assert.ok(files.whatsappReviewSql.includes('admin_crm_classify_whatsapp_event')&&files.whatsappReviewSql.includes("sender_role='unclassified'"),'Admin-only WhatsApp identity review migration missing');
for(const marker of ['crm_email_inbound_events','ingest_crm_email_message','admin_crm_email_support_snapshot','service_role'])assert.ok(files.emailSql.includes(marker),'Email intake migration missing security marker: '+marker);
for(const marker of ['admin_crm_queue_email_reply','pending_review','crm_whatsapp_actor_team'])assert.ok(files.emailReplySql.includes(marker),'Email reply review migration missing security marker: '+marker);
assert.ok(files.emailReviewSql.includes('admin_crm_classify_email_event'),'Email identity review RPC missing');
for(const marker of ['ZOHO_CRM_WEBHOOK_SECRET','ingest_crm_email_message','customer.care@fashionfussion.in','seller.support@fashionfussion.in','sales.team@fashionfussion.in','orders_mailbox_excluded'])assert.ok(files.emailWebhook.includes(marker),'Zoho webhook missing CRM email queue security/routing marker: '+marker);
assert.ok(files.emailTest.includes('unauthenticated Zoho intake'),'Zoho webhook security tests missing');
for(const marker of ['admin_crm_approve_email_reply','admin_crm_approve_whatsapp_reply','pending_review','attempt_count=0','coalesce(e.meta_timestamp,e.created_at)'])assert.ok(files.replyReview.includes(marker),'Reply approval migration missing: '+marker);
for(const marker of ['claim_crm_email_reply','finish_crm_email_reply','claim_crm_whatsapp_reply','finish_crm_whatsapp_reply','retryAllowed',"auth.role()",'coalesce(v_event.meta_timestamp,v_event.created_at)'])assert.ok(files.replyClaims.includes(marker),'Atomic reply claim migration missing: '+marker);
for(const [name,source] of [['Zoho',files.emailDispatch],['WhatsApp',files.waDispatch]])for(const marker of ['dryRun','CRM_','claim_crm_','finish_crm_','PROVIDER_OUTCOME_UNCERTAIN'])assert.ok(source.includes(marker),name+' dispatcher missing safety marker: '+marker);
assert.ok(files.dispatchTests.includes('launch gates are closed'),'Reply dispatch gate tests missing');
assert.ok(files.auth.includes("new Event('ff-crm-ready')"),'CRM readiness event missing');
for(const marker of ['auth.uid()','p.is_admin','routing_status','sender_role','pending_review','REVOKE ALL ON TABLE public.whatsapp_support_reply_outbox FROM PUBLIC,anon,authenticated','REVOKE ALL ON FUNCTION public.admin_crm_queue_whatsapp_reply'])
  assert.ok(files.sql.includes(marker),'Migration missing security marker: '+marker);
for(const marker of ['crm_team_members','auth.uid()','support_team=v_team','admin_crm_set_whatsapp_team_member'])
  assert.ok(files.teamSql.includes(marker),'Team access migration missing security marker: '+marker);
assert.ok(!files.api.includes('graph.facebook.com'),'CRM API must never call Meta directly');
assert.ok(!files.ui.includes('graph.facebook.com'),'CRM UI must never call Meta directly');
console.log('WhatsApp CRM inbox source contract passed: team-scoped authorization, authenticated provider sends, 24-hour service-window guard, no direct Meta calls; Zoho email intake and gated dispatch contracts verified.');


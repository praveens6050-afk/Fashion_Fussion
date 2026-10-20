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
  supportLogin:fs.readFileSync('admin-panel/support-login.html','utf8'),
  supportPage:fs.readFileSync('admin-panel/support-inbox.html','utf8'),
  supportAuth:fs.readFileSync('admin-panel/support-inbox-auth.js','utf8'),
  loginJs:fs.readFileSync('admin-panel/support-login.js','utf8')
};
for(const marker of ['admin_crm_whatsapp_support_snapshot','admin_crm_queue_whatsapp_reply','Origin not allowed'])
  assert.ok(files.api.includes(marker),'API missing security/action marker: '+marker);
for(const marker of ['ffWaTeamFilter','customer_support','seller_support','sales_marketing','admin_operations','Queue reply for review','pending review','identity review'])
  assert.ok(files.ui.includes(marker),'CRM inbox missing workflow marker: '+marker);
assert.ok(files.html.includes('admin-crm-whatsapp-inbox.js'),'CRM page does not load WhatsApp inbox');
assert.ok(files.supportLogin.includes('support-login.js'),'Restricted support login page missing its login controller');
assert.ok(files.supportPage.includes('support-inbox-auth.js')&&files.supportPage.includes('admin-crm-whatsapp-inbox.js'),'Restricted support page must load team authorization and inbox only');
assert.ok(files.supportAuth.includes("rpc('admin_crm_whatsapp_support_snapshot')"),'Support page must validate access through the team-scoped RPC');
assert.ok(!files.supportPage.includes('admin-crm.js')&&!files.supportPage.includes('admin-crm-directory.js'),'Support page must not load broad admin CRM modules');
assert.ok(files.api.includes("action==='assign_team'"),'Team assignment API action missing');
assert.ok(files.auth.includes("new Event('ff-crm-ready')"),'CRM readiness event missing');
for(const marker of ['auth.uid()','p.is_admin','routing_status','sender_role','pending_review','REVOKE ALL ON TABLE public.whatsapp_support_reply_outbox FROM PUBLIC,anon,authenticated','REVOKE ALL ON FUNCTION public.admin_crm_queue_whatsapp_reply'])
  assert.ok(files.sql.includes(marker),'Migration missing security marker: '+marker);
for(const marker of ['crm_team_members','auth.uid()','support_team=v_team','admin_crm_set_whatsapp_team_member'])
  assert.ok(files.teamSql.includes(marker),'Team access migration missing security marker: '+marker);
assert.ok(!files.api.includes('graph.facebook.com'),'CRM API must never call Meta directly');
assert.ok(!files.ui.includes('graph.facebook.com'),'CRM UI must never call Meta directly');
console.log('WhatsApp CRM inbox source contract passed: team-scoped database authorization, isolated support workspace, admin team assignment, reviewed queue only, no direct sending.');

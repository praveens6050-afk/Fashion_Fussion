'use strict';
const fs=require('fs');
const assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
const login=read('admin-panel/crm-login.html');
const loginJs=read('admin-panel/crm-login.js');
const page=read('admin-panel/crm.html');
const auth=read('admin-panel/crm-auth.js');
const config=read('admin-panel/supabase-config.js');
const leads=read('admin-panel/admin-crm.js');
const followups=read('admin-panel/admin-crm-followups.js');
const directory=read('admin-panel/admin-crm-directory.js');
const notifications=read('admin-panel/admin-crm-notifications.js');
const notificationApi=read('admin-panel/api/admin-crm-notifications.js');
const pagesNotificationApi=read('admin-panel/functions/api/admin-crm-notifications.js');
const notificationMigration=read('supabase/migrations/20261017120000_admin_crm_notification_snapshot.sql');
const migration=read('supabase/migrations/20261017110000_admin_seller_lead_crm.sql');
const teamMigration=read('supabase/migrations/20261019100000_crm_team_access.sql');
const teamManagement=read('admin-panel/crm-team-management.js');
const supportWorkspace=read('admin-panel/crm-support-workspace.js');
const navigation=read('admin-panel/crm-navigation.js');
{
  let observer=null,writes=0;
  const targets={
    crmDepartmentModules:{hidden:false,getBoundingClientRect(){return{top:0};}},
    crmTeamManagement:{hidden:true,getBoundingClientRect(){return{top:0};}}
  };
  const links=['crmDepartmentModules','crmTeamManagement'].map(id=>{
    let hidden=false;
    const attrs={};
    const link={dataset:{crmTarget:id},getAttribute(name){return attrs[name]??null;},hasAttribute(name){return Object.prototype.hasOwnProperty.call(attrs,name);},setAttribute(name,value){attrs[name]=String(value);},removeAttribute(name){delete attrs[name];}};
    Object.defineProperty(link,'hidden',{get(){return hidden;},set(value){
      if(value){hidden=true;writes++;if(observer)observer.callback([{type:'attributes',attributeName:'hidden',target:link}]);}
      else hidden=false;
    }});
    return link;
  });
  const nav={querySelectorAll(selector){return selector==='[data-crm-target]'?links:links.filter(link=>!link.hidden);},contains(target){return links.includes(target);},addEventListener(){}};
  const dashboard={hidden:true};
  const document={querySelector(){return nav;},getElementById(id){return id==='dashboard'?dashboard:targets[id];},addEventListener(){}};
  class MutationObserverMock{constructor(callback){this.callback=callback;observer=this;}observe(){}}
  const window={addEventListener(){}};
  const sandbox={document,window,MutationObserver:MutationObserverMock,getComputedStyle(target){return{display:target.hidden?'none':'block'};},innerHeight:900,setTimeout(){return 1;},history:{replaceState(){}}};
  require('vm').runInNewContext(navigation,sandbox);
  observer.callback([{type:'attributes',attributeName:'hidden',target:dashboard}]);
  assert.strictEqual(writes,0,'Hidden CRM dashboard must not trigger navigation mutations');
  dashboard.hidden=false;
  observer.callback([{type:'attributes',attributeName:'hidden',target:dashboard}]);
  assert.strictEqual(writes,1,'Navigation sync should change a hidden link only once');
  assert.strictEqual(links[1].hidden,true,'Hidden workspace should stay out of navigation');
  assert.doesNotThrow(()=>observer.callback([{type:'attributes',attributeName:'hidden',target:links[1]}]),'Navigation link updates must not retrigger the observer');
  assert.strictEqual(writes,1,'Observer should ignore its own navigation-link updates');
}
assert(login.includes('crm-login.js?v=20261019-team-management'),'CRM login page must load the team-aware auth controller');
assert(login.includes('invitation-only')&&login.includes('no public registration'),'CRM login must not advertise public signup');
assert(loginJs.includes("select('is_admin')")&&loginJs.includes("profile?.is_admin===true"),'Existing admins must retain CRM access');
assert(loginJs.includes("from('crm_team_members')")&&loginJs.includes("['customer_support','seller_support','sales','marketing']"),'CRM sign-in must allow only explicitly authorized sales/marketing roles');
assert(loginJs.includes("location.replace('crm.html')"),'Verified CRM users must be routed to CRM');
assert(page.includes('id="dashboard"')&&page.includes('data-admin-ready="false"'),'CRM page must remain hidden until authorization succeeds');
assert(page.includes('crm-navigation.js?v=20261027-observer-loop-1'),'CRM page must bypass cached navigation code after the observer fix');
assert(auth.includes("from('crm_team_members')")&&auth.includes('member.is_active !== true')&&auth.includes('String(member && member.email || \'\').trim().toLowerCase()'),'CRM route must independently enforce active membership and matching email');
assert(auth.includes('function redirectToLogin()')&&auth.includes('location.replace(LOGIN_URL)'),'CRM must redirect on sign-out');
assert(config.includes('location.pathname.replace(')&&config.includes("isCrmPage=page==='crm'||page==='crm.html'"),'CRM clean and .html routes must be detected explicitly');
assert(config.includes("add('admin-crm.js?v=20261017-crm'")&&config.includes("add('admin-crm-followups.js?v=20261017-crm-followups'"),'Seller-acquisition modules must load on the CRM route');
assert(config.includes("if(role==='administrator')")&&config.includes("add('admin-crm-directory.js?v=20261017-crm-directory'")&&config.includes("add('admin-crm-notifications.js?v=20261017-crm-notifications'"),'Customer/seller directory and notification diagnostics must remain administrator-only');
assert(!/function loadCrmModules\(\)\s*\{[^}]*admin-orders\.js/s.test(config),'CRM route must not load admin order-management modules');
assert(leads.includes('async function importCsv')&&leads.includes('no existing lead was overwritten'),'CSV import must validate and avoid overwriting existing records');
assert(followups.includes('seller_lead_tasks')&&followups.includes('seller_lead_activities'),'Follow-up tasks and activity timeline must be wired');
assert(followups.includes('never sends messages'),'CRM must explicitly remain manual-only');
assert(directory.includes("from('orders').select('id,user_id,total_amount,currency,status,customer_name,customer_email,customer_phone,created_at,fulfillment_status,payment_method')"),'Customer 360 must use a limited read-only order projection');
assert(directory.includes("from('seller_profiles').select('user_id,store_name,seller_type,phone,status,seller_code,created_at,updated_at')"),'Seller 360 must use a limited read-only seller projection');
assert(!/razorpay_payment_id|razorpay_signature|payu_mihpayid|shipping_address/.test(directory),'CRM directory must not expose payment secrets or shipping addresses');
assert(notifications.includes("fetch('/api/admin-crm-notifications'")&&notifications.includes('no messages were sent or retried'),'Notification monitor must use the admin API and remain read-only');
assert(notificationApi.includes('withAdminRequest')&&notificationApi.includes('requireAdminUser')&&notificationApi.includes('admin_crm_notification_snapshot'),'Legacy notification API must enforce admin auth and use the secured RPC');
assert(pagesNotificationApi.includes('export async function onRequestPost')&&pagesNotificationApi.includes('export async function onRequestOptions'),'Cloudflare Pages must have native Functions routes for CRM notification API and CORS preflight');
assert(pagesNotificationApi.includes("'/auth/v1/user'")&&pagesNotificationApi.includes("'/rest/v1/profiles?id=eq.'")&&pagesNotificationApi.includes("'/rest/v1/rpc/admin_crm_notification_snapshot'"),'Pages API must verify Supabase session and admin role before calling the RPC');
assert(pagesNotificationApi.includes("'Cache-Control': 'no-store'")&&pagesNotificationApi.includes('Notification diagnostics are temporarily unavailable'),'Pages API must use no-store responses and safe errors');
assert(notificationApi.includes("Access-Control-Allow-Methods','POST,OPTIONS'")&&notificationApi.includes("Access-Control-Allow-Headers','Content-Type, Authorization'"),'Notification API must correctly answer CORS preflight');
assert(notificationMigration.includes('auth.uid()')&&notificationMigration.includes('coalesce(v_is_admin, false)')&&notificationMigration.includes('grant execute on function public.admin_crm_notification_snapshot() to authenticated'),'Notification snapshot RPC must independently enforce admin access');
assert(!/recipient_email|phone_e164|otp_hash|raw_message|last_error\s*,/i.test(notificationMigration),'Notification snapshot must not expose recipient PII, OTP hashes, raw payloads or raw errors');
for(const marker of ['seller_lead_tasks_admin_select','seller_lead_tasks_admin_insert','seller_lead_activities_admin_select','seller_lead_activities_admin_insert'])assert(migration.includes(marker),'Missing initial admin-only RLS policy: '+marker);
assert(migration.includes('enable row level security'),'CRM activity/task tables must enable RLS');
assert(teamMigration.includes('create table if not exists public.crm_team_members'),'CRM must use an explicit staff allowlist');
assert(teamMigration.includes("role in ('customer_support','seller_support','sales','marketing')")&&teamMigration.includes('is_active')&&teamMigration.includes('email text not null'),'CRM roles must be constrained, email-bound and revocable');
assert(page.includes('id="crmTeamManagement"')&&page.includes('id="crmTeamForm"'),'Admin CRM must include Team Management');
assert(page.includes('id="crmMemberId"')&&page.includes('id="crmMemberRole"'),'Team Management must assign an Auth UUID and department');
assert(page.includes('id="crmSupportWorkspace"')&&page.includes('id="crmSupportRows"'),'Support departments must have a separate queue workspace');
assert(auth.includes("crm-support-workspace.js?v=20261023-live-ready-1")&&auth.includes("['customer_support', 'seller_support'].includes(role)"),'Support staff must load only their support queue module');
assert(teamMigration.includes('create or replace function public.crm_support_ticket_queue()')&&teamMigration.includes("'sla_due_at', t.sla_due_at")&&teamMigration.includes('revoke all on function public.crm_support_ticket_queue() from public, anon'),'Support queue must be a narrow, authenticated-only database RPC');
assert(supportWorkspace.includes("rpc('crm_support_ticket_queue')")&&supportWorkspace.includes('customer_support')&&supportWorkspace.includes('seller_support'),'Support queue must call the scoped RPC and identify department');
assert(teamManagement.includes("from('crm_team_members').select('user_id,email,role,is_active,created_at')"),'Team Management must load the CRM staff roster');
assert(teamManagement.includes("upsert({user_id:userId,email,role,is_active:true")&&teamManagement.includes('data-deactivate')&&teamManagement.includes('data-reactivate'),'Team Management must assign roles and allow access revocation/reactivation');
assert(teamManagement.includes("Only verified CRM administrators can manage team access")&&teamManagement.includes('confirm('),'Team Management must verify admin privileges and confirm access changes');
assert(teamMigration.includes('create or replace function public.is_crm_staff()')&&teamMigration.includes('revoke all on function public.is_crm_staff() from public, anon'),'CRM authorization helper must be restricted to authenticated users');
for(const marker of ['seller_leads_crm_select','seller_leads_crm_insert','seller_leads_crm_update','seller_leads_crm_delete','seller_lead_tasks_crm_select','seller_lead_activities_crm_select'])assert(teamMigration.includes(marker),'Missing CRM team RLS policy: '+marker);
assert(teamMigration.includes('public.is_crm_staff()'),'CRM team policies must use database-side role enforcement');

const departmentMigration=read('supabase/migrations/20261019110000_crm_department_modules.sql');
const departmentUi=read('admin-panel/crm-department-workspaces.js');
assert(departmentMigration.includes('crm_b2b_accounts')&&departmentMigration.includes('crm_b2b_deals')&&departmentMigration.includes('crm_b2b_quotes'),'B2B company, deal and quotation schema must exist');
assert(departmentMigration.includes('crm_sales_activities')&&departmentMigration.includes('crm_support_macros'),'Sales activity logs and support response macros must exist');
assert(departmentMigration.includes('crm_marketing_campaigns')&&departmentMigration.includes('crm_rfm_segments')&&departmentMigration.includes('crm_ab_tests'),'Marketing campaign, RFM and experiment schema must exist');
assert(departmentMigration.includes('crm_coupon_performance()')&&departmentMigration.includes('crm_refresh_rfm_segments()'),'Marketing analytics RPCs must be present');
assert(departmentMigration.includes("public.crm_has_role(array['sales'])")&&departmentMigration.includes("public.crm_has_role(array['marketing'])"),'Department tables must have database-enforced role policies');
assert(departmentUi.includes('B2B Company Accounts')&&departmentUi.includes('Quotation / Proforma Log')&&departmentUi.includes('Sales Activity'),'Sales workspace must expose company/deal/quote/activity tools');
assert(departmentUi.includes('Canned Response Directory')&&departmentUi.includes('SLA Monitor'),'Support workspace must expose SLA and macro tools');
assert(departmentUi.includes('Campaign & Journey Planner')&&departmentUi.includes('Refresh order-based RFM')&&departmentUi.includes('Coupon Performance')&&departmentUi.includes('A/B Test Archive'),'Marketing workspace must expose campaign, RFM, coupon and experiment views');
assert(departmentUi.includes('no messages were sent')||departmentUi.includes('No messages were sent')||departmentUi.includes('does not send'), 'Marketing campaign planning must remain manual-only');


assert(departmentMigration.includes('crm_sales_quotas')&&departmentMigration.includes('crm_b2b_deal_stage_history')&&departmentMigration.includes('crm_sales_metrics()'),'Sales quota and pipeline velocity metrics must be present');
assert(departmentMigration.includes('crm_support_metrics()')&&departmentMigration.includes('avg_first_response_minutes')&&departmentMigration.includes('first_contact_resolution_pct'),'Support FRT/FCR metrics must be present');
assert(departmentUi.includes('crm_sales_metrics')&&departmentUi.includes('crm_support_metrics'),'Sales and support metrics must be wired into role workspaces');
assert(read('admin-panel/crm-team-management.js').includes('crmQuotaForm'),'CRM admins must have a quota management form');


const inboxMigration=read('supabase/migrations/20261019130000_crm_unified_inbox.sql');
const inboxUi=read('admin-panel/crm-unified-inbox.js');
const inboxWebhook=read('supabase/functions/crm-inbound-webhook/index.ts');
assert(inboxMigration.includes('crm_inbox_conversations')&&inboxMigration.includes('crm_inbox_messages'),'Unified inbound inbox tables must exist');
assert(inboxMigration.includes('crm_inbox_can_access')&&inboxMigration.includes('crm_inbox_messages_department_read'),'Inbox database access must be department-scoped');
assert(inboxMigration.includes('crm_ingest_inbound_message')&&inboxMigration.includes('seller_profiles'),'Inbound messages must be deduplicated and seller-routed');
assert(inboxWebhook.includes('x-hub-signature-256')&&inboxWebhook.includes('CRM_EMAIL_WEBHOOK_SECRET'),'WhatsApp and email webhook signatures must be verified');
assert(inboxWebhook.includes('WHATSAPP_SALES_PHONE_NUMBER_ID')&&inboxWebhook.includes('WHATSAPP_MARKETING_PHONE_NUMBER_ID'),'Dedicated Sales/Marketing WhatsApp number routing must be supported');
assert(inboxWebhook.includes('value.statuses')&&inboxWebhook.includes('delivery_status: deliveryStatus')&&inboxWebhook.includes('META_DELIVERY_FAILED'),'Signed Meta delivery receipts must update outbound message and failure audit status');
assert(inboxUi.includes('crm_inbox_conversations')&&inboxUi.includes('crm_inbox_messages')&&inboxUi.includes('30000'),'Inbox UI must load authorized messages and refresh periodically');
assert(read('admin-panel/crm.html').includes('crmUnifiedInbox')&&read('admin-panel/crm-auth.js').includes('crm-unified-inbox.js'),'Authorized CRM roles must load the unified inbox');

const sendMigration=read('supabase/migrations/20261019140000_crm_outbound_reply.sql');
const sendFunction=read('supabase/functions/crm-send-reply/index.ts');
assert(sendMigration.includes('crm_inbox_send_attempts')&&sendMigration.includes('request_id uuid not null unique'),'Outbound send attempts must have unique idempotency keys');
assert(sendMigration.includes('crm_inbox_can_access_conversation')&&sendMigration.includes('sales.team@fashionfussion.in'),'Sales/Marketing shared inbox must be visible through database RLS');
assert(sendFunction.includes('sharedSalesMarketing')&&sendFunction.includes('CONVERSATION_ASSIGNED_TO_ANOTHER_AGENT'),'Shared Sales/Marketing replies must honor single assigned owner');
assert(sendMigration.includes("orders@fashionfussion.in")&&sendMigration.includes("v_department:='seller_support'")&&sendMigration.includes("v_department:='sales'"),'Inbound aliases must route exactly and transactional orders mail must be excluded from support');
assert(sendFunction.includes('db.auth.getUser(token)')&&sendFunction.includes('crm_team_members')&&sendFunction.includes('DEPARTMENT_ACCESS_DENIED'),'Outbound sending must verify session and department access server-side');
assert(sendFunction.includes('META_WHATSAPP_ACCESS_TOKEN')&&sendFunction.includes('WHATSAPP_TEMPLATE_REQUIRED_OUTSIDE_24H'),'WhatsApp replies must use server credentials and enforce 24-hour service window');
assert(sendFunction.includes('ZOHO_REFRESH_TOKEN')&&sendFunction.includes('ZOHO_MAIL_ACCOUNT_ID')&&sendFunction.includes('CRM_FROM_CUSTOMER_CARE'),'Email replies must use server-side Zoho OAuth and department sender aliases');
assert(sendFunction.includes('/messages/\"+encodeURIComponent(zohoMessageId)')&&sendFunction.includes('ZOHO_ORIGINAL_MESSAGE_ID_MISSING'),'Email replies must use the original Zoho message ID and fail closed if absent');
assert(inboxWebhook.includes('const internalZohoId = m.zoho_message_id || m.zohoMessageId || m.zohoInternalMessageId || null')&&inboxWebhook.includes('zoho_message_id: internalZohoId ? String(internalZohoId) : null'),'Email ingestion must retain the explicit Zoho internal message ID for replies without assuming the external ID is the Zoho ID');
assert(inboxWebhook.includes('m.externalMessageId')&&inboxWebhook.includes('const senderRaw = String(m.from_email || m.fromEmail || m.from || "")'),'Zoho intake must accept the documented normalized bridge payload');
assert(inboxWebhook.includes('address !== "orders@fashionfussion.in"'),'Orders mailbox must be excluded from the CRM support inbox');
assert(sendMigration.includes('received_at,last_inbound_at,metadata')&&sendMigration.includes('now(),now(),coalesce(p_metadata'),'New WhatsApp conversations must record the inbound timestamp for 24-hour enforcement');
assert(sendMigration.includes('on conflict(provider_message_id,direction) do nothing returning id into v_message_id')&&sendMigration.includes('if v_message_id is null then return v_id; end if;'),'Duplicate inbound webhook replays must not refresh the WhatsApp 24-hour reply window');
assert(sendFunction.includes('crm_inbox_send_attempts')&&sendFunction.includes('crm_inbox_messages')&&sendFunction.includes('delivery_status:"sent"'),'Provider sends must be recorded in the CRM audit/message history');
assert(inboxUi.includes("functions.invoke('crm-send-reply'")&&inboxUi.includes('crypto.randomUUID()')&&inboxUi.includes('crmInboxReplyForm'),'CRM inbox must include an idempotency-keyed reply composer');
assert(sendFunction.includes('CRM_CRM_REPLY_LIVE_TEST_APPROVED')&&sendFunction.includes('CRM_CRM_REPLY_LIVE_TEST_ACK')&&sendFunction.includes('CRM_REPLY_SENDING_DISABLED_UNTIL_EXPLICIT_TEST_APPROVAL'),'CRM reply API must fail closed until separate test approval');
assert(inboxUi.includes('const canReply=false')&&inboxUi.includes('separate CRM test send is explicitly approved'),'CRM inbox UI must remain read-only until separate test approval');
assert(!/SUPABASE_SERVICE_ROLE_KEY|META_WHATSAPP_ACCESS_TOKEN|ZOHO_REFRESH_TOKEN/.test(read('admin-panel/crm-unified-inbox.js')),'Provider credentials must never be placed in browser code');

assert(read('supabase/config.toml').includes('[functions.crm-send-reply]')&&read('supabase/config.toml').includes('verify_jwt = true'),'CRM reply sender must require JWT verification at the Supabase gateway');
assert(sendFunction.includes('allowedOrigins')&&sendFunction.includes('https://crm.fashionfussion.in'),'Reply sender must allow only the canonical CRM origins');
console.log('CRM panel contract checks passed: CRM auth, department isolation, unified inbox, reply sender, provider safety, and build wiring.');

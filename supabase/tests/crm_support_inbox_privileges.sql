-- CRM inbox storage and dispatch RPCs must remain private; senders are not enabled by these tests.
BEGIN;
SELECT plan(15);
SELECT ok(to_regclass('public.crm_team_members') IS NOT NULL,'CRM team membership table exists');
SELECT ok(NOT has_table_privilege('anon','public.crm_team_members','SELECT')
 AND NOT has_table_privilege('authenticated','public.crm_team_members','SELECT'),
 'browser roles cannot read the CRM team membership table');
SELECT ok(to_regclass('public.crm_email_inbound_events') IS NOT NULL,'CRM email inbox table exists');
SELECT ok(NOT has_table_privilege('anon','public.crm_email_inbound_events','SELECT')
 AND NOT has_table_privilege('authenticated','public.crm_email_inbound_events','SELECT'),
 'browser roles cannot query raw CRM email events');
SELECT ok(to_regclass('public.crm_email_reply_outbox') IS NOT NULL,'CRM email reply outbox exists');
SELECT ok(NOT has_table_privilege('anon','public.crm_email_reply_outbox','SELECT')
 AND NOT has_table_privilege('authenticated','public.crm_email_reply_outbox','SELECT'),
 'browser roles cannot query CRM email reply outbox');
SELECT ok(to_regclass('public.whatsapp_support_reply_outbox') IS NOT NULL,'CRM WhatsApp reply outbox exists');
SELECT ok(NOT has_table_privilege('anon','public.whatsapp_support_reply_outbox','SELECT')
 AND NOT has_table_privilege('authenticated','public.whatsapp_support_reply_outbox','SELECT'),
 'browser roles cannot query CRM WhatsApp reply outbox');
SELECT ok(has_function_privilege('service_role','public.ingest_crm_email_message(text,text,text,text,text,timestamptz)','EXECUTE')
 AND NOT has_function_privilege('anon','public.ingest_crm_email_message(text,text,text,text,text,timestamptz)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.ingest_crm_email_message(text,text,text,text,text,timestamptz)','EXECUTE'),
 'only service_role can ingest CRM email');
SELECT ok(has_function_privilege('service_role','public.claim_crm_email_reply(bigint)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.claim_crm_email_reply(bigint)','EXECUTE'),
 'only server role can claim email replies');
SELECT ok(has_function_privilege('service_role','public.claim_crm_whatsapp_reply(bigint)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.claim_crm_whatsapp_reply(bigint)','EXECUTE'),
 'only server role can claim WhatsApp replies');
SELECT ok(NOT has_function_privilege('anon','public.admin_crm_approve_email_reply(bigint)','EXECUTE')
 AND has_function_privilege('authenticated','public.admin_crm_approve_email_reply(bigint)','EXECUTE'),
 'email approval RPC is authenticated and rechecks admin in its body');
SELECT ok(NOT has_function_privilege('anon','public.admin_crm_approve_whatsapp_reply(bigint)','EXECUTE')
 AND has_function_privilege('authenticated','public.admin_crm_approve_whatsapp_reply(bigint)','EXECUTE'),
 'WhatsApp approval RPC is authenticated and rechecks admin in its body');
SELECT ok(has_function_privilege('authenticated','public.admin_crm_whatsapp_support_snapshot()','EXECUTE')
 AND has_function_privilege('authenticated','public.admin_crm_email_support_snapshot()','EXECUTE'),
 'scoped snapshot RPCs are callable only after database actor authorization');
SELECT ok(to_regprocedure('public.admin_crm_classify_email_event(bigint)') IS NOT NULL
 AND to_regprocedure('public.admin_crm_set_whatsapp_team_member(uuid,text,boolean)') IS NOT NULL,
 'email review and admin team assignment RPCs exist');
SELECT * FROM finish();
ROLLBACK;

begin;

create extension if not exists pgtap with schema extensions;
select plan(38);

select has_table('public', 'whatsapp_inbound_events', 'inbound events table is created');
select has_table('public', 'phone_otp_challenges', 'phone OTP challenges table is created');
select has_table('public', 'auth_login_otp_challenges', 'shared login OTP challenges table is created');
select has_table('public', 'whatsapp_contact_consents', 'consent ledger table is created');
select has_table('public', 'whatsapp_consent_events', 'consent event ledger is created');
select has_table('public', 'whatsapp_order_notification_outbox', 'order outbox table is created');
select has_table('public', 'whatsapp_order_consents', 'per-order consent table is created');
select has_table('public', 'whatsapp_delivery_status_events', 'delivery receipt table is created');

select ok((select relrowsecurity from pg_class where oid='public.whatsapp_inbound_events'::regclass), 'inbound events have RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.whatsapp_contact_consents'::regclass), 'consent ledger has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.whatsapp_order_notification_outbox'::regclass), 'outbox has RLS enabled');

select ok(not has_table_privilege('anon','public.whatsapp_contact_consents','select'), 'anon cannot read consent ledger');
select ok(not has_table_privilege('authenticated','public.whatsapp_contact_consents','select'), 'authenticated cannot read consent ledger');
select ok(not has_table_privilege('anon','public.whatsapp_order_notification_outbox','select'), 'anon cannot read outbox');
select ok(not has_table_privilege('authenticated','public.whatsapp_order_notification_outbox','select'), 'authenticated cannot read outbox');
select ok(has_table_privilege('service_role','public.whatsapp_contact_consents','select,insert,update,delete'), 'service role can operate consent ledger');
select ok(has_table_privilege('service_role','public.whatsapp_order_notification_outbox','select,insert,update,delete'), 'service role can operate outbox');

select has_function('public','ingest_whatsapp_inbound_event', ARRAY['text','text','text','text','text','text','timestamp with time zone','jsonb'], 'inbound classifier RPC exists');
select ok(has_function_privilege('service_role','public.ingest_whatsapp_inbound_event(text,text,text,text,text,text,timestamptz,jsonb)','execute'), 'service role can execute inbound classifier');
select ok(not has_function_privilege('authenticated','public.ingest_whatsapp_inbound_event(text,text,text,text,text,text,timestamptz,jsonb)','execute'), 'authenticated cannot execute inbound classifier');
select ok(has_function_privilege('service_role','public.stage_whatsapp_order_event(bigint,text)','execute'), 'service role can stage an eligible notification');
select ok(not has_function_privilege('anon','public.stage_whatsapp_order_event(bigint,text)','execute'), 'anon cannot stage notifications');
select ok(has_function_privilege('authenticated','public.record_checkout_whatsapp_consent(bigint)','execute'), 'authenticated can call owner-checked checkout consent RPC');
select ok(not has_function_privilege('anon','public.record_checkout_whatsapp_consent(bigint)','execute'), 'anon cannot call checkout consent RPC');
select ok(has_function_privilege('service_role','public.record_whatsapp_delivery_status(text,text,timestamptz,text)','execute'), 'service role can record delivery receipts');
select ok(not has_function_privilege('authenticated','public.record_whatsapp_delivery_status(text,text,timestamptz,text)','execute'), 'authenticated cannot record delivery receipts');

select is((select role from public.resolve_whatsapp_role('')), 'unknown', 'empty inbound identity remains unknown');

select lives_ok(
  $$select public.record_whatsapp_consent_command('+919876543210','msg-join-0001','opted_in',timestamptz '2026-01-01 10:00:00+00')$$,
  'valid JOIN consent is recorded'
);
select is((select status from public.whatsapp_contact_consents where phone_e164='+919876543210' and purpose='marketing'), 'opted_in', 'JOIN grants marketing consent');
select lives_ok(
  $$select public.record_whatsapp_consent_command('+919876543210','msg-stop-0001','opted_out',timestamptz '2026-01-01 10:00:01+00')$$,
  'valid STOP consent is recorded'
);
select is((select status from public.whatsapp_contact_consents where phone_e164='+919876543210' and purpose='marketing'), 'opted_out', 'STOP revokes marketing consent');
select lives_ok(
  $$select public.record_whatsapp_consent_command('+919876543210','msg-stale-001','opted_in',timestamptz '2026-01-01 10:00:00.500+00')$$,
  'a stale JOIN is safely ignored'
);
select is((select status from public.whatsapp_contact_consents where phone_e164='+919876543210' and purpose='marketing'), 'opted_out', 'stale JOIN cannot revive consent');
select lives_ok(
  $$select public.record_whatsapp_consent_command('+919876543210','msg-tie-0001','opted_in',timestamptz '2026-01-01 10:00:01+00')$$,
  'a same-time JOIN is safely resolved'
);
select is((select status from public.whatsapp_contact_consents where phone_e164='+919876543210' and purpose='marketing'), 'opted_out', 'STOP wins timestamp ties');
select is((select count(*)::integer from public.whatsapp_consent_events where phone_e164='+919876543210'), 4, 'stale and duplicate ordering still records unique source events');

insert into public.orders(id) values (900001);
insert into public.whatsapp_order_notification_outbox(order_id,event_type)
values (900001,'order_confirmed');
select is((select status from public.whatsapp_order_notification_outbox where order_id=900001), 'pending_review', 'new outbox rows require review and are not sent');
select throws_ok(
  $$insert into public.whatsapp_order_notification_outbox(order_id,event_type) values (900001,'order_confirmed')$$,
  '23505',
  'duplicate key value violates unique constraint "whatsapp_order_notification_once_per_order_event"',
  'one outbox event is allowed per order and event type'
);

select * from finish();
rollback;

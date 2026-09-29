-- Recovery bundle reconstructed from production supabase_migrations.schema_migrations.
-- It replays the lost 20260928141652..20260928174033 migrations in their original order.

-- BEGIN RECOVERED 20260928141652_customer_account_types_and_business_bank
-- Separate retail customers from business/bulk buyers and keep bank verification server-controlled.

alter table public.profiles
  add column if not exists account_type text not null default 'retail';

alter table public.profiles
  drop constraint if exists profiles_account_type_check;
alter table public.profiles
  add constraint profiles_account_type_check check (account_type = any (array['retail'::text,'business'::text]));

alter table public.business_profiles
  add column if not exists gst_verification_status text not null default 'unverified',
  add column if not exists gst_verified_at timestamptz,
  add column if not exists gst_verification_ref text;

alter table public.business_profiles
  drop constraint if exists business_profiles_gst_verification_status_check;
alter table public.business_profiles
  add constraint business_profiles_gst_verification_status_check
  check (gst_verification_status = any (array['unverified'::text,'pending'::text,'verified'::text,'failed'::text]));

create or replace function public.protect_business_gst_verification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.gst_verification_status := 'unverified';
      new.gst_verified_at := null;
      new.gst_verification_ref := null;
    else
      if new.gstin is distinct from old.gstin then
        new.gst_verification_status := 'unverified';
        new.gst_verified_at := null;
        new.gst_verification_ref := null;
      else
        new.gst_verification_status := old.gst_verification_status;
        new.gst_verified_at := old.gst_verified_at;
        new.gst_verification_ref := old.gst_verification_ref;
      end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists protect_business_gst_verification_before_write on public.business_profiles;
create trigger protect_business_gst_verification_before_write
before insert or update on public.business_profiles
for each row execute function public.protect_business_gst_verification();

create or replace function public.mark_customer_profile_business()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.profiles
  set account_type = 'business', updated_at = now()
  where id = new.user_id and account_type <> 'business';
  return new;
end;
$function$;

drop trigger if exists mark_customer_profile_business_after_insert on public.business_profiles;
create trigger mark_customer_profile_business_after_insert
after insert on public.business_profiles
for each row execute function public.mark_customer_profile_business();

create table if not exists public.business_bank_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_holder_name text not null check (char_length(btrim(account_holder_name)) between 2 and 120),
  bank_name text,
  ifsc text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_number_last4 text not null check (account_number_last4 ~ '^[0-9]{4}$'),
  account_type text not null default 'current' check (account_type = any (array['current'::text,'savings'::text])),
  provider text not null default 'cashfree_secure_id',
  provider_reference text,
  verification_status text not null default 'unverified' check (verification_status = any (array['unverified'::text,'pending'::text,'verified'::text,'failed'::text])),
  verified_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_bank_profiles enable row level security;

drop policy if exists business_bank_profiles_select_own on public.business_bank_profiles;
create policy business_bank_profiles_select_own
on public.business_bank_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.business_bank_profiles from anon, authenticated;
grant select on table public.business_bank_profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_type text;
  v_business_name text;
  v_gstin text;
  v_billing text;
begin
  v_account_type := case when lower(coalesce(new.raw_user_meta_data ->> 'account_type','')) = 'business' then 'business' else 'retail' end;

  insert into public.profiles (id, full_name, phone, account_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    v_account_type
  )
  on conflict (id) do update
    set full_name = case when coalesce(public.profiles.full_name,'') = '' then excluded.full_name else public.profiles.full_name end,
        phone = coalesce(public.profiles.phone, excluded.phone),
        account_type = case when public.profiles.account_type = 'retail' and excluded.account_type = 'business' then 'business' else public.profiles.account_type end;

  if v_account_type = 'business' then
    v_business_name := btrim(coalesce(new.raw_user_meta_data ->> 'business_name',''));
    if char_length(v_business_name) < 2 or char_length(v_business_name) > 160 then
      v_business_name := 'Business account';
    end if;
    v_gstin := upper(btrim(coalesce(new.raw_user_meta_data ->> 'business_gstin','')));
    if v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
      v_gstin := null;
    end if;
    v_billing := btrim(coalesce(new.raw_user_meta_data ->> 'business_billing_address',''));

    insert into public.business_profiles (user_id,business_name,gstin,billing_address)
    values (new.id,v_business_name,v_gstin,case when v_billing <> '' then jsonb_build_object('text',v_billing) else null end)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$function$;

update public.profiles p
set account_type = 'business', updated_at = now()
where account_type = 'retail'
  and exists (select 1 from public.business_profiles b where b.user_id = p.id);
-- END RECOVERED 20260928141652

-- BEGIN RECOVERED 20260928141919_lock_down_customer_business_trigger_functions
revoke all on function public.mark_customer_profile_business() from public, anon, authenticated;
revoke all on function public.protect_business_gst_verification() from public, anon, authenticated;
-- END RECOVERED 20260928141919

-- BEGIN RECOVERED 20260928143521_support_bot_live_agent_handoff
alter table public.support_tickets
  add column if not exists support_mode text not null default 'human',
  add column if not exists handoff_requested_at timestamptz,
  add column if not exists handoff_reason text,
  add column if not exists live_agent_joined_at timestamptz,
  add column if not exists bot_last_replied_at timestamptz,
  add column if not exists bot_fallback_count integer not null default 0;

alter table public.support_tickets drop constraint if exists support_tickets_support_mode_check;
alter table public.support_tickets add constraint support_tickets_support_mode_check
  check (support_mode = any (array['bot'::text,'human'::text]));
alter table public.support_tickets drop constraint if exists support_tickets_bot_fallback_count_check;
alter table public.support_tickets add constraint support_tickets_bot_fallback_count_check
  check (bot_fallback_count >= 0);

alter table public.support_ticket_messages drop constraint if exists support_ticket_messages_sender_role_check;
alter table public.support_ticket_messages add constraint support_ticket_messages_sender_role_check
  check (sender_role = any (array['customer'::text,'admin'::text,'customer_care'::text,'seller'::text,'system'::text,'bot'::text]));

create or replace function public.support_message_requests_human(p_message text)
returns boolean
language sql
immutable
set search_path = 'pg_catalog', 'public'
as $function$
  select lower(coalesce(p_message,'')) ~ '(live[ -]?agent|human agent|human support|real person|talk to (an )?agent|speak to (an )?agent|talk to (a )?human|speak to (a )?human|customer care agent|customer care se baat|agent se baat|human se baat|executive se baat|representative|support executive|connect me to|transfer me|escalate|insaan se baat)';
$function$;

create or replace function public.support_bot_make_reply(p_ticket_id bigint, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_ticket public.support_tickets;
  v_order public.orders;
  v_msg text := lower(btrim(coalesce(p_message,'')));
  v_reply text;
  v_matched boolean := true;
  v_order_label text;
begin
  select * into v_ticket from public.support_tickets where id=p_ticket_id;
  if not found then return jsonb_build_object('message','I could not find this support ticket.','matched',false); end if;

  if v_ticket.order_id is not null then
    select * into v_order from public.orders where id=v_ticket.order_id and user_id=v_ticket.customer_id;
    if found then v_order_label := coalesce(v_order.display_order_id,'Order #'||v_order.id::text); end if;
  end if;

  if v_msg ~ '(hello|hi|hey|namaste|help)' and char_length(v_msg) < 50 then
    v_reply := 'Hi! I’m the Fashion Fussion Support Bot. I can help with orders, payments, delivery, returns/refunds, products and account questions. You can type “live agent” anytime to move this chat to Customer Care.';
  elsif v_msg ~ '(track|tracking|where.*order|order status|order.*kahan|kab.*aayega|delivery|deliver|shipment|shipped)' then
    if v_order_label is not null then
      v_reply := v_order_label||' is currently showing order status “'||coalesce(v_order.status,'processing')||'” and fulfilment status “'||coalesce(v_order.fulfillment_status,'processing')||'”. If this does not match what you are seeing, tap “Talk to live agent”.';
    else
      v_reply := 'I can check an order when this ticket is linked to it. Please share the order number in this chat, or tap “Talk to live agent” if you want Customer Care to check it for you.';
    end if;
  elsif v_msg ~ '(refund|return|return/refund|wapas|refund.*paisa|paise.*wapas)' then
    v_reply := 'For a return or refund, keep the related order and item details ready. You can track the same ticket here while Customer Care reviews eligibility and refund progress. If you need a person to review the case now, tap “Talk to live agent”.';
  elsif v_msg ~ '(payment|upi|card|charged|charge|deduct|debited|debit|transaction|paisa.*kat|paise.*kat)' then
    if v_order_label is not null then
      v_reply := 'For '||v_order_label||', the recorded payment method is “'||coalesce(v_order.payment_method,'not available')||'” and the order status is “'||coalesce(v_order.status,'processing')||'”. If money was debited but the order/payment does not look correct, please share the payment reference and tap “Talk to live agent”.';
    else
      v_reply := 'For payment help, please share the order number plus the payment reference/UTR if available. Do not share OTP, CVV or card PIN. You can also tap “Talk to live agent” for Customer Care.';
    end if;
  elsif v_msg ~ '(login|sign in|signin|password|account|profile|email change|phone change)' then
    v_reply := 'For account access, use “Forgot password?” on the sign-in page. For profile or account-detail changes, open My Account. If you are still blocked, tap “Talk to live agent” and Customer Care can take over this chat.';
  elsif v_msg ~ '(gst|gstin|business invoice|tax invoice|invoice)' then
    v_reply := 'For a business invoice, use your saved business details/GSTIN during checkout when available. If the GST details or invoice for an existing order need correction or review, tap “Talk to live agent”.';
  elsif v_msg ~ '(damaged|wrong item|missing item|quality|product|item)' then
    v_reply := 'For a product issue, please describe what is wrong and include the related order/item details. For damaged, wrong or missing items, Customer Care may need to review the order, so you can tap “Talk to live agent” at any time.';
  elsif v_ticket.issue_type in ('delivery','order') and v_order_label is not null then
    v_reply := v_order_label||' currently shows order status “'||coalesce(v_order.status,'processing')||'” and fulfilment status “'||coalesce(v_order.fulfillment_status,'processing')||'”. Tell me what looks incorrect, or tap “Talk to live agent”.';
  elsif v_ticket.issue_type='payment' then
    v_reply := 'I can help with payment issues. Please share the order number and payment reference/UTR if available, but never share OTP, CVV or card PIN. Type “live agent” if you want Customer Care.';
  elsif v_ticket.issue_type='return_refund' then
    v_reply := 'I can help with returns and refunds. Tell me whether you want to return an item, are waiting for a refund, or received a wrong/damaged item. Type “live agent” if you want Customer Care.';
  elsif v_ticket.issue_type='account' then
    v_reply := 'I can help with sign-in and account questions. Tell me what is not working, or type “live agent” to move this chat to Customer Care.';
  elsif v_ticket.issue_type='product' then
    v_reply := 'Please tell me what happened with the product and, if relevant, the order number. For a case needing manual review, type “live agent”.';
  else
    v_matched := false;
    v_reply := 'I’m not fully confident I can resolve that automatically. Please add a little more detail. If you prefer, type “live agent” or use the “Talk to live agent” button and I’ll transfer this chat to Customer Care.';
  end if;

  return jsonb_build_object('message',v_reply,'matched',v_matched);
end;
$function$;

create or replace function public.support_bot_process_customer_message(p_ticket_id bigint, p_message text)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_ticket public.support_tickets;
  v_answer jsonb;
  v_reply text;
  v_matched boolean;
  v_fallback integer;
begin
  select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
  if not found or v_ticket.channel<>'customer_support' or v_ticket.status='closed' or v_ticket.support_mode<>'bot' then return; end if;

  if public.support_message_requests_human(p_message) then
    update public.support_tickets
       set support_mode='human',handoff_requested_at=coalesce(handoff_requested_at,now()),handoff_reason='customer_requested_in_chat',
           priority=case when priority in ('low','normal') then 'high' else priority end,
           status='waiting_admin',sla_due_at=coalesce(sla_due_at,public.support_add_working_days(now(),3)),updated_at=now()
     where id=p_ticket_id;
    insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
    values(p_ticket_id,null,'bot','I’m transferring this chat to a live Customer Care agent now. You can keep this chat open; an agent will reply here when available.','system');
    return;
  end if;

  v_answer := public.support_bot_make_reply(p_ticket_id,p_message);
  v_reply := coalesce(v_answer->>'message','I’m here to help. Please tell me more about the issue.');
  v_matched := coalesce((v_answer->>'matched')::boolean,false);
  v_fallback := case when v_matched then 0 else coalesce(v_ticket.bot_fallback_count,0)+1 end;

  if not v_matched and v_fallback >= 2 then
    update public.support_tickets
       set support_mode='human',handoff_requested_at=coalesce(handoff_requested_at,now()),handoff_reason='bot_low_confidence',
           bot_fallback_count=v_fallback,priority=case when priority in ('low','normal') then 'high' else priority end,
           status='waiting_admin',sla_due_at=coalesce(sla_due_at,public.support_add_working_days(now(),3)),updated_at=now()
     where id=p_ticket_id;
    insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
    values(p_ticket_id,null,'bot','I’m not confident I can solve this correctly, so I’ve transferred the chat to a live Customer Care agent. An agent will reply here when available.','system');
    return;
  end if;

  insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
  values(p_ticket_id,null,'bot',v_reply,'system');
  update public.support_tickets
     set bot_fallback_count=v_fallback,bot_last_replied_at=now(),status='waiting_customer',updated_at=now()
   where id=p_ticket_id;
end;
$function$;

create or replace function public.request_live_support_agent(p_ticket_id bigint)
returns public.support_tickets
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid:=auth.uid();
  v_ticket public.support_tickets;
  v_was_bot boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_ticket from public.support_tickets where id=p_ticket_id and customer_id=v_uid for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_ticket.channel<>'customer_support' then raise exception 'Live Customer Care is available on Customer Support tickets'; end if;
  if v_ticket.status='closed' then raise exception 'Reopen this ticket before requesting a live agent'; end if;
  v_was_bot := v_ticket.support_mode='bot';
  update public.support_tickets
     set support_mode='human',handoff_requested_at=coalesce(handoff_requested_at,now()),handoff_reason=coalesce(handoff_reason,'customer_requested_button'),
         priority=case when priority in ('low','normal') then 'high' else priority end,
         status='waiting_admin',sla_due_at=coalesce(sla_due_at,public.support_add_working_days(now(),3)),updated_at=now()
   where id=v_ticket.id returning * into v_ticket;
  if v_was_bot then
    insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
    values(v_ticket.id,null,'bot','I’ve transferred this chat to a live Customer Care agent. You can continue typing here and an agent will reply when available.','system');
  end if;
  return v_ticket;
end;
$function$;

create or replace function public.create_support_ticket(p_channel text, p_order_id bigint, p_product_id bigint, p_variant_id bigint, p_issue_type text, p_subject text, p_message text)
returns public.support_tickets
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid:=auth.uid(); v_order public.orders; v_seller uuid; v_ticket public.support_tickets; v_existing public.support_tickets;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_channel not in ('customer_support','seller_support') then raise exception 'Invalid support channel'; end if;
  if char_length(btrim(coalesce(p_issue_type,''))) not between 2 and 80 then raise exception 'Issue type is required'; end if;
  if char_length(btrim(coalesce(p_subject,''))) not between 3 and 180 then raise exception 'Subject must be 3 to 180 characters'; end if;
  if char_length(btrim(coalesce(p_message,''))) not between 1 and 5000 then raise exception 'Message is required'; end if;
  if not public.consume_api_rate_limit(v_uid::text,'support_ticket_create',5,3600) then raise exception 'Too many support tickets. Please wait before creating another ticket.'; end if;

  if p_order_id is not null then
    select * into v_order from public.orders where id=p_order_id and user_id=v_uid;
    if not found then raise exception 'Order not found for this customer'; end if;
  end if;

  if p_channel='seller_support' then
    if p_order_id is null or p_product_id is null then raise exception 'Seller support requires an order and purchased product'; end if;
    if not exists (select 1 from jsonb_array_elements(v_order.items) x where (x->>'id')::bigint=p_product_id and (p_variant_id is null or nullif(x->>'variant_id','')::bigint=p_variant_id)) then raise exception 'Selected product was not found in this order'; end if;
    select s.seller_id into v_seller from public.seller_product_submissions s where s.approved_product_id=p_product_id and s.status='approved' order by s.reviewed_at desc nulls last,s.id desc limit 1;
    if v_seller is null then raise exception 'This product is not linked to an active marketplace seller'; end if;
    if not exists (select 1 from public.seller_profiles sp where sp.user_id=v_seller and sp.status='active') then raise exception 'Seller support is currently unavailable for this product'; end if;
  end if;

  select * into v_existing from public.support_tickets t
   where t.customer_id=v_uid and t.channel=p_channel and coalesce(t.order_id,0)=coalesce(p_order_id,0)
     and coalesce(t.product_id,0)=coalesce(p_product_id,0) and lower(t.issue_type)=lower(btrim(p_issue_type)) and t.status<>'closed'
   order by t.created_at desc limit 1;
  if found then return v_existing; end if;

  insert into public.support_tickets(channel,customer_id,order_id,product_id,variant_id,seller_id,issue_type,subject,status,support_mode)
  values(p_channel,v_uid,p_order_id,p_product_id,p_variant_id,v_seller,btrim(p_issue_type),btrim(p_subject),case when p_channel='seller_support' then 'waiting_seller' else 'open' end,case when p_channel='customer_support' then 'bot' else 'human' end)
  returning * into v_ticket;
  insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
  values(v_ticket.id,v_uid,'customer',btrim(p_message),'web');
  if p_channel='customer_support' then
    perform public.support_bot_process_customer_message(v_ticket.id,p_message);
    select * into v_ticket from public.support_tickets where id=v_ticket.id;
  end if;
  return v_ticket;
end;
$function$;

create or replace function public.send_support_ticket_message(p_ticket_id bigint, p_message text)
returns public.support_ticket_messages
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid:=auth.uid();
  v_ticket public.support_tickets;
  v_role text;
  v_row public.support_ticket_messages;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_message,''))) not between 1 and 5000 then raise exception 'Message is required'; end if;
  if not public.consume_api_rate_limit(v_uid::text,'support_ticket_message',30,60) then raise exception 'Too many support messages. Please wait a moment.'; end if;
  select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_ticket.status='closed' then raise exception 'This ticket is closed. Reopen it before replying.'; end if;

  if v_ticket.customer_id=v_uid then
    v_role:='customer';
  elsif public.is_owner_user(v_uid) then
    v_role:='admin';
  elsif v_ticket.channel='customer_support' and public.is_customer_care_user(v_uid) then
    v_role:='customer_care';
  elsif v_ticket.channel='seller_support' and v_ticket.seller_id=v_uid and exists(select 1 from public.seller_profiles s where s.user_id=v_uid and s.status='active') then
    v_role:='seller';
  else
    raise exception 'You do not have permission to reply to this ticket';
  end if;

  insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
  values(v_ticket.id,v_uid,v_role,btrim(p_message),'web') returning * into v_row;

  if v_role='customer' and v_ticket.channel='customer_support' and v_ticket.support_mode='bot' then
    perform public.support_bot_process_customer_message(v_ticket.id,p_message);
  else
    update public.support_tickets
       set status=case when v_role='customer' then case when channel='seller_support' then 'waiting_seller' else 'waiting_admin' end else 'waiting_customer' end,
           support_mode=case when channel='customer_support' and v_role in ('admin','customer_care') then 'human' else support_mode end,
           live_agent_joined_at=case when channel='customer_support' and v_role in ('admin','customer_care') then coalesce(live_agent_joined_at,now()) else live_agent_joined_at end,
           updated_at=now()
     where id=v_ticket.id;
  end if;
  return v_row;
end;
$function$;

revoke execute on function public.support_message_requests_human(text) from public,anon,authenticated;
revoke execute on function public.support_bot_make_reply(bigint,text) from public,anon,authenticated;
revoke execute on function public.support_bot_process_customer_message(bigint,text) from public,anon,authenticated;
revoke execute on function public.request_live_support_agent(bigint) from public,anon;
grant execute on function public.request_live_support_agent(bigint) to authenticated;
revoke execute on function public.create_support_ticket(text,bigint,bigint,bigint,text,text,text) from public,anon;
grant execute on function public.create_support_ticket(text,bigint,bigint,bigint,text,text,text) to authenticated;
revoke execute on function public.send_support_ticket_message(bigint,text) from public,anon;
grant execute on function public.send_support_ticket_message(bigint,text) to authenticated;
-- END RECOVERED 20260928143521

-- BEGIN RECOVERED 20260928144259_support_bot_existing_ticket_message
create or replace function public.create_support_ticket(p_channel text,p_order_id bigint,p_product_id bigint,p_variant_id bigint,p_issue_type text,p_subject text,p_message text)
returns public.support_tickets language plpgsql security definer set search_path='pg_catalog','public'
as $function$
declare v_uid uuid:=auth.uid(); v_order public.orders; v_seller uuid; v_ticket public.support_tickets; v_existing public.support_tickets;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_channel not in ('customer_support','seller_support') then raise exception 'Invalid support channel'; end if;
  if char_length(btrim(coalesce(p_issue_type,''))) not between 2 and 80 then raise exception 'Issue type is required'; end if;
  if char_length(btrim(coalesce(p_subject,''))) not between 3 and 180 then raise exception 'Subject must be 3 to 180 characters'; end if;
  if char_length(btrim(coalesce(p_message,''))) not between 1 and 5000 then raise exception 'Message is required'; end if;
  if not public.consume_api_rate_limit(v_uid::text,'support_ticket_create',5,3600) then raise exception 'Too many support tickets. Please wait before creating another ticket.'; end if;
  if p_order_id is not null then select * into v_order from public.orders where id=p_order_id and user_id=v_uid; if not found then raise exception 'Order not found for this customer'; end if; end if;
  if p_channel='seller_support' then
    if p_order_id is null or p_product_id is null then raise exception 'Seller support requires an order and purchased product'; end if;
    if not exists(select 1 from jsonb_array_elements(v_order.items) x where (x->>'id')::bigint=p_product_id and (p_variant_id is null or nullif(x->>'variant_id','')::bigint=p_variant_id)) then raise exception 'Selected product was not found in this order'; end if;
    select s.seller_id into v_seller from public.seller_product_submissions s where s.approved_product_id=p_product_id and s.status='approved' order by s.reviewed_at desc nulls last,s.id desc limit 1;
    if v_seller is null then raise exception 'This product is not linked to an active marketplace seller'; end if;
    if not exists(select 1 from public.seller_profiles sp where sp.user_id=v_seller and sp.status='active') then raise exception 'Seller support is currently unavailable for this product'; end if;
  end if;
  select * into v_existing from public.support_tickets t where t.customer_id=v_uid and t.channel=p_channel and coalesce(t.order_id,0)=coalesce(p_order_id,0) and coalesce(t.product_id,0)=coalesce(p_product_id,0) and lower(t.issue_type)=lower(btrim(p_issue_type)) and t.status<>'closed' order by t.created_at desc limit 1;
  if found then
    insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source) values(v_existing.id,v_uid,'customer',btrim(p_message),'web');
    if p_channel='customer_support' and v_existing.support_mode='bot' then perform public.support_bot_process_customer_message(v_existing.id,p_message);
    else update public.support_tickets set status=case when p_channel='seller_support' then 'waiting_seller' else 'waiting_admin' end,updated_at=now() where id=v_existing.id; end if;
    select * into v_existing from public.support_tickets where id=v_existing.id;
    return v_existing;
  end if;
  insert into public.support_tickets(channel,customer_id,order_id,product_id,variant_id,seller_id,issue_type,subject,status,support_mode) values(p_channel,v_uid,p_order_id,p_product_id,p_variant_id,v_seller,btrim(p_issue_type),btrim(p_subject),case when p_channel='seller_support' then 'waiting_seller' else 'open' end,case when p_channel='customer_support' then 'bot' else 'human' end) returning * into v_ticket;
  insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source) values(v_ticket.id,v_uid,'customer',btrim(p_message),'web');
  if p_channel='customer_support' then perform public.support_bot_process_customer_message(v_ticket.id,p_message); select * into v_ticket from public.support_tickets where id=v_ticket.id; end if;
  return v_ticket;
end;
$function$;

revoke execute on function public.create_support_ticket(text,bigint,bigint,bigint,text,text,text) from public,anon;
grant execute on function public.create_support_ticket(text,bigint,bigint,bigint,text,text,text) to authenticated;
-- END RECOVERED 20260928144259

-- BEGIN RECOVERED 20260928174033_payment_recovery_email_notifications
create table if not exists public.payment_recovery_notifications (
  id bigint generated by default as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  user_id uuid not null,
  payment_id text not null,
  event_type text not null default 'payment_failed',
  recipient_email text not null,
  provider text not null default 'zoho_mail',
  status text not null default 'pending',
  provider_message_id text,
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  constraint payment_recovery_notifications_event_check check (event_type in ('payment_failed')),
  constraint payment_recovery_notifications_provider_check check (provider in ('zoho_mail')),
  constraint payment_recovery_notifications_status_check check (status in ('pending','sent','failed')),
  constraint payment_recovery_notifications_attempt_count_check check (attempt_count >= 0),
  constraint payment_recovery_notifications_identity_key unique (event_type, payment_id)
);

create index if not exists payment_recovery_notifications_status_idx
  on public.payment_recovery_notifications(status, created_at desc);

alter table public.payment_recovery_notifications enable row level security;

revoke all on table public.payment_recovery_notifications from public, anon, authenticated;
grant select, insert, update on table public.payment_recovery_notifications to service_role;
grant usage, select on sequence public.payment_recovery_notifications_id_seq to service_role;
-- END RECOVERED 20260928174033

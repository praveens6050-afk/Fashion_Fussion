-- Add a dedicated Orders CRM role and include the orders mailbox in the scoped inbox.
ALTER TABLE public.crm_team_members
  DROP CONSTRAINT crm_team_members_role_check;
ALTER TABLE public.crm_team_members
  ADD CONSTRAINT crm_team_members_role_check
  CHECK (role = ANY (ARRAY['customer_support','seller_support','sales','marketing','orders']::text[]));

ALTER TABLE public.crm_inbox_conversations
  DROP CONSTRAINT crm_inbox_conversations_department_check;
ALTER TABLE public.crm_inbox_conversations
  ADD CONSTRAINT crm_inbox_conversations_department_check
  CHECK (department = ANY (ARRAY['customer_support','seller_support','sales','marketing','orders']::text[]));

CREATE OR REPLACE FUNCTION public.crm_ingest_inbound_message(p_provider text, p_provider_message_id text, p_sender_phone text, p_sender_email text, p_sender_name text, p_inbox_address text, p_subject text, p_body text, p_provider_thread_id text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare v_department text:='customer_support'; v_contact_type text:='unknown'; v_contact_user uuid; v_phone text; v_email text; v_id bigint; v_inbox text; v_message_id bigint;
begin
 if p_provider not in ('whatsapp','email') or nullif(trim(p_provider_message_id),'') is null or nullif(trim(p_body),'') is null then
   raise exception 'Invalid inbound message' using errcode='22023';
 end if;
 v_inbox:=lower(trim(coalesce(p_inbox_address,'')));
 v_phone:=nullif(regexp_replace(coalesce(p_sender_phone,''),'[^0-9]','','g'),'');
 v_email:=nullif(lower(trim(coalesce(p_sender_email,''))),'');
 if p_provider='email' then
   if v_inbox='orders@fashionfussion.in' then v_department:='orders'; v_contact_type:='customer';
   elsif v_inbox in ('seller.support@fashionfussion.in','seller-support@fashionfussion.in','sellerhelp@fashionfussion.in') then v_department:='seller_support'; v_contact_type:='seller';
   elsif v_inbox in ('sales.team@fashionfussion.in','sales@fashionfussion.in','wholesale@fashionfussion.in','b2b@fashionfussion.in') then v_department:='sales'; v_contact_type:='prospect';
   elsif v_inbox in ('marketing@fashionfussion.in','campaigns@fashionfussion.in') then v_department:='marketing'; v_contact_type:='prospect';
   else v_department:='customer_support'; end if;
 else
   if p_metadata->>'route_department' in ('sales','marketing') then v_department:=p_metadata->>'route_department'; v_contact_type:='prospect';
   elsif v_phone is not null and exists(select 1 from public.seller_profiles s where regexp_replace(coalesce(s.phone,''),'[^0-9]','','g')=v_phone) then
     v_department:='seller_support'; v_contact_type:='seller';
     select s.user_id into v_contact_user from public.seller_profiles s where regexp_replace(coalesce(s.phone,''),'[^0-9]','','g')=v_phone limit 1;
   else
     v_department:='customer_support'; v_contact_type:='customer';
     if v_phone is not null then select p.id into v_contact_user from public.profiles p where regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')=v_phone limit 1; end if;
   end if;
 end if;
 if v_contact_user is null and v_email is not null then select u.id into v_contact_user from auth.users u where lower(u.email)=v_email limit 1; end if;
 -- Continue an existing provider thread instead of opening a new CRM conversation for every reply.
 if nullif(trim(coalesce(p_provider_thread_id,'')),'') is not null then
   select c.id into v_id from public.crm_inbox_conversations c
   where c.provider=p_provider and c.provider_thread_id=p_provider_thread_id
   order by c.updated_at desc limit 1;
   if v_id is not null then
     -- Record the unique provider event first. Replayed webhooks must not refresh
     -- last_inbound_at, otherwise an old WhatsApp message could reopen the 24-hour window.
     insert into public.crm_inbox_messages(conversation_id,provider_message_id,direction,sender_label,body,metadata,delivery_status)
     values(v_id,p_provider_message_id,'inbound',coalesce(nullif(trim(p_sender_name),''),v_email,v_phone,'External contact'),left(p_body,10000),coalesce(p_metadata,'{}'::jsonb),'received')
     on conflict(provider_message_id,direction) do nothing returning id into v_message_id;
     if v_message_id is null then return v_id; end if;
     update public.crm_inbox_conversations set latest_message=left(p_body,10000),received_at=now(),last_inbound_at=now(),updated_at=now(),
       subject=coalesce(nullif(trim(p_subject),''),subject),
       contact_name=coalesce(nullif(trim(p_sender_name),''),contact_name),
       contact_email=coalesce(v_email,contact_email),contact_phone=coalesce(v_phone,contact_phone),
       metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),status='open'
     where id=v_id;
     return v_id;
   end if;
 end if;
 insert into public.crm_inbox_conversations(provider,provider_thread_id,provider_message_id,department,contact_type,contact_user_id,contact_name,contact_email,contact_phone,inbox_address,subject,latest_message,received_at,last_inbound_at,metadata)
 values(p_provider,p_provider_thread_id,p_provider_message_id,v_department,v_contact_type,v_contact_user,nullif(trim(p_sender_name),''),v_email,v_phone,p_inbox_address,p_subject,left(p_body,10000),now(),now(),coalesce(p_metadata,'{}'::jsonb))
 on conflict(provider,provider_message_id) do nothing returning id into v_id;
 if v_id is null then select c.id into v_id from public.crm_inbox_conversations c where c.provider=p_provider and c.provider_message_id=p_provider_message_id; return v_id; end if;
 insert into public.crm_inbox_messages(conversation_id,provider_message_id,direction,sender_label,body,metadata,delivery_status)
 values(v_id,p_provider_message_id,'inbound',coalesce(nullif(trim(p_sender_name),''),v_email,v_phone,'External contact'),left(p_body,10000),coalesce(p_metadata,'{}'::jsonb),'received')
 on conflict(provider_message_id,direction) do nothing;
 return v_id;
end $function$
;

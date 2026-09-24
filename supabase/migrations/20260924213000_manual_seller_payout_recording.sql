alter table public.seller_settlements add column if not exists manual_payment_method text;
alter table public.seller_settlements add column if not exists manual_payment_reference text;
alter table public.seller_settlements add column if not exists manual_recorded_at timestamptz;

do $$ begin
  alter table public.seller_settlements add constraint seller_settlements_manual_payment_method_check check (manual_payment_method is null or manual_payment_method in ('bank_transfer','upi','neft','imps','rtgs','other'));
exception when duplicate_object then null; end $$;

create unique index if not exists seller_settlements_manual_payment_reference_uq
  on public.seller_settlements (lower(manual_payment_reference))
  where manual_payment_reference is not null;

create or replace function public.admin_record_manual_seller_payout(
  p_settlement_id bigint,
  p_payment_method text,
  p_payment_reference text,
  p_paid_at timestamptz default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_set public.seller_settlements%rowtype;
  v_method text:=lower(trim(coalesce(p_payment_method,'')));
  v_ref text:=nullif(trim(coalesce(p_payment_reference,'')),'');
  v_note text:=nullif(trim(coalesce(p_note,'')),'');
  v_paid_at timestamptz:=coalesce(p_paid_at,now());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if p_settlement_id is null or p_settlement_id < 1 then raise exception 'Invalid settlement ID'; end if;
  if v_method not in ('bank_transfer','upi','neft','imps','rtgs','other') then raise exception 'Invalid manual payment method'; end if;
  if v_ref is null or length(v_ref) < 4 or length(v_ref) > 120 then raise exception 'Valid UTR / payment reference is required'; end if;
  if v_paid_at > now() + interval '5 minutes' then raise exception 'Paid time cannot be in the future'; end if;

  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=v_set.seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
  if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=v_set.seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;

  if v_set.status='paid' then
    if lower(coalesce(v_set.manual_payment_reference,''))=lower(v_ref) and coalesce(v_set.manual_payment_method,'')=v_method then
      return jsonb_build_object('ok',true,'already_paid',true,'id',v_set.id,'status',v_set.status,'manual_payment_method',v_set.manual_payment_method,'manual_payment_reference',v_set.manual_payment_reference,'paid_at',v_set.paid_at);
    end if;
    raise exception 'Settlement is already paid with a different payment record';
  end if;

  if exists(select 1 from public.seller_settlements s where s.id<>v_set.id and lower(coalesce(s.manual_payment_reference,''))=lower(v_ref)) then
    raise exception 'This payment reference is already used by another settlement';
  end if;

  if v_set.provider_payout_ref is not null and lower(coalesce(v_set.provider_status,'')) not in ('failed','rejected','cancelled','reversed') then
    raise exception 'A provider payout already exists for this settlement';
  end if;
  if v_set.status not in ('pending','processing','failed','held') then raise exception 'Settlement is not payable'; end if;
  if v_set.net_amount <= 0 then raise exception 'Settlement amount must be positive'; end if;

  update public.seller_settlements set
    status='paid', paid_at=v_paid_at, manual_payment_method=v_method,
    manual_payment_reference=v_ref, manual_recorded_at=now(), failure_reason=null,
    updated_by=v_uid, updated_at=now()
  where id=v_set.id;

  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,'paid',coalesce(v_note,'Manual payout recorded')||' · '||upper(replace(v_method,'_',' '))||' · ref …'||right(v_ref,6),v_uid);

  return (select jsonb_build_object('ok',true,'already_paid',false,'id',s.id,'seller_id',s.seller_id,'net_amount',s.net_amount,'currency',s.currency,'status',s.status,'manual_payment_method',s.manual_payment_method,'manual_payment_reference',s.manual_payment_reference,'paid_at',s.paid_at,'manual_recorded_at',s.manual_recorded_at) from public.seller_settlements s where s.id=v_set.id);
end $$;

revoke all on function public.admin_record_manual_seller_payout(bigint,text,text,timestamptz,text) from public,anon;
grant execute on function public.admin_record_manual_seller_payout(bigint,text,text,timestamptz,text) to authenticated;

create or replace function public.admin_upsert_seller_settlement(p_seller_id uuid,p_settlement_id bigint,p_period_start date,p_period_end date,p_gross_amount numeric,p_fees_amount numeric,p_refunds_amount numeric,p_status text,p_provider_payout_ref text default null,p_failure_reason text default null,p_note text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_uid uuid:=auth.uid();v_status text:=lower(trim(coalesce(p_status,'')));v_ref text:=nullif(trim(coalesce(p_provider_payout_ref,'')),'');v_failure text:=nullif(trim(coalesce(p_failure_reason,'')),'');v_note text:=nullif(trim(coalesce(p_note,'')),'');v_id bigint;v_old_status text;v_net numeric(14,2);v_now timestamptz:=now();
begin
 if v_uid is null then raise exception 'Authentication required'; end if;if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;if not exists(select 1 from public.seller_profiles s where s.user_id=p_seller_id) then raise exception 'Seller not found'; end if;if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=p_seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=p_seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Invalid settlement period'; end if;if coalesce(p_gross_amount,-1)<0 or coalesce(p_fees_amount,-1)<0 or coalesce(p_refunds_amount,-1)<0 then raise exception 'Settlement amounts must be non-negative'; end if;v_net:=round((p_gross_amount-p_fees_amount-p_refunds_amount)::numeric,2);if v_net<0 then raise exception 'Settlement net amount cannot be negative'; end if;if v_status not in ('pending','processing','failed','held') then raise exception 'Invalid settlement status. Use manual payout recording to mark a settlement paid.'; end if;if v_status='failed' and v_failure is null then raise exception 'Failure reason is required'; end if;
 if p_settlement_id is null then insert into public.seller_settlements(seller_id,period_start,period_end,gross_amount,fees_amount,refunds_amount,net_amount,currency,status,provider_payout_ref,failure_reason,paid_at,created_by,updated_by,created_at,updated_at) values(p_seller_id,p_period_start,p_period_end,round(p_gross_amount,2),round(p_fees_amount,2),round(p_refunds_amount,2),v_net,'INR',v_status,v_ref,case when v_status='failed' then v_failure else null end,null,v_uid,v_uid,v_now,v_now) returning id into v_id;else select status into v_old_status from public.seller_settlements where id=p_settlement_id and seller_id=p_seller_id for update;if v_old_status is null then raise exception 'Settlement not found'; end if;if v_old_status='paid' then raise exception 'Paid settlements are immutable'; end if;update public.seller_settlements set period_start=p_period_start,period_end=p_period_end,gross_amount=round(p_gross_amount,2),fees_amount=round(p_fees_amount,2),refunds_amount=round(p_refunds_amount,2),net_amount=v_net,status=v_status,provider_payout_ref=v_ref,failure_reason=case when v_status='failed' then v_failure else null end,paid_at=null,updated_by=v_uid,updated_at=v_now where id=p_settlement_id and seller_id=p_seller_id returning id into v_id;end if;
 insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id) values(v_id,p_seller_id,v_old_status,v_status,v_note,v_uid);return(select jsonb_build_object('id',s.id,'seller_id',s.seller_id,'period_start',s.period_start,'period_end',s.period_end,'gross_amount',s.gross_amount,'fees_amount',s.fees_amount,'refunds_amount',s.refunds_amount,'net_amount',s.net_amount,'currency',s.currency,'status',s.status,'failure_reason',s.failure_reason,'paid_at',s.paid_at,'created_at',s.created_at,'updated_at',s.updated_at) from public.seller_settlements s where s.id=v_id);
end $$;

create or replace function public.admin_list_seller_finance_reviews(p_status text default null,p_search text default null,p_limit integer default 100,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_uid uuid:=auth.uid();v_status text:=nullif(trim(coalesce(p_status,'')),'');v_search text:=nullif(trim(coalesce(p_search,'')),'');v_limit integer:=least(greatest(coalesce(p_limit,100),1),200);v_offset integer:=greatest(coalesce(p_offset,0),0);v_result jsonb;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
 select coalesce(jsonb_agg(item order by submitted_sort asc,created_sort desc),'[]'::jsonb) into v_result from (
  select jsonb_build_object('seller_id',s.user_id,'seller_code',s.seller_code,'store_name',s.store_name,'seller_type',s.seller_type,'seller_status',s.status,'email',u.email,'phone',s.phone,
   'compliance',case when c.seller_id is null then '{}'::jsonb else jsonb_build_object('legal_name',c.legal_name,'trade_name',c.trade_name,'entity_type',c.entity_type,'primary_category',c.primary_category,'gst_registered',c.gst_registered,'pan_last4',c.pan_last4,'gstin_last4',c.gstin_last4,'verification_status',c.verification_status,'rejection_reason',c.rejection_reason,'submitted_at',c.submitted_at,'reviewed_at',c.reviewed_at,'updated_at',c.updated_at) end,
   'payout',case when pp.seller_id is null then '{}'::jsonb else jsonb_build_object('account_holder_name',pp.account_holder_name,'bank_name',pp.bank_name,'ifsc',pp.ifsc,'account_number_last4',pp.account_number_last4,'account_type',pp.account_type,'verification_status',pp.verification_status,'rejection_reason',pp.rejection_reason,'reviewed_at',pp.reviewed_at,'updated_at',pp.updated_at) end,
   'pickup_locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,'contact_name',l.contact_name,'phone',l.phone,'line1',l.line1,'line2',l.line2,'city',l.city,'state',l.state,'pincode',l.pincode,'landmark',l.landmark,'is_default',l.is_default,'is_active',l.is_active) order by l.is_default desc,l.updated_at desc) from public.seller_pickup_locations l where l.seller_id=s.user_id and l.is_active),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'period_start',st.period_start,'period_end',st.period_end,'gross_amount',st.gross_amount,'fees_amount',st.fees_amount,'refunds_amount',st.refunds_amount,'net_amount',st.net_amount,'currency',st.currency,'status',st.status,'failure_reason',st.failure_reason,'paid_at',st.paid_at,'manual_payment_method',st.manual_payment_method,'manual_payment_reference',st.manual_payment_reference,'manual_recorded_at',st.manual_recorded_at,'provider_status',st.provider_status,'provider_utr',st.provider_utr,'created_at',st.created_at,'updated_at',st.updated_at) order by st.period_end desc,st.id desc) from public.seller_settlements st where st.seller_id=s.user_id),'[]'::jsonb),
   'recent_reviews',coalesce((select jsonb_agg(jsonb_build_object('scope',e.review_scope,'decision',e.decision,'reason',e.reason,'created_at',e.created_at) order by e.created_at desc) from (select * from public.seller_finance_review_events x where x.seller_id=s.user_id order by x.created_at desc limit 8)e),'[]'::jsonb)) item,
   coalesce(c.submitted_at,'9999-12-31'::timestamptz) submitted_sort,s.created_at created_sort
  from public.seller_profiles s join auth.users u on u.id=s.user_id left join public.seller_compliance_profiles c on c.seller_id=s.user_id left join public.seller_payout_profiles pp on pp.seller_id=s.user_id
  where (v_status is null or c.verification_status=v_status or pp.verification_status=v_status) and (v_search is null or s.seller_code ilike '%'||v_search||'%' or s.store_name ilike '%'||v_search||'%' or coalesce(u.email,'') ilike '%'||v_search||'%' or coalesce(c.legal_name,'') ilike '%'||v_search||'%')
  order by submitted_sort asc,created_sort desc limit v_limit offset v_offset
 )q;return v_result;
end $$;

revoke all on function public.admin_upsert_seller_settlement(uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text) from public;
grant execute on function public.admin_upsert_seller_settlement(uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text) to authenticated;
revoke all on function public.admin_list_seller_finance_reviews(text,text,integer,integer) from public;
grant execute on function public.admin_list_seller_finance_reviews(text,text,integer,integer) to authenticated;

create or replace function public.admin_prepare_seller_payout(p_settlement_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_set public.seller_settlements%rowtype;
  v_pay public.seller_payout_profiles%rowtype;
  v_key text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  if v_set.status='paid' then
    return jsonb_build_object('already_paid',true,'settlement_id',v_set.id,'provider_payout_ref',v_set.provider_payout_ref,'provider_status',v_set.provider_status,'provider_utr',v_set.provider_utr);
  end if;
  if v_set.status not in ('pending','failed','held','processing') then raise exception 'Settlement is not payable'; end if;
  if v_set.net_amount<=0 then raise exception 'Settlement amount must be positive'; end if;
  if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=v_set.seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
  select * into v_pay from public.seller_payout_profiles p where p.seller_id=v_set.seller_id;
  if v_pay.seller_id is null or v_pay.verification_status<>'verified' then raise exception 'Verified payout account required'; end if;
  if v_pay.provider_fund_account_ref is null then raise exception 'Provider fund account is not linked'; end if;
  v_key:=coalesce(v_set.payout_idempotency_key,'ff-settlement-'||v_set.id::text||'-v1');
  update public.seller_settlements
    set payout_idempotency_key=v_key,status='processing',provider_status=coalesce(provider_status,'queued'),updated_by=v_uid,updated_at=now()
    where id=v_set.id;
  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,'processing','Provider payout prepared',v_uid);
  return jsonb_build_object(
    'already_paid',false,'settlement_id',v_set.id,'seller_id',v_set.seller_id,'amount_paise',round(v_set.net_amount*100)::bigint,
    'currency',v_set.currency,'fund_account_id',v_pay.provider_fund_account_ref,'idempotency_key',v_key,
    'payout_mode',coalesce(v_set.payout_mode,'IMPS')
  );
end $$;

create or replace function public.admin_record_seller_payout_result(
  p_settlement_id bigint,p_provider_payout_ref text,p_provider_status text,p_provider_utr text,p_failure_reason text,p_provider_details jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_set public.seller_settlements%rowtype;
  v_status text:=lower(trim(coalesce(p_provider_status,'')));
  v_final text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  v_final:=case when v_status in ('processed','paid') then 'paid' when v_status in ('rejected','failed','cancelled','reversed') then 'failed' else 'processing' end;
  update public.seller_settlements set
    provider_payout_ref=coalesce(nullif(trim(coalesce(p_provider_payout_ref,'')),''),provider_payout_ref),
    provider_status=nullif(v_status,''),provider_utr=nullif(trim(coalesce(p_provider_utr,'')),''),
    provider_status_details=coalesce(p_provider_details,'{}'::jsonb),provider_synced_at=now(),
    failure_reason=case when v_final='failed' then nullif(trim(coalesce(p_failure_reason,'')),'') else null end,
    status=v_final,paid_at=case when v_final='paid' then coalesce(paid_at,now()) else paid_at end,
    updated_by=v_uid,updated_at=now()
    where id=v_set.id;
  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,v_final,'Provider payout status: '||coalesce(nullif(v_status,''),'unknown'),v_uid);
  return (select jsonb_build_object('id',s.id,'status',s.status,'provider_status',s.provider_status,'provider_utr',s.provider_utr,'failure_reason',s.failure_reason,'paid_at',s.paid_at) from public.seller_settlements s where s.id=v_set.id);
end $$;

revoke all on function public.admin_prepare_seller_payout(bigint) from public;
revoke all on function public.admin_record_seller_payout_result(bigint,text,text,text,text,jsonb) from public;
grant execute on function public.admin_prepare_seller_payout(bigint) to authenticated;
grant execute on function public.admin_record_seller_payout_result(bigint,text,text,text,text,jsonb) to authenticated;

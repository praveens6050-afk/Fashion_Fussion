create or replace function public.admin_record_manual_seller_payout(
  p_settlement_id bigint,
  p_payment_method text,
  p_payment_reference text,
  p_payment_reference_confirm text,
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
  v_confirm_ref text:=nullif(trim(coalesce(p_payment_reference_confirm,'')),'');
  v_paid_at timestamptz:=coalesce(p_paid_at,now());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if p_settlement_id is null or p_settlement_id < 1 then raise exception 'Invalid settlement ID'; end if;
  if v_method not in ('neft','imps','rtgs') then raise exception 'Choose NEFT, IMPS or RTGS'; end if;
  if v_ref is null or length(v_ref) < 4 or length(v_ref) > 120 then raise exception 'Valid UTR / payment reference is required'; end if;
  if v_confirm_ref is null then raise exception 'Confirm UTR / payment reference is required'; end if;
  if v_ref <> v_confirm_ref then raise exception 'UTR / payment reference confirmation does not match'; end if;
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
    raise exception 'This UTR / payment reference is already used by another settlement';
  end if;

  if v_set.provider_payout_ref is not null and lower(coalesce(v_set.provider_status,'')) not in ('failed','rejected','cancelled','reversed') then
    raise exception 'A provider payout already exists for this settlement';
  end if;
  if v_set.status not in ('pending','processing','failed','held') then raise exception 'Settlement is not payable'; end if;
  if v_set.net_amount <= 0 then raise exception 'Settlement amount must be positive'; end if;

  update public.seller_settlements set
    status='paid',
    paid_at=v_paid_at,
    manual_payment_method=v_method,
    manual_payment_reference=v_ref,
    manual_recorded_at=now(),
    failure_reason=null,
    updated_by=v_uid,
    updated_at=now()
  where id=v_set.id;

  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,'paid','Manual payout confirmed · '||upper(v_method)||' · ref …'||right(v_ref,6),v_uid);

  return (select jsonb_build_object('ok',true,'already_paid',false,'id',s.id,'seller_id',s.seller_id,'net_amount',s.net_amount,'currency',s.currency,'status',s.status,'manual_payment_method',s.manual_payment_method,'manual_payment_reference',s.manual_payment_reference,'paid_at',s.paid_at,'manual_recorded_at',s.manual_recorded_at) from public.seller_settlements s where s.id=v_set.id);
end $$;

revoke all on function public.admin_record_manual_seller_payout(bigint,text,text,text,timestamptz,text) from public,anon;
grant execute on function public.admin_record_manual_seller_payout(bigint,text,text,text,timestamptz,text) to authenticated;
revoke execute on function public.admin_record_manual_seller_payout(bigint,text,text,timestamptz,text) from authenticated;

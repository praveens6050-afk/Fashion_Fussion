-- Complete audited seller payout review transitions and allow revoking a completed verification.
alter table public.seller_finance_review_events
  drop constraint if exists seller_finance_review_events_decision_check;
alter table public.seller_finance_review_events
  add constraint seller_finance_review_events_decision_check
  check (decision in ('approve','reject','submit_for_review'));

create or replace function public.admin_mark_seller_payout_under_review(
  p_seller_id uuid, p_note text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_old_status text;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  if v_note is null or length(v_note)>500 then
    raise exception 'An internal note of 1 to 500 characters is required';
  end if;
  select verification_status into v_old_status
    from public.seller_payout_profiles where seller_id=p_seller_id for update;
  if not found then raise exception 'Seller payout profile not found'; end if;
  if v_old_status<>'draft' then raise exception 'Only Draft payout accounts can be moved to Under Verification'; end if;
  update public.seller_payout_profiles
    set verification_status='pending_review',rejection_reason=null,reviewed_at=null,reviewed_by=null,updated_at=v_now
    where seller_id=p_seller_id;
  insert into public.seller_finance_review_events(seller_id,review_scope,decision,reason,reviewer_id)
    values(p_seller_id,'payout','submit_for_review',v_note,v_uid);
  return jsonb_build_object('ok',true,'seller_id',p_seller_id,'old_status',v_old_status,'new_status','pending_review','updated_at',v_now);
end;
$$;

create or replace function public.admin_revoke_seller_finance_verification(
  p_seller_id uuid, p_scope text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope,'')));
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_kyc_status text;
  v_payout_status text;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  if v_scope not in ('kyc','payout','both') then raise exception 'Invalid review scope'; end if;
  if v_reason is null or length(v_reason)>500 then
    raise exception 'A reason of 1 to 500 characters is required';
  end if;
  if not exists(select 1 from public.seller_profiles s where s.user_id=p_seller_id) then
    raise exception 'Seller not found';
  end if;
  if v_scope in ('kyc','both') then
    select verification_status into v_kyc_status
      from public.seller_compliance_profiles where seller_id=p_seller_id for update;
    if not found then raise exception 'Seller KYC profile not found'; end if;
    if v_kyc_status<>'verified' then raise exception 'KYC is not currently verified'; end if;
    update public.seller_compliance_profiles
      set verification_status='rejected',rejection_reason=v_reason,reviewed_at=v_now,reviewed_by=v_uid,updated_at=v_now
      where seller_id=p_seller_id;
  end if;
  if v_scope in ('payout','both') then
    select verification_status into v_payout_status
      from public.seller_payout_profiles where seller_id=p_seller_id for update;
    if not found then raise exception 'Seller payout profile not found'; end if;
    if v_payout_status<>'verified' then raise exception 'Payout account is not currently verified'; end if;
    update public.seller_payout_profiles
      set verification_status='rejected',rejection_reason=v_reason,reviewed_at=v_now,reviewed_by=v_uid,updated_at=v_now
      where seller_id=p_seller_id;
  end if;
  insert into public.seller_finance_review_events(seller_id,review_scope,decision,reason,reviewer_id)
    values(p_seller_id,v_scope,'reject',v_reason,v_uid);
  return jsonb_build_object('ok',true,'seller_id',p_seller_id,'scope',v_scope,'new_status','rejected','reviewed_at',v_now);
end;
$$;

revoke all on function public.admin_mark_seller_payout_under_review(uuid,text) from public,anon;
grant execute on function public.admin_mark_seller_payout_under_review(uuid,text) to authenticated;
revoke all on function public.admin_revoke_seller_finance_verification(uuid,text,text) from public,anon;
grant execute on function public.admin_revoke_seller_finance_verification(uuid,text,text) to authenticated;

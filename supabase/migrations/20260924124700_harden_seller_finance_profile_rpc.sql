create or replace function public.get_seller_finance_profile() returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'compliance', coalesce((select to_jsonb(c) - 'seller_id' - 'reviewed_by' from public.seller_compliance_profiles c where c.seller_id=auth.uid()), '{}'::jsonb),
    'payout', coalesce((select (to_jsonb(p) - 'seller_id' - 'provider_fund_account_ref' - 'provider_contact_ref' - 'provider_last_error' - 'reviewed_by') || jsonb_build_object('provider_linked', p.provider_fund_account_ref is not null) from public.seller_payout_profiles p where p.seller_id=auth.uid()), '{}'::jsonb),
    'pickup_locations', coalesce((select jsonb_agg(to_jsonb(l) - 'seller_id' order by l.is_default desc,l.updated_at desc) from public.seller_pickup_locations l where l.seller_id=auth.uid() and l.is_active), '[]'::jsonb),
    'settlements', coalesce((select jsonb_agg((to_jsonb(s) - 'seller_id' - 'provider_payout_ref' - 'payout_idempotency_key' - 'provider_status_details' - 'created_by' - 'updated_by') order by s.period_end desc,s.id desc) from public.seller_settlements s where s.seller_id=auth.uid()), '[]'::jsonb)
  )
$$;

create or replace function public.save_seller_compliance_profile(
  p_legal_name text,p_trade_name text,p_entity_type text,p_primary_category text,p_gst_registered boolean,p_pan text,p_gstin text,
  p_account_holder_name text,p_bank_name text,p_ifsc text,p_account_number text,p_account_type text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_seller uuid:=auth.uid();
  v_pan text:=upper(regexp_replace(coalesce(p_pan,''),'[^A-Za-z0-9]','','g'));
  v_gstin text:=upper(regexp_replace(coalesce(p_gstin,''),'[^A-Za-z0-9]','','g'));
  v_account text:=regexp_replace(coalesce(p_account_number,''),'[^0-9]','','g');
  v_ifsc text:=upper(trim(coalesce(p_ifsc,'')));
  v_old_c public.seller_compliance_profiles%rowtype;
  v_old_p public.seller_payout_profiles%rowtype;
  v_pan_last4 text;
  v_gstin_last4 text;
  v_account_last4 text;
  v_identity_changed boolean:=false;
  v_payout_changed boolean:=false;
begin
  if v_seller is null or not exists(select 1 from public.seller_profiles where user_id=v_seller and status='active') then raise exception 'Active seller account required'; end if;
  select * into v_old_c from public.seller_compliance_profiles where seller_id=v_seller;
  select * into v_old_p from public.seller_payout_profiles where seller_id=v_seller;
  if nullif(trim(coalesce(p_legal_name,'')),'') is null then raise exception 'Legal name is required'; end if;
  if coalesce(p_entity_type,'') not in ('individual','business','manufacturer','wholesaler') then raise exception 'Invalid entity type'; end if;
  if v_pan<>'' and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'Invalid PAN format'; end if;
  v_pan_last4:=case when v_pan<>'' then right(v_pan,4) else v_old_c.pan_last4 end;
  if v_pan_last4 is null then raise exception 'PAN is required'; end if;
  if coalesce(p_gst_registered,false) then
    if v_gstin<>'' and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'Invalid GSTIN format'; end if;
    v_gstin_last4:=case when v_gstin<>'' then right(v_gstin,4) else v_old_c.gstin_last4 end;
    if v_gstin_last4 is null then raise exception 'Valid GSTIN is required'; end if;
  else v_gstin_last4:=null; end if;
  v_identity_changed:=v_old_c.seller_id is not null and (
    trim(coalesce(v_old_c.legal_name,''))<>trim(coalesce(p_legal_name,'')) or
    coalesce(v_old_c.entity_type,'')<>coalesce(p_entity_type,'') or
    coalesce(v_old_c.gst_registered,false)<>coalesce(p_gst_registered,false) or
    coalesce(v_old_c.pan_last4,'')<>coalesce(v_pan_last4,'') or
    coalesce(v_old_c.gstin_last4,'')<>coalesce(v_gstin_last4,'')
  );

  insert into public.seller_compliance_profiles(seller_id,legal_name,trade_name,entity_type,primary_category,gst_registered,pan_last4,gstin_last4,verification_status,rejection_reason,reviewed_at,reviewed_by,updated_at)
  values(v_seller,trim(p_legal_name),nullif(trim(p_trade_name),''),p_entity_type,nullif(trim(p_primary_category),''),coalesce(p_gst_registered,false),v_pan_last4,v_gstin_last4,'draft',null,null,null,now())
  on conflict(seller_id) do update set legal_name=excluded.legal_name,trade_name=excluded.trade_name,entity_type=excluded.entity_type,primary_category=excluded.primary_category,gst_registered=excluded.gst_registered,pan_last4=excluded.pan_last4,gstin_last4=excluded.gstin_last4,verification_status=case when not v_identity_changed and seller_compliance_profiles.verification_status='verified' then 'verified' else 'draft' end,rejection_reason=null,reviewed_at=case when not v_identity_changed and seller_compliance_profiles.verification_status='verified' then seller_compliance_profiles.reviewed_at else null end,reviewed_by=case when not v_identity_changed and seller_compliance_profiles.verification_status='verified' then seller_compliance_profiles.reviewed_by else null end,updated_at=now();

  if nullif(trim(coalesce(p_account_holder_name,'')),'') is not null or nullif(trim(coalesce(p_bank_name,'')),'') is not null or v_ifsc<>'' or v_account<>'' or v_old_p.seller_id is not null then
    if nullif(trim(coalesce(p_account_holder_name,'')),'') is null or nullif(trim(coalesce(p_bank_name,'')),'') is null then raise exception 'Complete payout account details'; end if;
    if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Invalid IFSC format'; end if;
    if coalesce(p_account_type,'') not in ('current','savings') then raise exception 'Invalid account type'; end if;
    if v_account<>'' and v_account !~ '^[0-9]{9,18}$' then raise exception 'Invalid bank account number'; end if;
    if v_old_p.seller_id is null and v_account='' then raise exception 'Bank account number is required'; end if;
    v_account_last4:=case when v_account<>'' then right(v_account,4) else v_old_p.account_number_last4 end;
    v_payout_changed:=v_old_p.seller_id is not null and (
      trim(coalesce(v_old_p.account_holder_name,''))<>trim(coalesce(p_account_holder_name,'')) or
      upper(trim(coalesce(v_old_p.ifsc,'')))<>v_ifsc or
      coalesce(v_old_p.account_type,'')<>coalesce(p_account_type,'') or
      (v_account<>'' and coalesce(v_old_p.account_number_last4,'')<>right(v_account,4))
    );
    if v_payout_changed and v_account='' then raise exception 'Re-enter the full bank account number when changing payout details'; end if;
    insert into public.seller_payout_profiles(seller_id,account_holder_name,bank_name,ifsc,account_number_last4,account_type,provider_name,provider_contact_ref,provider_fund_account_ref,provider_tokenized_at,provider_last_error,verification_status,rejection_reason,reviewed_at,reviewed_by,updated_at)
    values(v_seller,trim(p_account_holder_name),trim(p_bank_name),v_ifsc,v_account_last4,p_account_type,null,null,null,null,null,'draft',null,null,null,now())
    on conflict(seller_id) do update set account_holder_name=excluded.account_holder_name,bank_name=excluded.bank_name,ifsc=excluded.ifsc,account_number_last4=excluded.account_number_last4,account_type=excluded.account_type,
      provider_name=case when v_payout_changed then null else seller_payout_profiles.provider_name end,
      provider_contact_ref=case when v_payout_changed then null else seller_payout_profiles.provider_contact_ref end,
      provider_fund_account_ref=case when v_payout_changed then null else seller_payout_profiles.provider_fund_account_ref end,
      provider_tokenized_at=case when v_payout_changed then null else seller_payout_profiles.provider_tokenized_at end,
      provider_last_error=case when v_payout_changed then null else seller_payout_profiles.provider_last_error end,
      verification_status=case when not v_payout_changed and seller_payout_profiles.verification_status='verified' then 'verified' else 'draft' end,
      rejection_reason=null,
      reviewed_at=case when not v_payout_changed and seller_payout_profiles.verification_status='verified' then seller_payout_profiles.reviewed_at else null end,
      reviewed_by=case when not v_payout_changed and seller_payout_profiles.verification_status='verified' then seller_payout_profiles.reviewed_by else null end,
      updated_at=now();
  end if;
  return public.get_seller_finance_profile();
end $$;

grant execute on function public.save_seller_compliance_profile(text,text,text,text,boolean,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.get_seller_finance_profile() to authenticated;

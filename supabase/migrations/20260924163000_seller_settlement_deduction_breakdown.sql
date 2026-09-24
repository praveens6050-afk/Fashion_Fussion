alter table public.seller_settlements add column if not exists platform_commission_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists commission_gst_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists payment_fee_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists shipping_deduction_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists return_deduction_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists other_deduction_amount numeric(14,2) not null default 0;

do $$ begin
  alter table public.seller_settlements add constraint seller_settlements_deduction_breakdown_nonnegative check (
    platform_commission_amount >= 0 and commission_gst_amount >= 0 and payment_fee_amount >= 0 and shipping_deduction_amount >= 0 and return_deduction_amount >= 0 and other_deduction_amount >= 0
  );
exception when duplicate_object then null; end $$;

update public.seller_settlements
set other_deduction_amount = fees_amount
where fees_amount > 0
  and platform_commission_amount = 0 and commission_gst_amount = 0 and payment_fee_amount = 0
  and shipping_deduction_amount = 0 and return_deduction_amount = 0 and other_deduction_amount = 0;

create or replace function public.admin_upsert_seller_settlement_breakdown(
  p_seller_id uuid,p_settlement_id bigint,p_period_start date,p_period_end date,p_gross_amount numeric,
  p_platform_commission_amount numeric default 0,p_commission_gst_amount numeric default 0,p_payment_fee_amount numeric default 0,
  p_shipping_deduction_amount numeric default 0,p_return_deduction_amount numeric default 0,p_other_deduction_amount numeric default 0,
  p_refunds_amount numeric default 0,p_status text default 'pending',p_provider_payout_ref text default null,p_failure_reason text default null,p_note text default null
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_uid uuid:=auth.uid();v_status text:=lower(trim(coalesce(p_status,'')));v_ref text:=nullif(trim(coalesce(p_provider_payout_ref,'')),'');v_failure text:=nullif(trim(coalesce(p_failure_reason,'')),'');v_note text:=nullif(trim(coalesce(p_note,'')),'');v_id bigint;v_old_status text;v_existing_provider_ref text;v_existing_provider_status text;v_fees numeric(14,2);v_net numeric(14,2);v_now timestamptz:=now();
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
 if not exists(select 1 from public.seller_profiles s where s.user_id=p_seller_id) then raise exception 'Seller not found'; end if;
 if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=p_seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
 if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=p_seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Invalid settlement period'; end if;
 if coalesce(p_gross_amount,-1)<0 or coalesce(p_platform_commission_amount,-1)<0 or coalesce(p_commission_gst_amount,-1)<0 or coalesce(p_payment_fee_amount,-1)<0 or coalesce(p_shipping_deduction_amount,-1)<0 or coalesce(p_return_deduction_amount,-1)<0 or coalesce(p_other_deduction_amount,-1)<0 or coalesce(p_refunds_amount,-1)<0 then raise exception 'Settlement amounts must be non-negative'; end if;
 v_fees:=round((coalesce(p_platform_commission_amount,0)+coalesce(p_commission_gst_amount,0)+coalesce(p_payment_fee_amount,0)+coalesce(p_shipping_deduction_amount,0)+coalesce(p_return_deduction_amount,0)+coalesce(p_other_deduction_amount,0))::numeric,2);
 v_net:=round((p_gross_amount-v_fees-p_refunds_amount)::numeric,2);
 if v_net<0 then raise exception 'Settlement net amount cannot be negative'; end if;
 if v_status not in ('pending','processing','failed','held') then raise exception 'Invalid settlement status. Use manual payout recording to mark a settlement paid.'; end if;
 if v_status='failed' and v_failure is null then raise exception 'Failure reason is required'; end if;
 if p_settlement_id is null then
   insert into public.seller_settlements(seller_id,period_start,period_end,gross_amount,platform_commission_amount,commission_gst_amount,payment_fee_amount,shipping_deduction_amount,return_deduction_amount,other_deduction_amount,fees_amount,refunds_amount,net_amount,currency,status,provider_payout_ref,failure_reason,paid_at,created_by,updated_by,created_at,updated_at)
   values(p_seller_id,p_period_start,p_period_end,round(p_gross_amount,2),round(p_platform_commission_amount,2),round(p_commission_gst_amount,2),round(p_payment_fee_amount,2),round(p_shipping_deduction_amount,2),round(p_return_deduction_amount,2),round(p_other_deduction_amount,2),v_fees,round(p_refunds_amount,2),v_net,'INR',v_status,v_ref,case when v_status='failed' then v_failure else null end,null,v_uid,v_uid,v_now,v_now) returning id into v_id;
 else
   select status,provider_payout_ref,provider_status into v_old_status,v_existing_provider_ref,v_existing_provider_status from public.seller_settlements where id=p_settlement_id and seller_id=p_seller_id for update;
   if v_old_status is null then raise exception 'Settlement not found'; end if;
   if v_old_status='paid' then raise exception 'Paid settlements are immutable'; end if;
   if v_existing_provider_ref is not null and lower(coalesce(v_existing_provider_status,'')) not in ('failed','rejected','cancelled','reversed') then raise exception 'Settlement with an active provider payout cannot be edited'; end if;
   update public.seller_settlements set period_start=p_period_start,period_end=p_period_end,gross_amount=round(p_gross_amount,2),platform_commission_amount=round(p_platform_commission_amount,2),commission_gst_amount=round(p_commission_gst_amount,2),payment_fee_amount=round(p_payment_fee_amount,2),shipping_deduction_amount=round(p_shipping_deduction_amount,2),return_deduction_amount=round(p_return_deduction_amount,2),other_deduction_amount=round(p_other_deduction_amount,2),fees_amount=v_fees,refunds_amount=round(p_refunds_amount,2),net_amount=v_net,status=v_status,provider_payout_ref=v_ref,failure_reason=case when v_status='failed' then v_failure else null end,paid_at=null,updated_by=v_uid,updated_at=v_now where id=p_settlement_id and seller_id=p_seller_id returning id into v_id;
 end if;
 insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id) values(v_id,p_seller_id,v_old_status,v_status,coalesce(v_note,'Settlement deductions updated')||' · total deductions ₹'||to_char(v_fees+round(p_refunds_amount,2),'FM9999999990.00'),v_uid);
 return (select to_jsonb(s)-'provider_payout_ref'-'payout_idempotency_key'-'provider_status_details'-'created_by'-'updated_by' from public.seller_settlements s where s.id=v_id);
end $$;

revoke all on function public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text) from public,anon;
grant execute on function public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text) to authenticated;

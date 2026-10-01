-- Fashion Fussion marketplace growth Phase 2: creator commission ledger and payout reservation.
create table if not exists public.creator_payout_batches (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references public.creator_profiles(user_id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0), currency text not null default 'INR' check (currency='INR'),
  status text not null default 'processing' check (status in ('processing','paid','failed','cancelled')),
  provider_reference text, failure_reason text, created_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists creator_payout_batches_creator_status_idx on public.creator_payout_batches(creator_id,status,created_at desc);
alter table public.creator_payout_batches enable row level security;
revoke all on public.creator_payout_batches from public,anon,authenticated;
grant select on public.creator_payout_batches to authenticated;
drop policy if exists creator_payout_batches_select_own on public.creator_payout_batches;
create policy creator_payout_batches_select_own on public.creator_payout_batches for select to authenticated using (creator_id=(select auth.uid()));

create table if not exists public.creator_commission_ledger (
  id uuid primary key default gen_random_uuid(), order_id bigint not null references public.orders(id) on delete restrict,
  creator_id uuid not null references public.creator_profiles(user_id) on delete restrict,
  creator_link_id uuid not null references public.creator_links(id) on delete restrict, product_id bigint not null references public.products(id) on delete restrict,
  gross_attributed_amount numeric(14,2) not null check (gross_attributed_amount>=0), commission_rate numeric(5,2) not null check (commission_rate between 0 and 100),
  commission_amount numeric(14,2) not null check (commission_amount>=0), status text not null default 'pending' check (status in ('pending','on_hold','cleared','processing','paid','void','reversal_due')),
  eligible_at timestamptz, payout_batch_id uuid references public.creator_payout_batches(id) on delete set null, paid_at timestamptz, void_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(order_id,creator_link_id,product_id)
);
create index if not exists creator_commission_ledger_creator_status_idx on public.creator_commission_ledger(creator_id,status,eligible_at);
create index if not exists creator_commission_ledger_order_idx on public.creator_commission_ledger(order_id);
create index if not exists creator_commission_ledger_batch_idx on public.creator_commission_ledger(payout_batch_id) where payout_batch_id is not null;
alter table public.creator_commission_ledger enable row level security;
revoke all on public.creator_commission_ledger from public,anon,authenticated;
grant select on public.creator_commission_ledger to authenticated;
drop policy if exists creator_commission_ledger_select_own on public.creator_commission_ledger;
create policy creator_commission_ledger_select_own on public.creator_commission_ledger for select to authenticated using (creator_id=(select auth.uid()));

create or replace function public.sync_creator_commission_from_order() returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_creator_id uuid; v_product_id bigint; v_rate numeric(5,2); v_line numeric(14,2):=0; v_eligible timestamptz; v_void boolean:=false; v_paid boolean:=false;
begin
 if new.creator_link_id is null then return new; end if;
 select cl.creator_id,cl.product_id,cp.commission_rate into v_creator_id,v_product_id,v_rate from public.creator_links cl join public.creator_profiles cp on cp.user_id=cl.creator_id and cp.status='approved' where cl.id=new.creator_link_id and cl.active=true;
 if v_creator_id is null then return new; end if;
 select coalesce(sum(coalesce(nullif(item->>'line_total','')::numeric,0)),0) into v_line from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) item where nullif(item->>'id','')::bigint=v_product_id;
 v_line:=round(coalesce(v_line,0),2); if v_line<=0 then return new; end if;
 v_paid:=lower(coalesce(new.status,'')) in ('paid','cod_collected');
 v_void:=lower(coalesce(new.status,'')) in ('cancelled','expired','cod_cancelled','payment_failed') or (coalesce(new.refund_amount,0)>0 and lower(coalesce(new.refund_status,'')) in ('paid','processed','completed','refunded','success'));
 if v_void then update public.creator_commission_ledger set status=case when status in ('paid','processing') then 'reversal_due' else 'void' end,void_reason='Order cancelled or refunded',updated_at=now() where order_id=new.id and creator_link_id=new.creator_link_id and product_id=v_product_id and status not in ('void','reversal_due'); return new; end if;
 if not v_paid then return new; end if;
 select max(s.updated_at)+interval '7 days' into v_eligible from public.order_shipments s where s.order_id=new.id and lower(coalesce(s.direction,'forward')) not in ('return','reverse') and (lower(coalesce(s.status,''))='delivered' or lower(coalesce(s.provider_status,''))='delivered');
 insert into public.creator_commission_ledger(order_id,creator_id,creator_link_id,product_id,gross_attributed_amount,commission_rate,commission_amount,status,eligible_at)
 values(new.id,v_creator_id,new.creator_link_id,v_product_id,v_line,v_rate,round(v_line*v_rate/100,2),case when v_eligible is not null and v_eligible<=now() then 'cleared' else 'pending' end,v_eligible)
 on conflict(order_id,creator_link_id,product_id) do update set gross_attributed_amount=case when creator_commission_ledger.status in ('paid','processing','reversal_due') then creator_commission_ledger.gross_attributed_amount else excluded.gross_attributed_amount end, commission_amount=case when creator_commission_ledger.status in ('paid','processing','reversal_due') then creator_commission_ledger.commission_amount else excluded.commission_amount end, eligible_at=coalesce(creator_commission_ledger.eligible_at,excluded.eligible_at), status=case when creator_commission_ledger.status in ('paid','processing','void','reversal_due') then creator_commission_ledger.status else excluded.status end, updated_at=now();
 return new;
end $$;
revoke all on function public.sync_creator_commission_from_order() from public,anon,authenticated;
drop trigger if exists trg_sync_creator_commission_order on public.orders;
create trigger trg_sync_creator_commission_order after insert or update of status,creator_link_id,items,refund_status,refund_amount on public.orders for each row execute function public.sync_creator_commission_from_order();

create or replace function public.sync_creator_commission_from_shipment() returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_eligible timestamptz; begin
 if lower(coalesce(new.direction,'forward')) in ('return','reverse') then return new; end if;
 if lower(coalesce(new.status,''))<>'delivered' and lower(coalesce(new.provider_status,''))<>'delivered' then return new; end if;
 v_eligible:=coalesce(new.updated_at,now())+interval '7 days';
 update public.creator_commission_ledger set eligible_at=coalesce(eligible_at,v_eligible),status=case when status='pending' and v_eligible<=now() then 'cleared' else status end,updated_at=now() where order_id=new.order_id and status in ('pending','on_hold','cleared'); return new;
end $$;
revoke all on function public.sync_creator_commission_from_shipment() from public,anon,authenticated;
drop trigger if exists trg_sync_creator_commission_shipment on public.order_shipments;
create trigger trg_sync_creator_commission_shipment after insert or update of status,provider_status,updated_at on public.order_shipments for each row execute function public.sync_creator_commission_from_shipment();

create or replace function public.sync_creator_commission_from_return() returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_product_id bigint; v_live boolean:=false; v_void boolean:=false; begin
 if lower(coalesce(new.request_type,''))<>'return_refund' then return new; end if;
 select nullif(((o.items -> new.item_index)->>'id'),'')::bigint into v_product_id from public.orders o where o.id=new.order_id; if v_product_id is null then return new; end if;
 v_void:=lower(coalesce(new.status,'')) in ('completed','refunded') or lower(coalesce(new.refund_status,'')) in ('paid','processed','completed','refunded','success');
 v_live:=lower(coalesce(new.status,'')) in ('requested','under_review','approved','return_processing','processing') or lower(coalesce(new.refund_status,'')) in ('requested','pending','processing','initiated');
 if v_void then update public.creator_commission_ledger set status=case when status in ('paid','processing') then 'reversal_due' else 'void' end,void_reason='Attributed item returned/refunded',updated_at=now() where order_id=new.order_id and product_id=v_product_id and status not in ('void','reversal_due');
 elsif v_live then update public.creator_commission_ledger set status='on_hold',updated_at=now() where order_id=new.order_id and product_id=v_product_id and status in ('pending','cleared');
 elsif lower(coalesce(new.status,'')) in ('rejected','cancelled') then update public.creator_commission_ledger set status=case when eligible_at is not null and eligible_at<=now() then 'cleared' else 'pending' end,updated_at=now() where order_id=new.order_id and product_id=v_product_id and status='on_hold'; end if; return new;
end $$;
revoke all on function public.sync_creator_commission_from_return() from public,anon,authenticated;
drop trigger if exists trg_sync_creator_commission_return on public.return_requests;
create trigger trg_sync_creator_commission_return after insert or update of status,refund_status on public.return_requests for each row execute function public.sync_creator_commission_from_return();

create or replace function public.refresh_creator_commissions(p_creator_id uuid) returns void language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 update public.creator_commission_ledger l set status='cleared',updated_at=now() where l.creator_id=p_creator_id and l.status='pending' and l.eligible_at is not null and l.eligible_at<=now() and not exists (select 1 from public.return_requests r join public.orders o on o.id=r.order_id where r.order_id=l.order_id and lower(coalesce(r.request_type,''))='return_refund' and nullif(((o.items -> r.item_index)->>'id'),'')::bigint=l.product_id and (lower(coalesce(r.status,'')) in ('requested','under_review','approved','return_processing','processing') or lower(coalesce(r.refund_status,'')) in ('requested','pending','processing','initiated')));
end $$;
revoke all on function public.refresh_creator_commissions(uuid) from public,anon,authenticated;

create or replace function public.get_creator_dashboard() returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_profile public.creator_profiles%rowtype; v_orders bigint:=0; v_value numeric:=0; v_pending numeric:=0; v_hold numeric:=0; v_cleared numeric:=0; v_processing numeric:=0; v_paid numeric:=0; v_void numeric:=0; v_reversal numeric:=0; v_entries jsonb:='[]'::jsonb;
begin
 if v_uid is null then raise exception 'Authentication required'; end if; select * into v_profile from public.creator_profiles where user_id=v_uid;
 if v_profile.user_id is null then return jsonb_build_object('profile',null,'orders',0,'attributed_value',0,'estimated_commission',0,'pending_commission',0,'on_hold_commission',0,'available_commission',0,'processing_commission',0,'paid_commission',0,'void_commission',0,'reversal_due',0,'entries','[]'::jsonb); end if;
 perform public.refresh_creator_commissions(v_uid);
 select count(distinct l.order_id),coalesce(sum(l.gross_attributed_amount),0),coalesce(sum(l.commission_amount) filter(where l.status='pending'),0),coalesce(sum(l.commission_amount) filter(where l.status='on_hold'),0),coalesce(sum(l.commission_amount) filter(where l.status='cleared'),0),coalesce(sum(l.commission_amount) filter(where l.status='processing'),0),coalesce(sum(l.commission_amount) filter(where l.status='paid'),0),coalesce(sum(l.commission_amount) filter(where l.status='void'),0),coalesce(sum(l.commission_amount) filter(where l.status='reversal_due'),0) into v_orders,v_value,v_pending,v_hold,v_cleared,v_processing,v_paid,v_void,v_reversal from public.creator_commission_ledger l where l.creator_id=v_uid;
 select coalesce(jsonb_agg(x.obj order by x.created_at desc),'[]'::jsonb) into v_entries from (select l.created_at,jsonb_build_object('id',l.id,'order_id',l.order_id,'product_id',l.product_id,'product_name',p.name,'attributed_value',l.gross_attributed_amount,'commission',l.commission_amount,'rate',l.commission_rate,'status',l.status,'eligible_at',l.eligible_at,'paid_at',l.paid_at) obj from public.creator_commission_ledger l join public.products p on p.id=l.product_id where l.creator_id=v_uid order by l.created_at desc limit 50) x;
 return jsonb_build_object('profile',jsonb_build_object('display_name',v_profile.display_name,'handle',v_profile.handle,'status',v_profile.status,'commission_rate',v_profile.commission_rate),'orders',v_orders,'attributed_value',round(v_value,2),'estimated_commission',round(v_pending+v_hold+v_cleared+v_processing+v_paid+v_reversal,2),'pending_commission',round(v_pending,2),'on_hold_commission',round(v_hold,2),'available_commission',round(v_cleared,2),'processing_commission',round(v_processing,2),'paid_commission',round(v_paid,2),'void_commission',round(v_void,2),'reversal_due',round(v_reversal,2),'entries',v_entries);
end $$;
revoke all on function public.get_creator_dashboard() from public,anon; grant execute on function public.get_creator_dashboard() to authenticated,service_role;

create or replace function public.admin_list_creator_balances() returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_result jsonb; begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then raise exception 'Administrator access required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('creator_id',c.user_id,'display_name',c.display_name,'handle',c.handle,'status',c.status,'available',coalesce(b.available,0),'processing',coalesce(b.processing,0),'paid',coalesce(b.paid,0),'reversal_due',coalesce(b.reversal_due,0)) order by c.created_at desc),'[]'::jsonb) into v_result from public.creator_profiles c left join lateral (select sum(l.commission_amount) filter(where l.status='cleared') available,sum(l.commission_amount) filter(where l.status='processing') processing,sum(l.commission_amount) filter(where l.status='paid') paid,sum(l.commission_amount) filter(where l.status='reversal_due') reversal_due from public.creator_commission_ledger l where l.creator_id=c.user_id) b on true; return v_result;
end $$;
revoke all on function public.admin_list_creator_balances() from public,anon; grant execute on function public.admin_list_creator_balances() to authenticated,service_role;

create or replace function public.admin_create_creator_payout(p_creator_id uuid) returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_amount numeric(14,2); v_batch uuid; begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then raise exception 'Administrator access required'; end if; perform public.refresh_creator_commissions(p_creator_id); perform 1 from public.creator_commission_ledger where creator_id=p_creator_id and status='cleared' for update; select round(coalesce(sum(commission_amount),0),2) into v_amount from public.creator_commission_ledger where creator_id=p_creator_id and status='cleared'; if v_amount<=0 then raise exception 'No cleared creator commission is available'; end if; insert into public.creator_payout_batches(creator_id,amount,status,created_by) values(p_creator_id,v_amount,'processing',v_uid) returning id into v_batch; update public.creator_commission_ledger set status='processing',payout_batch_id=v_batch,updated_at=now() where creator_id=p_creator_id and status='cleared'; return jsonb_build_object('batch_id',v_batch,'creator_id',p_creator_id,'amount',v_amount,'status','processing');
end $$;
revoke all on function public.admin_create_creator_payout(uuid) from public,anon; grant execute on function public.admin_create_creator_payout(uuid) to authenticated,service_role;

create or replace function public.admin_mark_creator_payout(p_batch_id uuid,p_status text,p_provider_reference text default null,p_failure_reason text default null) returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_next text:=lower(trim(coalesce(p_status,''))); v_batch public.creator_payout_batches%rowtype; begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then raise exception 'Administrator access required'; end if; if v_next not in ('paid','failed','cancelled') then raise exception 'Invalid payout status'; end if; select * into v_batch from public.creator_payout_batches where id=p_batch_id for update; if v_batch.id is null then raise exception 'Payout batch not found'; end if; if v_batch.status='paid' then raise exception 'Paid payout batches are immutable'; end if; if v_next='paid' and nullif(trim(coalesce(p_provider_reference,'')),'') is null then raise exception 'Payout reference is required'; end if; if v_next='failed' and nullif(trim(coalesce(p_failure_reason,'')),'') is null then raise exception 'Failure reason is required'; end if; if v_next='paid' and exists(select 1 from public.creator_commission_ledger where payout_batch_id=p_batch_id and status='reversal_due') then raise exception 'Payout contains a returned/refunded commission and cannot be marked paid'; end if;
 update public.creator_payout_batches set status=v_next,provider_reference=nullif(trim(coalesce(p_provider_reference,'')),''),failure_reason=case when v_next='failed' then nullif(trim(coalesce(p_failure_reason,'')),'') else null end,paid_at=case when v_next='paid' then now() else null end,updated_at=now() where id=p_batch_id;
 if v_next='paid' then update public.creator_commission_ledger set status='paid',paid_at=now(),updated_at=now() where payout_batch_id=p_batch_id and status='processing'; else update public.creator_commission_ledger set status='void',payout_batch_id=null,void_reason=coalesce(void_reason,'Return/refund before payout completion'),updated_at=now() where payout_batch_id=p_batch_id and status='reversal_due'; update public.creator_commission_ledger set status='cleared',payout_batch_id=null,updated_at=now() where payout_batch_id=p_batch_id and status='processing'; end if; return (select to_jsonb(b) from public.creator_payout_batches b where b.id=p_batch_id);
end $$;
revoke all on function public.admin_mark_creator_payout(uuid,text,text,text) from public,anon; grant execute on function public.admin_mark_creator_payout(uuid,text,text,text) to authenticated,service_role;

create or replace function public.admin_list_creator_payout_batches(p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_result jsonb; begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then raise exception 'Administrator access required'; end if; select coalesce(jsonb_agg(x.obj order by x.created_at desc),'[]'::jsonb) into v_result from (select b.created_at,jsonb_build_object('id',b.id,'creator_id',b.creator_id,'creator_name',c.display_name,'handle',c.handle,'amount',b.amount,'status',b.status,'provider_reference',b.provider_reference,'failure_reason',b.failure_reason,'paid_at',b.paid_at,'created_at',b.created_at) obj from public.creator_payout_batches b join public.creator_profiles c on c.user_id=b.creator_id order by b.created_at desc limit greatest(1,least(coalesce(p_limit,50),200))) x; return v_result;
end $$;
revoke all on function public.admin_list_creator_payout_batches(integer) from public,anon; grant execute on function public.admin_list_creator_payout_batches(integer) to authenticated,service_role;

insert into public.creator_commission_ledger(order_id,creator_id,creator_link_id,product_id,gross_attributed_amount,commission_rate,commission_amount,status,eligible_at)
select o.id,cl.creator_id,cl.id,cl.product_id,round(lines.line_total,2),cp.commission_rate,round(lines.line_total*cp.commission_rate/100,2),case when delivered.eligible_at is not null and delivered.eligible_at<=now() then 'cleared' else 'pending' end,delivered.eligible_at
from public.orders o join public.creator_links cl on cl.id=o.creator_link_id join public.creator_profiles cp on cp.user_id=cl.creator_id and cp.status='approved'
cross join lateral (select coalesce(sum(coalesce(nullif(item->>'line_total','')::numeric,0)),0) line_total from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) item where nullif(item->>'id','')::bigint=cl.product_id) lines
left join lateral (select max(s.updated_at)+interval '7 days' eligible_at from public.order_shipments s where s.order_id=o.id and lower(coalesce(s.direction,'forward')) not in ('return','reverse') and (lower(coalesce(s.status,''))='delivered' or lower(coalesce(s.provider_status,''))='delivered')) delivered on true
where o.status in ('paid','cod_collected') and lines.line_total>0 on conflict(order_id,creator_link_id,product_id) do nothing;

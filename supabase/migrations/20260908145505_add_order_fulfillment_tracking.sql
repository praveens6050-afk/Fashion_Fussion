alter table public.orders
  add column if not exists fulfillment_status text not null default 'ordered',
  add column if not exists fulfillment_updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_fulfillment_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_fulfillment_status_check
      check (fulfillment_status in ('ordered','packed','shipped','out_for_delivery','delivered','cancelled'));
  end if;
end $$;

create policy "Admins can view all orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  )
);

create policy "Admins can update order fulfillment"
on public.orders
for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  )
);

revoke update on table public.orders from anon, authenticated;
grant update (fulfillment_status, fulfillment_updated_at) on public.orders to authenticated;

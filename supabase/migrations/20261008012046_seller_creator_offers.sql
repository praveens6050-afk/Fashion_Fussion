-- Seller-owned creator promotion offers; informational only until admin-approved settlement integration.
create table if not exists public.seller_creator_offers (
 id uuid primary key default gen_random_uuid(),
 seller_id uuid not null references auth.users(id),
 product_id bigint not null references public.products(id),
 proposed_rate numeric(5,2) not null check(proposed_rate between 1 and 20),
 status text not null default 'draft' check(status in ('draft','submitted','approved','rejected','paused')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(seller_id,product_id)
);
alter table public.seller_creator_offers enable row level security;
revoke all on public.seller_creator_offers from public,anon,authenticated;
grant select,insert,update on public.seller_creator_offers to authenticated;
create policy seller_creator_offers_read on public.seller_creator_offers for select to authenticated using(seller_id=(select auth.uid()));
create policy seller_creator_offers_insert on public.seller_creator_offers for insert to authenticated with check(seller_id=(select auth.uid()) and status in ('draft','submitted') and exists(select 1 from public.seller_product_submissions s where s.seller_id=(select auth.uid()) and s.approved_product_id=product_id and lower(s.status)='approved'));
create policy seller_creator_offers_update on public.seller_creator_offers for update to authenticated using(seller_id=(select auth.uid()) and status in ('draft','submitted','rejected','paused')) with check(seller_id=(select auth.uid()) and status in ('draft','submitted','paused') and exists(select 1 from public.seller_product_submissions s where s.seller_id=(select auth.uid()) and s.approved_product_id=product_id and lower(s.status)='approved'));

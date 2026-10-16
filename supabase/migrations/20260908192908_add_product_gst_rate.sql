-- The clean replay baseline may not include the production products table.
-- Add GST metadata only when that table exists; never invent its base schema here.
do $product_gst_guard$
begin
  if to_regclass('public.products') is not null then
    execute 'alter table public.products add column if not exists gst_rate numeric not null default 18';
    execute 'alter table public.products drop constraint if exists products_gst_rate_check';
    execute 'alter table public.products add constraint products_gst_rate_check check (gst_rate >= 0 and gst_rate <= 100)';
    execute 'update public.products set gst_rate = 18 where gst_rate is null';
  end if;
end
$product_gst_guard$;

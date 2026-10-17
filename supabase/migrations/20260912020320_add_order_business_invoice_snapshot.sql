alter table public.orders
  add column if not exists is_business_order boolean not null default false,
  add column if not exists business_name text,
  add column if not exists business_gstin text,
  add column if not exists business_billing_address jsonb,
  add column if not exists purchase_order_no text;

alter table public.orders drop constraint if exists orders_business_gstin_check;
alter table public.orders add constraint orders_business_gstin_check check (business_gstin is null or business_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
alter table public.orders drop constraint if exists orders_purchase_order_no_check;
alter table public.orders add constraint orders_purchase_order_no_check check (purchase_order_no is null or char_length(purchase_order_no) <= 100);
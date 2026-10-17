alter table public.products add column if not exists gst_rate numeric not null default 18;
alter table public.products drop constraint if exists products_gst_rate_check;
alter table public.products add constraint products_gst_rate_check check (gst_rate >= 0 and gst_rate <= 100);
update public.products set gst_rate = 18 where gst_rate is null;
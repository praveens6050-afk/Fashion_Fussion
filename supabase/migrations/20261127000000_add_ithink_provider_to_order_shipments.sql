alter table public.order_shipments drop constraint if exists order_shipments_provider_check;
alter table public.order_shipments add constraint order_shipments_provider_check check (provider in ('shiprocket','delhivery','ithink'));

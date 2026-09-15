alter table public.orders add column if not exists display_order_id text;

create sequence if not exists public.order_display_id_seq;

create or replace function public.generate_display_order_id()
returns text
language plpgsql
set search_path=public
as $$
declare
  seq_value bigint;
begin
  seq_value := nextval('public.order_display_id_seq');
  return 'OD' || to_char(clock_timestamp(),'YYYYMMDDHH24MISS') || lpad((seq_value % 1000000)::text,6,'0');
end;
$$;

update public.orders
set display_order_id = 'OD' || to_char(created_at,'YYYYMMDDHH24MISS') || lpad(id::text,6,'0')
where display_order_id is null;

alter table public.orders alter column display_order_id set default public.generate_display_order_id();
alter table public.orders alter column display_order_id set not null;
create unique index if not exists orders_display_order_id_key on public.orders(display_order_id);
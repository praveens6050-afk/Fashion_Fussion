create or replace function public.release_stale_checkout_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  released_count integer:=0;
begin
  for o in
    select id,user_id,status from public.orders
    where (status='creating' and created_at<now()-interval '1 hour')
       or (status='created' and created_at<now()-interval '30 days')
       or status in ('payment_failed','expired','cancelled')
    for update skip locked
  loop
    begin
      perform public.release_order_promotions(o.id,o.user_id);
      perform public.release_order_inventory(o.id);
      if o.status='creating' then
        update public.orders set status='payment_failed' where id=o.id;
      elsif o.status='created' then
        update public.orders set status='expired' where id=o.id;
      end if;
      released_count:=released_count+1;
    exception when others then
      raise warning 'Could not release stale checkout order %: %',o.id,sqlerrm;
    end;
  end loop;
  return released_count;
end;
$$;
revoke all on function public.release_stale_checkout_orders() from public, anon, authenticated;
grant execute on function public.release_stale_checkout_orders() to service_role;
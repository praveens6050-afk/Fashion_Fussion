create unique index if not exists customer_addresses_one_default_per_user
on public.customer_addresses(user_id)
where is_default = true;

create or replace function public.ensure_customer_address_default_after_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.is_default then
    update public.customer_addresses
    set is_default = true,
        updated_at = now()
    where id = (
      select id
      from public.customer_addresses
      where user_id = old.user_id
      order by created_at desc, id desc
      limit 1
    );
  end if;
  return old;
end
$function$;

drop trigger if exists customer_addresses_reassign_default_after_delete on public.customer_addresses;
create trigger customer_addresses_reassign_default_after_delete
after delete on public.customer_addresses
for each row
execute function public.ensure_customer_address_default_after_delete();
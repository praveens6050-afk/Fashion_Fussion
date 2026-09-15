alter table public.products
  alter column is_active set default false;

create or replace function public.enforce_product_activation_ready()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.is_active = true
     and (tg_op = 'INSERT' or old.is_active is distinct from true) then
    if coalesce(new.has_variants, false) is not true then
      raise exception 'Add at least one SKU/variant before activating this product';
    end if;

    if not exists (
      select 1
      from public.product_variants v
      join public.inventory_levels i on i.variant_id = v.id
      where v.product_id = new.id
        and v.is_active = true
        and (i.on_hand - i.reserved) > 0
    ) then
      raise exception 'Set available stock above zero on an active SKU before activating this product';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists products_activation_readiness_guard on public.products;
create trigger products_activation_readiness_guard
before insert or update of is_active on public.products
for each row
execute function public.enforce_product_activation_ready();

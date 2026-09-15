begin;

update public.product_variants v
set is_active = false
where v.sku = '123456'
  and exists (
    select 1
    from public.products p
    where p.id = v.product_id
      and p.name = '0'
      and p.price = 1.00
  );

update public.products p
set is_active = false
where p.name = '0'
  and p.price = 1.00
  and exists (
    select 1
    from public.product_variants v
    where v.product_id = p.id
      and v.sku = '123456'
  );

commit;
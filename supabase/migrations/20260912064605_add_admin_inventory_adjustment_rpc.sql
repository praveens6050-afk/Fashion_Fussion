create or replace function public.admin_set_variant_inventory(
  p_variant_id bigint,
  p_on_hand integer,
  p_reorder_level integer default null,
  p_note text default null
)
returns table(on_hand integer, reserved integer, reorder_level integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_current public.inventory_levels%rowtype;
  v_delta integer;
  v_reorder integer;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if not exists(select 1 from public.profiles where id=v_user and is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  if p_variant_id is null or p_variant_id <= 0 then
    raise exception 'Invalid variant';
  end if;
  if p_on_hand is null or p_on_hand < 0 then
    raise exception 'On-hand inventory must be zero or greater';
  end if;
  if p_reorder_level is not null and p_reorder_level < 0 then
    raise exception 'Reorder level must be zero or greater';
  end if;
  if p_note is not null and length(btrim(p_note)) > 1000 then
    raise exception 'Inventory note is too long';
  end if;
  if not exists(select 1 from public.product_variants where id=p_variant_id) then
    raise exception 'Variant not found';
  end if;

  select * into v_current from public.inventory_levels where variant_id=p_variant_id for update;
  if not found then
    v_reorder := coalesce(p_reorder_level,0);
    insert into public.inventory_levels(variant_id,on_hand,reserved,reorder_level,updated_at)
    values(p_variant_id,p_on_hand,0,v_reorder,now())
    returning * into v_current;
    v_delta := p_on_hand;
  else
    if p_on_hand < v_current.reserved then
      raise exception 'On-hand inventory cannot be below reserved inventory';
    end if;
    v_delta := p_on_hand - v_current.on_hand;
    v_reorder := coalesce(p_reorder_level,v_current.reorder_level);
    update public.inventory_levels
      set on_hand=p_on_hand,reorder_level=v_reorder,updated_at=now()
      where variant_id=p_variant_id
      returning * into v_current;
  end if;

  if v_delta <> 0 then
    insert into public.inventory_movements(
      variant_id,movement_type,quantity_delta,reference_type,reference_id,note,actor_user_id,created_at
    ) values (
      p_variant_id,'adjustment',v_delta,'admin_inventory',p_variant_id::text,
      nullif(left(btrim(coalesce(p_note,'Admin inventory adjustment')),1000),''),v_user,now()
    );
  end if;

  return query select v_current.on_hand,v_current.reserved,v_current.reorder_level;
end;
$$;
revoke all on function public.admin_set_variant_inventory(bigint,integer,integer,text) from public;
grant execute on function public.admin_set_variant_inventory(bigint,integer,integer,text) to authenticated;
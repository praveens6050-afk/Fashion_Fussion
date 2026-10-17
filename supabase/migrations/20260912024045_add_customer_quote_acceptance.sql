alter table public.bulk_quotes
  add column if not exists accepted_at timestamptz;

alter table public.orders
  add column if not exists bulk_quote_id bigint references public.bulk_quotes(id);

create unique index if not exists orders_bulk_quote_id_unique
  on public.orders(bulk_quote_id)
  where bulk_quote_id is not null;

create or replace function public.accept_bulk_quote(p_quote_id bigint)
returns table(
  quote_id bigint,
  status text,
  quoted_total numeric,
  valid_until timestamptz,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_quote public.bulk_quotes%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_quote
  from public.bulk_quotes
  where id = p_quote_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Quote not found';
  end if;

  if v_quote.status = 'accepted' then
    return query select v_quote.id, v_quote.status, v_quote.quoted_total, v_quote.valid_until, v_quote.accepted_at;
    return;
  end if;

  if v_quote.status <> 'quoted' then
    raise exception 'Only a quoted business quote can be accepted';
  end if;

  if v_quote.quoted_total is null or v_quote.quoted_total <= 0 then
    raise exception 'Quote total is invalid';
  end if;

  if v_quote.valid_until is not null and v_quote.valid_until < now() then
    update public.bulk_quotes
      set status = 'expired', updated_at = now()
      where id = v_quote.id;
    raise exception 'This quote has expired';
  end if;

  update public.bulk_quotes
    set status = 'accepted', accepted_at = now(), updated_at = now()
    where id = v_quote.id
    returning * into v_quote;

  return query select v_quote.id, v_quote.status, v_quote.quoted_total, v_quote.valid_until, v_quote.accepted_at;
end;
$$;

revoke all on function public.accept_bulk_quote(bigint) from public;
grant execute on function public.accept_bulk_quote(bigint) to authenticated;
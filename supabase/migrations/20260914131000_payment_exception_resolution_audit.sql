alter table public.payment_exceptions
  add column if not exists resolution_code text,
  add column if not exists resolved_by_admin_id uuid references auth.users(id) on delete set null;

alter table public.payment_exceptions
  drop constraint if exists payment_exceptions_resolution_code_check;

alter table public.payment_exceptions
  add constraint payment_exceptions_resolution_code_check
  check (
    resolution_code is null or resolution_code in (
      'processor_refund_confirmed',
      'duplicate_or_false_positive',
      'support_review_completed'
    )
  );

create index if not exists payment_exceptions_resolved_by_admin_idx
  on public.payment_exceptions(resolved_by_admin_id)
  where resolved_by_admin_id is not null;

create or replace function public.resolve_payment_exception(
  p_exception_id bigint,
  p_admin_id uuid,
  p_resolution_code text,
  p_resolution_note text
)
returns public.payment_exceptions
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  e public.payment_exceptions%rowtype;
  v_code text := trim(coalesce(p_resolution_code,''));
  v_note text := trim(coalesce(p_resolution_note,''));
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'service role required';
  end if;
  if p_exception_id is null or p_exception_id < 1 then
    raise exception 'Invalid payment exception ID';
  end if;
  if p_admin_id is null then
    raise exception 'Admin ID is required';
  end if;
  if v_code not in ('processor_refund_confirmed','duplicate_or_false_positive','support_review_completed') then
    raise exception 'Invalid resolution code';
  end if;
  if char_length(v_note) < 8 or char_length(v_note) > 500 then
    raise exception 'Resolution note must be 8 to 500 characters';
  end if;

  select * into e
  from public.payment_exceptions
  where id=p_exception_id
  for update;

  if not found then
    raise exception 'Payment exception not found';
  end if;
  if e.status <> 'open' then
    raise exception 'Payment exception is already resolved';
  end if;

  update public.payment_exceptions
  set status='resolved',
      resolved_at=now(),
      resolution_code=v_code,
      resolution_note=v_note,
      resolved_by_admin_id=p_admin_id
  where id=p_exception_id
    and status='open'
  returning * into e;

  if not found then
    raise exception 'Payment exception changed before resolution';
  end if;
  return e;
end;
$function$;

revoke all on function public.resolve_payment_exception(bigint,uuid,text,text) from public, anon, authenticated;
grant execute on function public.resolve_payment_exception(bigint,uuid,text,text) to service_role;

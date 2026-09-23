create table if not exists private.admin_login_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on table private.admin_login_rate_limits from public, anon, authenticated;

create or replace function public.consume_admin_login_rate_limit(
  p_key text,
  p_limit integer default 8,
  p_window_seconds integer default 600
)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path to 'pg_catalog', 'private'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_row private.admin_login_rate_limits%rowtype;
  v_reset_at timestamptz;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'service role required';
  end if;
  if p_key is null or length(btrim(p_key)) < 3 or length(p_key) > 160 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'invalid rate limit'; end if;
  if p_window_seconds < 30 or p_window_seconds > 86400 then raise exception 'invalid rate limit window'; end if;

  insert into private.admin_login_rate_limits(rate_key, window_started_at, attempts, updated_at)
  values (p_key, v_now, 0, v_now)
  on conflict (rate_key) do nothing;

  select * into v_row
  from private.admin_login_rate_limits
  where rate_key = p_key
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, 0, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  v_reset_at := v_row.window_started_at + make_interval(secs => p_window_seconds);
  if v_now >= v_reset_at then
    v_row.window_started_at := v_now;
    v_row.attempts := 0;
    v_row.blocked_until := null;
    v_reset_at := v_now + make_interval(secs => p_window_seconds);
  end if;

  v_row.attempts := v_row.attempts + 1;

  if v_row.attempts > p_limit then
    update private.admin_login_rate_limits
    set attempts = v_row.attempts,
        blocked_until = v_reset_at,
        updated_at = v_now
    where rate_key = p_key;
    return query select false, 0, greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::integer);
    return;
  end if;

  update private.admin_login_rate_limits
  set window_started_at = v_row.window_started_at,
      attempts = v_row.attempts,
      blocked_until = null,
      updated_at = v_now
  where rate_key = p_key;

  return query select true, greatest(0, p_limit - v_row.attempts), 0;
end;
$function$;

revoke all on function public.consume_admin_login_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_admin_login_rate_limit(text, integer, integer) to service_role;

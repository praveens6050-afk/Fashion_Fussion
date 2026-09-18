begin;

create table if not exists public.api_rate_limit_buckets (
  subject_key text not null,
  scope text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (subject_key, scope),
  check (char_length(subject_key) between 1 and 200),
  check (char_length(scope) between 1 and 80)
);

alter table public.api_rate_limit_buckets enable row level security;
revoke all on table public.api_rate_limit_buckets from public, anon, authenticated;
grant all on table public.api_rate_limit_buckets to service_role;

create or replace function public.consume_api_rate_limit(
  p_subject_key text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text := btrim(coalesce(p_subject_key, ''));
  v_scope text := btrim(coalesce(p_scope, ''));
  v_cutoff timestamptz;
  v_count integer;
begin
  if char_length(v_subject) < 1 or char_length(v_subject) > 200 then
    raise exception 'Invalid rate-limit subject';
  end if;
  if char_length(v_scope) < 1 or char_length(v_scope) > 80 then
    raise exception 'Invalid rate-limit scope';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'Invalid rate-limit threshold';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit window';
  end if;

  v_cutoff := now() - make_interval(secs => p_window_seconds);

  insert into public.api_rate_limit_buckets(subject_key, scope, window_started_at, request_count, updated_at)
  values(v_subject, v_scope, now(), 1, now())
  on conflict(subject_key, scope) do update
    set request_count = case
          when public.api_rate_limit_buckets.window_started_at <= v_cutoff then 1
          else public.api_rate_limit_buckets.request_count + 1
        end,
        window_started_at = case
          when public.api_rate_limit_buckets.window_started_at <= v_cutoff then now()
          else public.api_rate_limit_buckets.window_started_at
        end,
        updated_at = now()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.consume_api_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,text,integer,integer) to service_role;

create or replace function public.enforce_bulk_quote_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.user_id is distinct from auth.uid() then raise exception 'Invalid quote owner'; end if;
  if not public.consume_api_rate_limit(auth.uid()::text, 'bulk_quote_request', 10, 600) then
    raise exception 'Too many business quote requests. Please wait a few minutes and try again.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_bulk_quote_rate_limit() from public, anon, authenticated;
drop trigger if exists bulk_quotes_rate_limit_before_insert on public.bulk_quotes;
create trigger bulk_quotes_rate_limit_before_insert
before insert on public.bulk_quotes
for each row execute function public.enforce_bulk_quote_rate_limit();

create or replace function public.enforce_return_request_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.user_id is distinct from auth.uid() then raise exception 'Invalid return request owner'; end if;
  if not public.consume_api_rate_limit(auth.uid()::text, 'return_request', 10, 3600) then
    raise exception 'Too many return or exchange requests. Please wait before trying again.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_return_request_rate_limit() from public, anon, authenticated;
drop trigger if exists return_requests_rate_limit_before_insert on public.return_requests;
create trigger return_requests_rate_limit_before_insert
before insert on public.return_requests
for each row execute function public.enforce_return_request_rate_limit();

create or replace function public.enforce_support_request_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.user_id is distinct from auth.uid() then raise exception 'Invalid support request owner'; end if;
  if not public.consume_api_rate_limit(auth.uid()::text, 'support_request', 5, 3600) then
    raise exception 'Too many support requests. Please wait before creating another request.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_support_request_rate_limit() from public, anon, authenticated;
drop trigger if exists customer_support_requests_rate_limit_before_insert on public.customer_support_requests;
create trigger customer_support_requests_rate_limit_before_insert
before insert on public.customer_support_requests
for each row execute function public.enforce_support_request_rate_limit();

create or replace function public.enforce_support_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.sender_user_id is distinct from auth.uid() then raise exception 'Invalid support message sender'; end if;
  if not public.consume_api_rate_limit(auth.uid()::text, 'support_message', 30, 60) then
    raise exception 'Too many support messages. Please wait a moment and try again.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_support_message_rate_limit() from public, anon, authenticated;
drop trigger if exists customer_support_messages_rate_limit_before_insert on public.customer_support_messages;
create trigger customer_support_messages_rate_limit_before_insert
before insert on public.customer_support_messages
for each row execute function public.enforce_support_message_rate_limit();

drop policy if exists "Browser roles denied order shipments" on public.order_shipments;
create policy "Browser roles denied order shipments"
on public.order_shipments for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "Browser roles denied payment exceptions" on public.payment_exceptions;
create policy "Browser roles denied payment exceptions"
on public.payment_exceptions for all
to anon, authenticated
using (false)
with check (false);

notify pgrst, 'reload schema';
commit;

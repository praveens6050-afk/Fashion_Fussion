begin;

drop policy if exists "Browser roles denied rate-limit buckets" on public.api_rate_limit_buckets;
create policy "Browser roles denied rate-limit buckets"
on public.api_rate_limit_buckets for all
to anon, authenticated
using (false)
with check (false);

commit;

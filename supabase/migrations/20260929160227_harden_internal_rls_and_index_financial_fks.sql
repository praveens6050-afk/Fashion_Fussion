begin;

-- Explicitly deny browser roles on internal/audit tables. Service role continues to bypass RLS.
drop policy if exists "Browser roles denied payment recovery notifications" on public.payment_recovery_notifications;
create policy "Browser roles denied payment recovery notifications"
on public.payment_recovery_notifications for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "Browser roles denied seller finance review events" on public.seller_finance_review_events;
create policy "Browser roles denied seller finance review events"
on public.seller_finance_review_events for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "Browser roles denied seller payout webhook events" on public.seller_payout_webhook_events;
create policy "Browser roles denied seller payout webhook events"
on public.seller_payout_webhook_events for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "Browser roles denied seller settlement events" on public.seller_settlement_events;
create policy "Browser roles denied seller settlement events"
on public.seller_settlement_events for all
to anon, authenticated
using (false)
with check (false);

-- Avoid per-row auth.uid() re-evaluation on seller read policies.
alter policy seller_compliance_read_own on public.seller_compliance_profiles
  using (seller_id = (select auth.uid()));
alter policy seller_payout_read_own on public.seller_payout_profiles
  using (seller_id = (select auth.uid()));
alter policy seller_pickup_read_own on public.seller_pickup_locations
  using (seller_id = (select auth.uid()));
alter policy seller_settlement_read_own on public.seller_settlements
  using (seller_id = (select auth.uid()));

-- Cover currently unindexed foreign keys used by payment recovery and seller finance flows.
create index if not exists payment_recovery_notifications_order_id_idx
  on public.payment_recovery_notifications(order_id);
create index if not exists seller_compliance_profiles_reviewed_by_idx
  on public.seller_compliance_profiles(reviewed_by);
create index if not exists seller_finance_review_events_reviewer_id_idx
  on public.seller_finance_review_events(reviewer_id);
create index if not exists seller_finance_review_events_seller_id_idx
  on public.seller_finance_review_events(seller_id);
create index if not exists seller_payout_profiles_reviewed_by_idx
  on public.seller_payout_profiles(reviewed_by);
create index if not exists seller_payout_webhook_events_settlement_id_idx
  on public.seller_payout_webhook_events(settlement_id);
create index if not exists seller_settlement_events_actor_id_idx
  on public.seller_settlement_events(actor_id);
create index if not exists seller_settlement_events_seller_id_idx
  on public.seller_settlement_events(seller_id);
create index if not exists seller_settlement_events_settlement_id_idx
  on public.seller_settlement_events(settlement_id);
create index if not exists seller_settlements_created_by_idx
  on public.seller_settlements(created_by);
create index if not exists seller_settlements_seller_id_idx
  on public.seller_settlements(seller_id);
create index if not exists seller_settlements_updated_by_idx
  on public.seller_settlements(updated_by);

notify pgrst, 'reload schema';
commit;

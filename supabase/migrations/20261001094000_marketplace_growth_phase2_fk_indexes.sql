-- Cover Phase 2 creator ledger foreign keys used for joins and deletes.
create index if not exists creator_commission_ledger_creator_link_idx on public.creator_commission_ledger(creator_link_id);
create index if not exists creator_commission_ledger_product_idx on public.creator_commission_ledger(product_id);
create index if not exists creator_payout_batches_created_by_idx on public.creator_payout_batches(created_by) where created_by is not null;

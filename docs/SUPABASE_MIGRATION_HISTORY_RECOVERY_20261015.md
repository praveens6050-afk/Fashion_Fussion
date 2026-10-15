# Supabase migration history recovery — 2026-10-15

## Scope

Restore the exact SQL statements associated with remote migration versions into `supabase/migrations/` using a **read-only** query of `supabase_migrations.schema_migrations`. This PR does not execute SQL against production, alter the remote migration ledger, change secrets/flags, or enable/disable schedulers.

## Initial audit

- Remote migration records: **149**
- Local migration files on `main` before recovery: **135**
- Remote versions missing locally: **31**
- Local-only versioned files before recovery: **17**

## Recovery of remote history

- Restores all **31** remote versions with their original IDs, names, and SQL from the remote ledger.
- Removes stale duplicate files that matched an already-recorded remote migration, including the three initial duplicates:
  - `20261001090500_cleanup_growth_helper.sql` → canonical `20261001090338_cleanup_unused_growth_helper.sql`
  - `20261001090400_admin_creator_review.sql` → canonical `20261001090249_admin_creator_review.sql`
  - `20261001094500_marketplace_growth_phase2_public_signal_comment.sql` → canonical `20261001093924_marketplace_growth_phase2_public_signal_comment.sql`
- Removes superseded, older local variants of migrations already represented by canonical remote versions (creator foundation, creator ledger, seller signals, FK indexes, seller creator analytics, creator product discovery, seller offers, and admin offer review).
- Removes two no-op markers that only executed `select 1;`; they add no schema objects and are not needed for replay.
- Moves the proposed blanket privileged-RPC revocation out of the active migration directory to `supabase/pending-review/restrict_privileged_rpc_execute.sql`. **Do not apply it yet.** Existing Admin browser code directly calls `admin_list_seller_creator_offers`, `admin_review_seller_creator_offer`, and `admin_upsert_seller_settlement_breakdown` with the authenticated Supabase client. The proposed blanket revocation would break those actions. Its `SECURITY INVOKER` change for `get_marketplace_product_signals()` also needs caller/RLS/grant validation.

## Remaining active migrations

The only local-only migration files are now deliberately versioned **after** the latest remote version (`20261015020458`), so they will not be inserted into the middle of the already-applied history:

- `20261015140000_creator_attribution_session_hardening.sql` — idempotently ensures two indexes and the existing authenticated deny-select policy. The production schema already contains these objects; the policy is checked for its exact definition before any creation.
- `20261015140100_launch_commission_enforcement_reconcile.sql` — records the existing launch-zero-commission function definition under a new forward-only version. A read-only production check confirmed that the live function already contains the zero-commission guard.
- `20261015140200_fast_dispatch_signal.sql` — adds the backend-only Fast Dispatch signal function. The read-only production check found this function is not currently installed. This is a **real schema change** and must be preview-tested and separately approved before production migration.

## Restored remote versions

- `20261001085227_marketplace_growth_creator_foundation.sql`
- `20261001085434_creator_attribution_sessions.sql`
- `20261001085848_creator_attribution_hardening.sql`
- `20261001090249_admin_creator_review.sql`
- `20261001090338_cleanup_unused_growth_helper.sql`
- `20261001092922_marketplace_growth_phase2_creator_ledger.sql`
- `20261001093008_marketplace_growth_phase2_seller_signals.sql`
- `20261001093847_marketplace_growth_phase2_fk_indexes.sql`
- `20261001093924_marketplace_growth_phase2_public_signal_comment.sql`
- `20261003051011_create_seller_lead_pool.sql`
- `20261003163321_add_whatsapp_inbound_routing.sql`
- `20261003163416_resolve_whatsapp_role.sql`
- `20261004173549_add_whatsapp_phone_otp_verification.sql`
- `20261004193050_add_verified_seller_phone_login_resolver.sql`
- `20261005141659_add_shared_login_otp_challenges.sql`
- `20261008012046_seller_creator_offers.sql`
- `20261008012159_seller_creator_analytics.sql`
- `20261008012204_creator_product_discovery.sql`
- `20261008012534_admin_creator_offer_review.sql`
- `20261013172419_whatsapp_contact_consent_ledger_20261013.sql`
- `20261013173204_whatsapp_consent_signed_keyword_events_20261013.sql`
- `20261013174345_whatsapp_order_notification_outbox_20261013.sql`
- `20261013175842_whatsapp_order_checkbox_consent_20261013.sql`
- `20261013181115_stage_whatsapp_order_events_without_sending_20261013.sql`
- `20261013181606_whatsapp_meta_delivery_receipts_20261013.sql`
- `20261013183716_zoho_transactional_order_email_staging_20261014.sql`
- `20261014061918_zoho_order_confirmation_single_attempt_claim_20261014.sql`
- `20261014063526_zoho_order_confirmation_insert_stage_and_review_20261014.sql`
- `20261014081242_zoho_order_confirmation_eligibility_read_only_20261014.sql`
- `20261014134323_zoho_global_order_confirmation_limits_20261014.sql`
- `20261015020458_ff_zoho_order_confirmation_recovery_scheduler_20261015.sql`

## Validation and safety

- The read-only remote ledger contains 149 versions; the recovered branch includes all 149 exact version IDs.
- The active migration directory contains those 149 versions plus the three forward-only migrations listed above: **152 versioned files total**, with no local-only migration older than the latest remote version.
- Production schema checks were read-only. They confirmed the creator attribution indexes/policy and the launch commission guard already exist, while `get_seller_fast_dispatch_signal(uuid)` is absent.
- GitHub's `Supabase Preview` check was **skipped**, so no isolated preview replay has been verified yet. The connected Supabase project currently reports its `main` branch as `MIGRATIONS_FAILED`; it was not reset or modified. No new preview branch was created.
- Do **not** merge or run `supabase db push` against production until the three remaining migrations pass an isolated preview replay and the deployment plan is explicitly approved.

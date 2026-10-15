# Supabase migration history recovery — 2026-10-15

## Scope

This change restores the exact SQL statements associated with remote migration versions into `supabase/migrations/`, using a **read-only** query of `supabase_migrations.schema_migrations`. It does not execute SQL against the production database, modify migration history, change secrets/flags, or enable/disable schedulers.

## Audit result before this PR

- Remote migration records: **149**
- Local migration files on `main`: **135**
- Remote versions with no matching local versioned file: **31**
- Local-only versioned files: **17**

## Recovery

- Restores the 31 recorded remote versions using their original version IDs and names.
- Removes three local files whose normalized SQL matched an existing remote migration exactly, replacing them with the correctly versioned remote files:
  - `20261001090500_cleanup_growth_helper.sql` → `20261001090338_cleanup_unused_growth_helper.sql`
  - `20261001090400_admin_creator_review.sql` → `20261001090249_admin_creator_review.sql`
  - `20261001094500_marketplace_growth_phase2_public_signal_comment.sql` → `20261001093924_marketplace_growth_phase2_public_signal_comment.sql`
- Preserves the following **14** local-only migrations because their normalized SQL did not exactly match any recorded remote migration. They remain pending/unreconciled and must be reviewed before anyone runs `supabase db push` against production:
  - `supabase/migrations/20261001090300_launch_commission_enforcement.sql`
  - `supabase/migrations/20261001090600_marketplace_growth_source_alignment.sql`
  - `supabase/migrations/20261001094600_marketplace_growth_phase2_security_notes.sql`
  - `supabase/migrations/20261004120000_fast_dispatch_signal.sql`
  - `supabase/migrations/20261005113500_restrict_privileged_rpc_execute.sql`
  - `supabase/migrations/20261007161000_seller_creator_analytics.sql`
  - `supabase/migrations/20261007163000_creator_product_discovery.sql`
  - `supabase/migrations/20261008070000_seller_creator_offers.sql`
  - `supabase/migrations/20261008073000_admin_creator_offer_review.sql`
  - `supabase/migrations/20261001090000_marketplace_growth_creator_foundation.sql`
  - `supabase/migrations/20261001090200_creator_attribution_sessions.sql`
  - `supabase/migrations/20261001091500_marketplace_growth_phase2_creator_ledger.sql`
  - `supabase/migrations/20261001091800_marketplace_growth_phase2_seller_signals.sql`
  - `supabase/migrations/20261001094000_marketplace_growth_phase2_fk_indexes.sql`

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

## Validation / safety

- All 31 target version IDs were found in the remote migration history; each has one stored SQL statement.
- SQL recovery used the stored migration statements, not guessed or newly authored DDL.
- This PR changes repository files only. Do **not** merge or deploy as part of this recovery without a separate review of the preview migration replay and the 14 local-only migrations.

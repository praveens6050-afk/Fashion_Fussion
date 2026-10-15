# Zoho order-confirmation missed-event recovery (zero-attempt only)

## Observed first live COD order
Customer order display `OD20261015015204000018` is Supabase order ID **25**.
Its Zoho `order_confirmed` outbox event is **sent**, `attempt_count=1`.
DO NOT resend this order: provider accepted the notification; inbox receipt is a separate check.

## Recovery model
- Existing real-time Customer -> Seller event delivery remains the primary route.
- Every five minutes, a PostgreSQL cron job invokes the private Seller recovery
  endpoint through pg_net. It needs a dedicated Vault/Cloudflare recovery secret.
- The recovery endpoint scans only durable `order_confirmed` Zoho outbox events
  that are at least **2 minutes old**, newer than the fresh launch cutoff and
  within **23 hours**, with state `pending_review` or `ready`,
  `attempt_count=0`, and NO provider message ID or sent timestamp.
- A service-role-only eligibility preview validates the real order (verified
  buyer email, COD or captured prepaid, not cancelled, recent, unique event).
- A maximum of **3** eligible events per tick go through the EXISTING production
  dispatcher: same fresh-order cutoff, global launch authorization, OAuth
  validation, single atomic claim and **30/hour, 150/rolling-24h** caps.
- A claimed, sent, sending, blocked, rejected or provider-uncertain event is
  NEVER automatically retried; the operator must investigate the Zoho mailbox
  and original outbox outcome. Exactly-once intent is prioritized over retries.
- Each API response has aggregate counters only (no email addresses, tokens,
  customer IDs, order IDs or email bodies). The API never accepts arbitrary
  order IDs. Neither provider acceptance nor outbox 'sent' proves inbox delivery.

## Installation (no existing flags are switched off)
1. Deploy reviewed `cloudflare-seller` code with
   `/api/outreach/zoho-order-recovery` to the real Seller Pages project.
2. Generate a NEW random >=40-character recovery token **privately**. Save it as
   a **Cloudflare Seller Production SECRET**, exact name
   `ZOHO_ORDER_RECOVERY_TOKEN`. Do not use OUTREACH_API_TOKEN or the shared
   ZOHO_ORDER_EVENT_TOKEN; do not post the value in ChatGPT/GitHub/logs.
3. In Supabase Dashboard -> Vault, create an encrypted Vault secret named
   **ff_zoho_recovery_token** containing exactly the same value. Do not add
   credentials to SQL migration text or source control.
4. Apply `seller-panel/sql/zoho_order_confirmation_recovery_scheduler.sql`
   with the authorized Supabase migration process. It installs pg_net and
   schedules `ff_zoho_order_recovery_every_5m`. If the Vault secret is
   absent, scheduled ticks are no-ops.
5. Redeploy Seller if required after its new secret is saved.
6. Verify HTTP POST on recovery endpoint with Bearer recovery-only token and
   body `{"dryRun":true}` through a private trusted server (never browser
   JS). It should report `armed:true`, `sentAccepted:0`.
7. Review cron job and logs via read-only queries at the end of SQL file.
   Verify no duplicate for order 25, and verify an authorized NEW delayed,
   unattempted eligible event can be recovered precisely once. A zero-backlog
   check alone does not prove actual future recovery.
8. Keep hourly queue alerts; investigate stalePending10m or stuckSending5m
   and any `reviewRequired` before assuming successful recovery.

## Diagnostics & rollback
- Confirm `ZOHO_ORDER_CONFIRMATION_MODE=production`,
  `ZOHO_ORDER_GLOBAL_LAUNCH_APPROVED=true`,
  `ZOHO_ORDER_GLOBAL_LAUNCH_ACK=verified_customers_only_v1`, and both
  existing sending switches remain as already authorized.
- The recovery-only secret is the new independent authorization. If missing,
  invalid, or not deployed, recovery **does not run**, while existing
  primary order email flow is unchanged.
- To pause ONLY recovery while leaving primary email automation untouched,
  execute `SELECT cron.unschedule('ff_zoho_order_recovery_every_5m');`
  as an authorized database operator. Do not blindly re-enable before review.
- Supabase `pg_net` HTTP responses need inspection when cron succeeds but
  Seller returns an error. Scheduled database execution is not equivalent to
  Zoho acceptance.
- Avoid manual re-send of any event with `attempt_count>0`. Recovery is
  only for safely unattempted queued notifications; it cannot guarantee
  delivery when the provider accepts but the buyer's mailbox does not.

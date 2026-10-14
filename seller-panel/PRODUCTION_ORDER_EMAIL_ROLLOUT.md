# Fashion Fussion — all-verified-buyers Zoho order confirmation rollout

Prepared (but **NOT enabled**) a separately authorized `production` mode for all verified customers. The previously tested `automatic` mode remains restricted to the one configured test buyer; `pilot` remains restricted to its one order.

## Mandatory production authorization
Seller must explicitly configure `ZOHO_ORDER_CONFIRMATION_MODE=production`, `ZOHO_ORDER_GLOBAL_LAUNCH_APPROVED=true`, `ZOHO_ORDER_GLOBAL_LAUNCH_ACK=verified_customers_only_v1`, `ZOHO_ORDER_AUTOMATION_ENABLED=true`, `ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED=true`, and a **NEW** cutoff `ZOHO_ORDER_AUTOMATION_NOT_BEFORE` in canonical UTC *set before new eligible orders* and after the original pilot. Customer separately needs `FF_ORDER_EMAIL_HOOK_ENABLED=true` and the existing matching backend-only service bearer. No code change or migration sets these Cloudflare flags. A missing/invalid flag must keep broad delivery locked.

**Security:** The new global mode accepts only the trusted 40+ character internal service bearer, checks both order and outbox creation dates against the cutoff before Zoho API use, and independently relies on Supabase service-role approval and claim SQL. That SQL requires confirmed Auth email matching order email, order reference and buyer name, valid un-cancelled COD or paid verified prepaid, a <24-hour fresh event, and exactly one zero-attempt pending event. Failed online payments and already-sent/blocked notifications cannot send. Unique index blocks duplicate events.

**Rate limits:** The new `public.claim_zoho_order_confirmation_global_limited(bigint)` is service-role-only, serializes claims using advisory transaction lock, limits all Zoho order confirmation attempts to 30/hour and 150/rolling-24-hours. It never retries messages already claimed or with uncertain provider outcome. Rejected at-cap orders remain unclaimed for operator review.

**Monitoring:** service-role-only `public.zoho_order_delivery_telemetry()` reports aggregate counts for pending/ready, sent/blocked/sending, attempts last hour/24h, stale pending (>10m) and stuck sending (>5m), without buyer PII. Existing protected status endpoint reports production gate status. Queue remains 2 sent / 2 attempts after the two previously successful tests.

**Critical limitation:** An independent durable recovery scheduler does not yet exist. Transient Customer waitUntil failures leave `pending_review` outbox entries for review; no automated retry should happen after a send attempt. We must not claim guaranteed email delivery until recovery + reconciliation are designed/tested and production volume monitored.

## Safe activation sequence
1. Verify Seller and Customer Cloudflare deployments are green and both existing one-buyer and prepaid/cancelled safety tests still pass. Keep global approval and sending kill switches OFF during rollout preparation.
2. Decide the launch UTC cutoff at the moment of activation. Existing order #23 and #24 should not receive duplicate notifications. Set mode and cutoff while GLOBAL launch-approved=false; inspect protected status.
3. Obtain separate go-live approval and set global acknowledgement/approved flags on Seller; only then Seller send/automation flags + Customer backend event hook can become true. Use a **new real authorized** order and independently verify a unique sent notification and actual inbox delivery.
4. Monitor queue every rollout hour. If events grow stale or sending stuck, immediately set Seller `ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED=false` and Customer `FF_ORDER_EMAIL_HOOK_ENABLED=false`, investigate and do not blind resend.
5. Do not remove the existing test-buyer secret: it remains necessary if reverting to restricted `automatic` mode. Only this explicitly approved `production` mode ignores it.

**No mass outreach, marketing, unpaid-order notifications, Zoho sends or new orders are performed by this change.**

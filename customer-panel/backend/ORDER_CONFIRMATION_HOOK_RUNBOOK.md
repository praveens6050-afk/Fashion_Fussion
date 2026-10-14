# Fashion Fussion — verified order confirmation integration

## Design

Cloudflare Customer Pages code invokes a **fixed seller API URL** only after it has successfully finalized a real order's inventory and confirmed the order/payment state. Confirmed paths: fresh and resumed COD checkout, existing/reconciled prepaid capture, and Razorpay `payment.captured` webhook. The zero-value gift-card checkout also requests validation, but the seller database rejects it unless it meets the existing verified-prepaid eligibility rules.

The customer request includes **only the numeric order ID** and `confirmSend:true`. It never supplies the recipient address, payment status, email content or order total. Seller server independently verifies Zoho Orders OAuth, calls Supabase service-only approval/atomic claim RPCs and sends one HTML email **from `orders@fashionfussion.in`**. The claim is unique per order + event and limits attempts to one. No customer frontend access to the token is added.

## Disabled by default — two kill switches + one shared service secret

These are **not set by GitHub commits**. Operators must configure the Cloudflare **Production** environments manually after successful controlled testing. Do not use the general `OUTREACH_API_TOKEN` in Customer Pages.

| Cloudflare Pages project | Type | Name | Value while testing |
| --- | --- | --- | --- |
| `fashion-fussion-customer` | Secret | `ZOHO_ORDER_EVENT_TOKEN` | Same NEW cryptographically random >=40-character value as Seller |
| `fashion-fussion-seller` | Secret | `ZOHO_ORDER_EVENT_TOKEN` | Exactly same private value as Customer |
| `fashion-fussion-customer` | Variable | `FF_ORDER_EMAIL_HOOK_ENABLED` | `false` or absent |
| `fashion-fussion-seller` | Variable | `ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED` | `false` or absent |

The Sales/outreach mailbox's OAuth/token configuration is unchanged. The four existing `ZOHO_ORDERS_*` secrets remain only in Seller Pages. Share **no** token values in chat, issue comments, browser code, screenshots or public test sites.

## Activation checklist (do not perform until approved)

1. Confirm the **seller** and **customer** production deployments both include this change.
2. From `https://seller.fashionfussion.in/zoho-test.html` re-verify the Orders mailbox. Confirm the mail account has already delivered an explicit standalone test to the fixed private test inbox.
3. Verify the protected `zoho-confirmation-status` queue is empty or review existing pending events. **Do not backfill** old events.
4. Create a fresh controlled checkout **using an authorized test buyer and actual available inventory**, with COD or genuinely captured/verified prepaid; never fabricate captured payments or bypass stock validation. Get explicit consent before placing any real order; no order creation is performed by this runbook.
5. Confirm the real order's event exists with `pending_review`, the auth customer email is verified, and the order status is legitimately `cod_pending` / `cod_collected` or captured prepaid `paid` with `payment_verified_at`.
6. Enable Seller `ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED=true` **only for a controlled test**. Send that one order via the internal authenticated endpoint, or stage a controlled customer hook test. Ensure only one outbox row can be claimed and that it becomes `sent` on Zoho acceptance. Check actual receipt in test Gmail; HTTP acceptance alone is not delivery.
7. Test webhook replay, authenticated verify repeat and checkout retry to ensure no second notification is sent; test payment failures/cancellations and ensure no email. Check logs for credentials/PII; verify failure doesn't change payment status.
8. After review, enable Customer `FF_ORDER_EMAIL_HOOK_ENABLED=true` if/when production auto-sending is approved. Monitor `pending_review`, `sending`, `blocked` and `sent` outbox status daily and reconcile delivery failures manually.

**Rollback:** Set either Customer `FF_ORDER_EMAIL_HOOK_ENABLED=false` or Seller `ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED=false`. Do not delete existing audit entries or automatically retry a `sending` / `blocked` event, as a remote provider might have accepted it despite an error.

## Known limitations

- A successful email API call does NOT guarantee final inbox delivery.
- At-most-once provider submission prevents duplicate mail but can leave email unsent on transient failure. There is **no scheduled queue recovery worker** yet. A pending-review event requires authorized intervention.
- Order emails are not automatically sent while either feature flag remains off. Payment-failed emails use a **different** customer-side Zoho integration; they are not modified here.

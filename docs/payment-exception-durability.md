# Payment exception durability hardening

Current manual-review exception paths in `backend/api/reconcile-payment.js`, `backend/api/verify-payment.js`, and `backend/api/razorpay-webhook.js` log and swallow persistence failures from `record_payment_exception`.

Required behavior:

- A captured-payment manual-review path must not report that review was successfully queued unless the durable exception record was saved.
- Browser verification/reconciliation paths should return a recoverable support-review response when exception persistence fails, with explicit guidance not to pay again.
- Webhook processing should return a non-success response when exception persistence fails so the provider can retry delivery instead of silently losing the review record.
- Existing active-checkout finalization and inventory behavior must remain unchanged.
- No new root serverless function should be added; the project must remain within the current 12-function deployment limit.

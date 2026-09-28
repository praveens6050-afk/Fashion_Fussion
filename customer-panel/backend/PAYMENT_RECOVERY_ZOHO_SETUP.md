# Zoho Mail payment recovery setup

The application code handles Razorpay `payment.failed` webhooks and sends one recovery email per failed Razorpay payment ID through Zoho Mail.

## Cloudflare server variables

Configure these values only in the server-side Cloudflare Pages environment. Never expose them to browser JavaScript and never commit real values.

- `PUBLIC_SITE_URL=https://fashionfussion.in`
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_ACCOUNT_ID`
- `ZOHO_FROM_EMAIL`
- `ZOHO_ACCOUNTS_BASE=https://accounts.zoho.in`
- `ZOHO_MAIL_BASE=https://mail.zoho.in`

The Zoho refresh token must authorize sending mail with `ZohoMail.messages.CREATE`.

## Razorpay webhook

Keep the existing Fashion Fussion Razorpay webhook URL and enable the `payment.failed` event in addition to the currently required capture/refund events. The backend validates the webhook signature using `RAZORPAY_WEBHOOK_SECRET` before processing it.

## Recovery link

The email CTA points to:

`https://fashionfussion.in/order-details.html?id=<store_order_id>#payment`

The order-details page requires the customer to be signed in. The existing resume-payment API verifies order ownership, order amount, Razorpay order identity, paid state, and the payment-session age before opening Razorpay Checkout. This avoids placing a bearer token or sensitive payment credential in the email link.

## Deduplication

`public.payment_recovery_notifications` stores delivery attempts and has a unique constraint on `(event_type, payment_id)`. Duplicate delivery of the same Razorpay `payment.failed` webhook therefore does not send repeated successful emails.

## Production verification checklist

1. Add the Zoho variables to Cloudflare Production.
2. Enable Razorpay `payment.failed` on the existing production webhook.
3. Deploy the customer branch.
4. Run a Razorpay Test Mode failed payment with a test customer email.
5. Confirm one row is created in `payment_recovery_notifications` and becomes `sent`.
6. Confirm the email contains the correct order ID, total and item details.
7. Open the Retry payment button while signed in and confirm it opens the same Razorpay order.
8. Complete a test retry and confirm the Fashion Fussion order changes to `paid` only after payment verification.

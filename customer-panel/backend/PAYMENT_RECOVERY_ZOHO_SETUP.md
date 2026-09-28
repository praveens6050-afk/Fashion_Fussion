# Zoho Mail payment recovery setup

The application handles Razorpay `payment.failed` webhooks and sends one recovery email per failed Razorpay payment ID through Zoho Mail.

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

## Passwordless recovery link

For an active failed-payment order, the backend uses the Supabase Admin Auth API to generate a one-time Magic Link for the exact authenticated user who owns the order. The Magic Link is sent inside the Zoho recovery email and redirects to:

`https://fashionfussion.in/order-details.html?id=<store_order_id>&payment=1&autopay=1`

The Magic Link proves possession of the customer's confirmed account email and establishes the normal Supabase session before order data or the Razorpay session is loaded. The customer therefore does not need to type a password, while the existing ownership checks remain in force.

In Supabase Dashboard -> Authentication -> URL Configuration, add this production redirect pattern before enabling the feature:

`https://fashionfussion.in/order-details.html**`

Use the narrow path pattern above instead of a site-wide wildcard. Supabase Magic Links are one-time sign-in links and their validity is controlled by the project's Email OTP expiration setting. The storefront's existing Razorpay payment session still has its own one-hour maximum age.

The recovery email is sent only to the confirmed Supabase Auth email for `orders.user_id`. The backend does not rely on editable user metadata for authorization.

## Automatic payment opening

After Supabase verifies the Magic Link, `order-payment-retry.js` waits for the authenticated session, verifies that the order belongs to that user, then automatically runs the existing `resume-payment`, reconciliation, and payment-verification flow. The `autopay` flag is removed from the URL before Razorpay is opened so refreshing the page does not repeatedly open Checkout.

## Deduplication

`public.payment_recovery_notifications` stores delivery attempts and has a unique constraint on `(event_type, payment_id)`. Duplicate delivery of the same Razorpay `payment.failed` webhook therefore does not send repeated successful emails.

## Production verification checklist

1. Keep the Zoho variables configured in Cloudflare Production.
2. Keep Razorpay `payment.failed` enabled on the production webhook.
3. Add `https://fashionfussion.in/order-details.html**` to Supabase Auth Redirect URLs.
4. Deploy the customer branch.
5. Run a failed payment using a customer whose account email is confirmed.
6. Confirm one row is created in `payment_recovery_notifications` and becomes `sent`.
7. Confirm the Zoho email contains the correct order ID, total, item details, and Retry payment button.
8. Open Retry payment in a signed-out browser and confirm Supabase signs the customer in automatically, returns to the same order, and Razorpay opens without a manual login step.
9. Complete the retry and confirm the same Fashion Fussion order becomes `paid` only after payment verification.
10. Re-open the same email Magic Link and confirm Supabase rejects the already-used/expired sign-in link.

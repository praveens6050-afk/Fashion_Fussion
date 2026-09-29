# Cloudflare Customer project

Project: `fashion-fussion-customer`
Branch: `cloudflare-customer`
Root directory: `customer-panel`
Build command: `npm run build`
Output directory: `dist`
Compatibility date: `2026-09-22`

Runtime variables/secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `ALLOWED_ORIGIN`

Production origin: `https://www.fashionfussion.in`.
The apex host `https://fashionfussion.in` permanently redirects to the `www` production origin. Keep `ALLOWED_ORIGIN` set to `https://www.fashionfussion.in` (or include it in the comma-separated allowlist during the transition).
For preview testing, append only the exact Customer `pages.dev` origin to `ALLOWED_ORIGIN` and Supabase Auth allowed redirects, then remove it after testing.

Pages Functions handle `/api/*`, `/product`, `/about`, and `/about.html`; other storefront files stay on the Cloudflare CDN. Production verification covers canonical-host redirect, auth, product/search/cart, COD/prepaid checkout, Razorpay verification/webhook, orders, shipping/tracking, cancellation and refund status.

See `.github/CLOUDFLARE_MIGRATION.md` for the full Cloudflare production architecture and verification boundary.

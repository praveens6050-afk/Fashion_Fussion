# Cloudflare Admin project

Project: `fashion-fussion-admin`
Branch: `cloudflare-admin`
Root directory: `admin-panel`
Build command: `npm run build`
Output directory: `dist`
Compatibility date: `2026-09-22`

Runtime variables/secrets:
- `SUPABASE_URL`
- `ALLOWED_ORIGIN`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD`
- `SHIPROCKET_PICKUP_LOCATION`
- `SHIPROCKET_PICKUP_PINCODE`

Production origin: `https://admin.fashionfussion.in`.
For preview testing, append the exact Admin `pages.dev` origin to `ALLOWED_ORIGIN` and add required Supabase Auth redirect URLs before testing login/reset flows.

Only `/api/*` invokes Pages Functions. Static Admin assets stay on the CDN. Keep Vercel live until Cloudflare Admin login, catalog, orders, refund and shipping flows pass.

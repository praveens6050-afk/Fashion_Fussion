# Cloudflare Seller project

Project: `fashion-fussion-seller`
Branch: `cloudflare-seller`
Root directory: `seller-panel`
Build command: `npm run build`
Output directory: `dist`
Compatibility date: `2026-09-22`

Seller is a static frontend using Supabase directly; no server-side Cloudflare secret is required for its normal runtime.

Production domain: `https://seller.fashionfussion.in`.
Before preview auth/reset testing, add the exact Seller `pages.dev` origin/redirect URL to Supabase Auth allowed redirects. Seller signup and password recovery derive their redirect from `location.origin`, so preview auth works cleanly once that origin is allow-listed.

Verify login/register/reset, catalog, normal image upload, submit/edit product and approval/rejection state before custom-domain cutover. Keep Vercel Seller live as rollback until Cloudflare Seller smoke tests pass.

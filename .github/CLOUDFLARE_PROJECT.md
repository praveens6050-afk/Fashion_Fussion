# Cloudflare Seller project

Project: `fashion-fussion-seller`
Branch: `cloudflare-seller`
Root directory: `seller-panel`
Build command: `npm run build`
Output directory: `dist`
Compatibility date: `2026-09-22`

Seller is a static frontend using Supabase directly; no server-side Cloudflare secret is required for its normal runtime.

Production domain: `https://seller.fashionfussion.in`.
Before preview auth/reset testing, add only the exact Seller `pages.dev` origin/redirect URL to Supabase Auth allowed redirects. Seller signup and password recovery derive their redirect from `location.origin`, so preview auth works once that origin is allow-listed.

Production verification covers login/register/reset, catalog, normal image upload, submit/edit product and Admin approval/rejection state.

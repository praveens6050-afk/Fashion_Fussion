# Launch readiness batch 13

Public privacy and policy hardening.

- Added `privacy.html` covering the customer information currently used for accounts, checkout, orders, payments, delivery, refunds, support and business requests.
- Kept policy statements grounded in the current Supabase, Razorpay, Vercel and browser-storage workflow.
- Removed the precise street address from the public Security page; support email and phone remain available for security reports.
- Split customer-facing privacy information from checkout/account security guidance and cross-linked the pages.
- Added Privacy Policy discoverability from the homepage Help footer and Contact & Support page.
- Added the Privacy Policy to the sitemap and canonical production Link-header configuration.
- No pricing, checkout, payment, order, inventory, promotion, API or database behavior changed.

Verification requirement: Quality Gate, automated Desktop browser smoke test, exact Vercel preview, then merged-main production verification.

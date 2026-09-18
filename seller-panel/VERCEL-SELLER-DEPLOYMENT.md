# Seller Panel — Separate Vercel Project

Use this configuration only for the standalone seller portal. Do not reuse the existing customer `fashion-fussion` Vercel project.

## Target

- Vercel project name: `fashion-fussion-seller`
- Git repository: `praveens6050-afk/Fashion_Fussion`
- Production branch: `seller-panel-standalone`
- Root Directory: `seller-panel`
- Framework Preset: Other / static
- Build Command: none
- Install Command: none
- Output Directory: project root / default static output
- Custom domain target: `seller.fashionfussion.in`

## Routing

`seller-panel/vercel.json` enables clean URLs and security headers.

The deployment root serves `index.html`. The existing seller session guard sends unauthenticated visitors to the seller login page, while authenticated sellers remain in the dashboard.

Expected public entry:

- `https://seller.fashionfussion.in`

Login may resolve as a clean `/login` URL because Vercel clean URLs are enabled.

## Domain attachment

Attach `seller.fashionfussion.in` only to the dedicated seller Vercel project. Follow the DNS record Vercel shows for the domain if the parent domain DNS is managed outside Vercel.

Do not move the customer production domain away from the existing `fashion-fussion` project.

## Current prototype warning

The seller portal is still a standalone browser-storage prototype. Publishing it gives sellers a reachable URL, but it does not make authentication, KYC, orders, payments, approvals or seller ownership production-secure. Backend/Supabase integration remains a separate phase.

## Verification after first deployment

1. Open the root URL in a private/incognito browser.
2. Confirm unauthenticated access goes to Seller Login.
3. Sign in with the documented demo account only for prototype verification.
4. Confirm the dashboard loads and Seller Center assets return 200.
5. Sign out and confirm the login page returns.
6. Confirm the existing customer `fashion-fussion` Vercel project/domain is unchanged.
7. Confirm the seller project's production deployment source is `seller-panel-standalone` and Root Directory is `seller-panel`.

## Verification checkpoint — 19 Sep 2026

This branch is the exact standalone Seller deployment candidate after QA/cleanup. The current customer production remains untouched. A branch preview may be used for static smoke testing, but public seller production should not be treated as secure until Supabase seller authentication/ownership replaces the browser-local prototype auth.

# Launch readiness batch 25 — final desktop public-launch audit

## Scope

This batch closes the code/infrastructure side of the desktop launch audit without fabricating catalogue or order data.

## Verified production contracts

- The homepage is indexable and does not carry an accidental `noindex` header.
- `robots.txt` allows the public store and blocks private/account/admin/order routes.
- `sitemap.xml` lists the homepage plus About, FAQ, Business Buying, Contact, Terms, Shipping & Delivery, Returns & Refunds, Privacy and Security Policy.
- Public policy/help pages have canonical response-header declarations in `vercel.json`.
- Private/customer workflow pages stay `noindex`.
- Baseline security headers remain configured: content-type sniffing protection, frame denial, referrer policy and restrictive camera/microphone/geolocation permissions.
- Homepage customer navigation remains discoverable through static footer links plus the existing business-registration trust runtime, which adds FAQ, Contact, Shipping, Returns, Terms, Privacy, About and Business Buying links without exposing private certificate/address data.

## Regression protection

`scripts/check_public_launch_contract.js` is chained into the existing checkout/readiness Quality Gate source-check step. It fails CI if a required public page disappears, drops out of the sitemap/homepage discovery contract, is blocked by robots, loses its canonical declaration, or if private-route indexing/security-header protections regress.

`scripts/public_launch_smoke.js` is also available as a focused desktop browser helper for checking the public route set and homepage footer discovery.

## Commercial go-live boundary

Production still requires genuine business/operator data before the first real transaction test: at least one real product, active SKU, positive stock, a real delivery address, a controlled real order and realistic parcel measurements. This batch does not invent any of those values and does not create orders, payments, shipments, AWBs or pickup requests.

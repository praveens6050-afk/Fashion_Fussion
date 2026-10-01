# Marketplace Growth Rollout

Implemented on `feat/marketplace-growth-foundation`.

## Seller LaunchPad
- New sellers auto-enrol in a six-month launch program.
- Marketplace commission is forced to 0% at the authoritative settlement write path while the launch window is active.
- Listing and subscription fees default to ₹0.
- Payment, shipping, return, refund and other actual deductions remain separate.
- First 30 days carry a visibility-boost window.
- Seller Growth & LaunchPad view exposes benefits, brand story, creator matching and guarded FastPay eligibility status.

## Creator Commerce
- Creator applications with admin approval and configurable commission rate.
- Approved creators can create product referral links and Shop-the-Look collections.
- Referral attribution is stored for seven days and only attaches when the referred product exists in the created order.
- Attribution is resolved server-side through a database trigger; customer clients cannot choose a creator payout record directly.
- Creator dashboard reports paid/COD-collected attributed product value and estimated commission. It is not a payout ledger.

## Customer Discovery
- Homepage fashion-first discovery modules: Trending Now, value edits, Creator Picks, Shop the Look, emerging brands and creator program.
- Search supports `?max=499` / `?max=999` discovery links.
- Shop the Look can add all currently active items in a published look to cart.

## Admin
- Creator Program card lists creator applications.
- Admin can approve/reject creators and set commission rates.

## Financial guardrails
- FastPay is status-only in this rollout; it does not accelerate funds automatically.
- Creator commission is estimated until a dedicated payout/return-clearance ledger is implemented.
- Existing settlement KYC/payout verification and immutable-paid-settlement controls remain in force.

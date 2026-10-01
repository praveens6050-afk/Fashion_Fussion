# Marketplace Growth Phase 2

## Creator earnings
- Eligible paid/COD-collected attributed orders create immutable commission ledger entries at the creator rate active when the order is recorded.
- Forward delivery starts a 7-day post-purchase hold.
- Active returns hold affected commission; completed refunds void unpaid commission or mark already-processing/paid commission as reversal due.
- Admin payout batches reserve cleared balances but do not send money. A batch can be marked paid only with a provider reference and only when no reversal-due ledger row remains.

## Seller trust and discovery
- `Verified Seller` requires an active seller profile, verified seller compliance/KYC and verified payout profile.
- `Great value` and `Competitive price` compare only with active Fashion Fussion products in the same category and require at least three category peers. They are not market-wide price claims.
- Active LaunchPad visibility receives a modest relevance boost. Verified Seller adds a smaller relevance boost. Explicit non-relevance customer sorting is not overridden.

## FastPay readiness
FastPay eligibility requires:
- verified compliance/KYC;
- verified payout profile;
- at least 10 delivered seller orders; and
- return rate no higher than 10%.

Eligibility does not move money or activate FastPay. Activation remains an explicit admin action and continues to use the existing settlement and payout controls.

## Security
- Creator payout write RPCs validate administrator access inside SECURITY DEFINER functions.
- Creator ledger and payout tables have RLS and expose creators only to their own read data.
- Public marketplace product signals return only derived/public-safe fields (verified boolean, visibility boolean, category value signal, category reference price and relevance boost); raw KYC or payout details are not returned.

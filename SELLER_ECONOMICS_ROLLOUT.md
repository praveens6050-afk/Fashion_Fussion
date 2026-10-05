# Seller Economics Transparency Rollout

## Goal
Give Fashion Fussion sellers a transparent estimate of order economics without presenting estimates as guaranteed settlements.

## Fee principles
- Joining fee: ₹0 unless an approved policy explicitly changes it.
- Listing fee: ₹0 unless an approved policy explicitly changes it.
- Marketplace commission is configurable; never hard-code a future commercial promise into checkout or settlement accounting.
- Payment processing, shipping and returns are shown separately from marketplace commission.
- GST on taxable platform fees is calculated separately.
- The calculator is an estimate only; the settlement ledger remains the source of truth.

## Calculator inputs
Selling price, marketplace commission %, payment-processing % and fixed fee, shipping estimate, expected return rate, return-handling estimate, and GST rate on platform fees.

## Seller-facing output
Show marketplace commission, payment processing, shipping, expected return reserve, GST on platform fees, total estimated costs, estimated net payout and effective cost rate.

## Safety / launch gates
1. Commercial fee configuration must be approved before exposing production defaults.
2. Do not advertise “zero commission” globally unless the active fee policy actually guarantees it for the relevant category/order.
3. Label shipping and return figures as estimates.
4. Never use this client-side calculator as settlement authority.
5. Compare estimates with real settlement samples before public rollout.
6. Monitor payout disputes and estimate-vs-actual variance after launch.

## Next phase
Seller return protection: evidence capture, return QC outcome, abuse signals, dispute workflow and auditable seller-protection decisions.

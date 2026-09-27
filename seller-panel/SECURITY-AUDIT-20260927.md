# Seller verification audit — 2026-09-27

## Fixed: last-4-only verification binding

PAN, GSTIN and payout bank verification previously matched a newly entered full value to the saved profile using only masked last-4 data (plus holder/IFSC for bank accounts). A different value sharing the same suffix could therefore be sent to an external verification provider and have its result attached to the saved seller profile.

The fix stores a seller-scoped SHA-256 fingerprint alongside masked last-4 values. Raw PAN, GSTIN and bank account numbers are still not stored. External verification now requires the full value supplied by the seller to match the stored fingerprint exactly.

Legacy rows without a fingerprint must be re-saved once with the full value before external verification can run. Fingerprint fields are removed from the seller-facing finance-profile RPC response.

The seller finance read/write RPCs are also restricted to the authenticated role; anonymous execution was removed.

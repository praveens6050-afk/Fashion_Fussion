# Provider integration

The authoritative settlement path should supply transaction amount, normalized payment method, successful-payment timestamp, actual provider processing fee when available, and trusted MDR eligibility/exemption. Actual provider fee is the reconciliation source of truth and must never be added on top of the fallback MDR estimate.

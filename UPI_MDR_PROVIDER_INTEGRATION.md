# Payment-provider integration contract

The settlement writer should supply these values to `resolve_payment_processing_fee`:

- `amount`: merchant transaction amount used by the provider for processing-fee assessment.
- `payment_method`: normalized provider method (`upi`, `upi_intent`, `upi_collect`, or another method).
- `paid_at`: authoritative successful-payment timestamp.
- `provider_fee_amount`: actual processing fee when the provider reports one; null otherwise.
- `mdr_eligible`: false when provider/regulatory metadata identifies the transaction as exempt.

Never infer an additional MDR when a positive provider fee is already present. Actual provider statements remain the reconciliation source of truth.

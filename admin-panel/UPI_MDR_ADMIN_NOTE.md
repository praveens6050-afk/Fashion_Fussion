# Admin settlement handling

When creating or reconciling a seller settlement, the payment-processing deduction should use the provider's actual fee when available. If the provider supplies no fee, backend settlement code may call `resolve_payment_processing_fee` with the normalized payment method, paid timestamp and MDR eligibility flag.

Do not manually add the estimated MDR on top of an already reported provider processing fee. Do not classify MDR as marketplace commission and do not expose it as a customer charge.

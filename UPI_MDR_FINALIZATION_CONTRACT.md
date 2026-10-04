# Payment finalization contract

Payment finalization should persist provider payment method and successful-payment timestamp without trusting customer-supplied values. Settlement generation/reconciliation then derives the merchant payment-processing deduction from trusted provider/server metadata. Eligibility/exemption must likewise come from trusted backend/provider configuration, not customer input.

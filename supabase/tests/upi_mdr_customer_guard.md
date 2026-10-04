# Checkout isolation invariant

The UPI MDR helpers must not be referenced by customer cart, checkout, order-total or invoice calculations. MDR is resolved only from trusted post-payment/server settlement data.

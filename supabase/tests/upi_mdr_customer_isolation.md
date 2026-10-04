# Customer isolation check

Customer-facing cart/checkout/order total code should have zero references to the MDR helper functions. The only intended consumer is trusted backend settlement/payment accounting.

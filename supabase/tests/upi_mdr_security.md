# Database security expectations

`anon` and `authenticated` must not have EXECUTE on either MDR helper. `service_role` may execute them for trusted settlement/payment processing. This prevents browser checkout code from using the merchant fee as a customer surcharge.

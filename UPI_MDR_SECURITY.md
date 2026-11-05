# Security boundary

MDR calculation and settlement resolution are backend-only financial operations. Database execution is revoked from `public`, `anon` and `authenticated` and granted to `service_role`. Payment method and eligibility must come from trusted server/provider metadata, never customer input.

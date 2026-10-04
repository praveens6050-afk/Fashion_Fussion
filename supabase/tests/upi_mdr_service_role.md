# Service role expectation

Both MDR functions are revoked from public/anon/authenticated and granted to service_role. Production settlement execution should occur only from trusted backend/server paths using the existing privileged database connection model.

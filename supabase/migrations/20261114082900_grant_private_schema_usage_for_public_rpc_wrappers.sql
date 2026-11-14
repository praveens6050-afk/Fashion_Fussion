-- Public SECURITY INVOKER RPC wrappers call narrowly granted functions in
-- the private schema. Schema USAGE is needed for name resolution; individual
-- function EXECUTE grants remain the actual authorization boundary.
grant usage on schema private to anon, authenticated;

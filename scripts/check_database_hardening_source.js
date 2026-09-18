const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const errors=[];
function requireMarkers(file,markers){const full=path.join(root,file);if(!fs.existsSync(full)){errors.push(`${file}: missing`);return''}const text=fs.readFileSync(full,'utf8');for(const marker of markers)if(!text.includes(marker))errors.push(`${file}: missing ${marker}`);return text}
requireMarkers('supabase/migrations/20260915214056_deactivate_accidental_test_catalog_entry.sql',["v.sku = '123456'","p.name = '0'","set is_active = false"]);
const grants=requireMarkers('supabase/migrations/20260915214217_harden_security_definer_execute_grants.sql',['commit_order_inventory(bigint)','reserve_order_inventory(bigint)','restock_cancelled_order_inventory(bigint)','from public, anon, authenticated','to service_role','accept_bulk_quote(bigint)','to authenticated, service_role']);
if(!grants.includes('revoke execute on function public.release_order_inventory(bigint) from public, anon, authenticated'))errors.push('inventory release RPC must remain service-role-only');
requireMarkers('supabase/migrations/20260915214322_add_missing_bulk_inventory_fk_indexes.sql',['bulk_quote_items_product_id_idx','inventory_movements_actor_user_id_idx']);
const initplans=requireMarkers('supabase/migrations/20260915214355_optimize_remaining_auth_rls_initplans.sql',['(select auth.uid())','business_profiles_select_own','bulk_quotes_admin_update','product_variants_admin_update','inventory_levels_admin_all']);
if(/(?<!select )auth\.uid\(\)/.test(initplans.replace(/\(select auth\.uid\(\)\)/g,'')))errors.push('RLS initplan migration contains unwrapped auth.uid()');
requireMarkers('supabase/migrations/20260915214419_consolidate_remaining_select_rls_policies.sql',['bulk_quotes_select_owner_or_admin','bulk_quote_items_select_owner_or_admin','return_requests_select_owner_or_admin']);
const rateLimits=requireMarkers('supabase/migrations/20260918043949_full_security_audit_hardening.sql',['api_rate_limit_buckets','consume_api_rate_limit','bulk_quote_request','return_request','support_request','support_message','Browser roles denied order shipments','Browser roles denied payment exceptions']);
for(const marker of ['10, 600','10, 3600','5, 3600','30, 60'])if(!rateLimits.includes(marker))errors.push(`full security audit migration: missing rate limit ${marker}`);
requireMarkers('supabase/migrations/20260918044018_rate_limit_table_browser_deny_policy.sql',['Browser roles denied rate-limit buckets','using (false)','with check (false)']);
const wrappers=requireMarkers('supabase/migrations/20260918044114_hide_client_security_definer_implementations.sql',['create schema if not exists private','alter function public.accept_bulk_quote(bigint) set schema private','alter function public.get_variant_availability(bigint) set schema private','security invoker','private.create_return_request','private.finalize_bulk_quote']);
for(const fn of ['accept_bulk_quote','admin_set_variant_inventory','create_bulk_quote_request','create_return_request','finalize_bulk_quote','get_variant_availability'])if(!wrappers.includes(`private.${fn}`))errors.push(`private SECURITY DEFINER implementation missing for ${fn}`);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Deep-audit database hardening source guards passed');

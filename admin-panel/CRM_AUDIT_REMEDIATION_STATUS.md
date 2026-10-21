# Fashion Fussion CRM remediation status

Audit date: 2026-10-21
Scope: repository `praveens6050-afk/Fashion_Fussion`, CRM branch work, read-only checks against Supabase project `gmdevprqtvoshbbytsxf`.
Safety boundary: no production migrations, deployment, secret changes, or outbound messages were performed.

## Verified database facts

- `public.seller_leads` contains 49 rows. The CRM lead pool is not globally empty.
- The CRM frontend intentionally loads the seller-acquisition lead module only for `administrator` and `sales` roles. A `customer_support` login will not see seller leads; that is role separation, not proof that the lead table is empty.
- `public.crm_team_members` contains one active member, with role `customer_support`. No active Seller Support, Sales, or Marketing team members were found.
- One profile is marked administrator.
- `crm_b2b_accounts`, `crm_b2b_deals`, `crm_b2b_quotes`, `crm_sales_activities`, `crm_sales_quotas`, `crm_marketing_campaigns`, `crm_rfm_segments`, `crm_inbox_conversations`, and `crm_inbox_messages` had zero rows at the time of the read-only audit.
- `public.crm_email_inbound_events` does not exist in the connected project. Therefore the Cloudflare Zoho CRM intake route cannot work against this project until its required migration is safely applied.
- The remote migration inventory contains the core CRM inbox/reply migrations, but does not contain the newer Zoho email inbox/reply/identity-review migration versions from the repository. Do not assume a repository migration is already applied remotely.

## Security review

- The nine public OTP/consent/delivery/outbox tables flagged as RLS-enabled-with-no-policy are intentionally browser-denied service-side stores. A branch-only migration documents this design; it does not add broad client policies.
- `public.crm_log_b2b_deal_stage()` is a trigger-only function. A branch-only migration revokes direct EXECUTE from browser roles.
- `public.get_marketplace_product_signals()` is explicitly documented by its original migration as a public-safe derived signal endpoint; do not revoke anonymous execution without checking storefront use.
- The 72 authenticated SECURITY DEFINER warnings must be reviewed function by function. A blanket revoke could break legitimate admin workflows; sampled admin/settlement wrappers delegate to functions with explicit administrator checks, and CRM metrics check CRM roles.
- Leaked-password protection remains a Supabase Auth dashboard/configuration item; it was not changed by this branch.

## Code changes on the draft remediation branch

- Separate, fail-closed email and WhatsApp reply launch gates.
- Mailbox-specific Zoho OAuth credentials selected by authenticated CRM role.
- Orders inbox routes to the restricted `admin_operations` queue instead of being silently dropped or treated as general support.
- Environment variable checklist with no secret values.
- Documentation of intentionally service-only RLS tables.
- Trigger-only function ACL hardening.
- Contract checks for the corrected gates, mailbox routing, and security documentation.

## Required before any production cutover

1. Complete current GitHub Actions contract, syntax, Pages build, and full local migration replay checks.
2. Create/use a dedicated non-production Supabase environment and apply the missing CRM email migrations there; verify the Zoho intake RPC and role-scoped inbox before any production approval.
3. Configure the Zoho-side trigger/poller and per-mailbox OAuth credentials; run a synthetic inbound email through each queue.
4. Configure and verify Meta webhook secrets/signature validation and message receipt callbacks in non-production.
5. Invite/create separate Supabase Auth users for Seller Support, Sales, and Marketing, then grant least-privilege CRM roles. Do not reuse the single Customer Support account for every role.
6. Review all SECURITY DEFINER grants against function bodies and application call sites; keep intentional public-safe functions documented.
7. Enable leaked-password protection in Supabase Auth settings when available for the project's plan.
8. Obtain explicit approval before production migrations, production deployment, enabling provider send gates, or any live email/WhatsApp send.

## Current status

This branch is review/test work only. It does not make the live CRM fully operational and is not a production release.

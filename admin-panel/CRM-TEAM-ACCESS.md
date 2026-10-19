# CRM Team Access — setup and security

This implementation is on the `crm-team-access` branch only. It does not deploy the site or apply a database migration.

## How Sales and Marketing sign in
1. The CRM owner/admin creates an individual user in **Supabase Dashboard → Authentication → Users** using the Invite User flow. Do not enable public signup and do not share one common password.
2. The user accepts the invite and completes their own sign-in credentials.
3. The admin obtains that user's Auth UUID and assigns the role using the `public.crm_team_members` table. Example (replace values in SQL editor; only after migration approval):
   ```sql
   insert into public.crm_team_members (user_id, role, is_active, invited_by)
   values ('AUTH_USER_UUID', 'sales', true, auth.uid())
   on conflict (user_id) do update
   set role = excluded.role, is_active = true, updated_at = now();
   ```
   Use one of these roles: `customer_support`, `seller_support`, `sales`, or `marketing`. This manual role assignment is the current first slice; no public signup or browser-side user provisioning is exposed.
4. Staff sign in at `https://www.crm.fashionfussion.in/crm-login.html` with their own work email and password.

## Roles in this slice
- `administrator`: existing verified Fashion Fussion admin.
- `customer_support`: roster role for customer-support staff; dedicated support tools and scoped data policies are required before live work.
- `seller_support`: roster role for seller-support staff; dedicated support tools and scoped data policies are required before live work.
- `sales`: access to the shared seller-acquisition CRM.
- `marketing`: access to the shared seller-acquisition CRM.
- Admins provision accounts and control membership. Inactive or unlisted accounts are denied.
- This slice does not send email/WhatsApp automatically and does not grant customer/seller-panel access.

## Release gates
- Keep changes in draft until migration replay and RLS tests pass.
- The Supabase project ref configured in `admin-panel/supabase-config.js` must be verified as the intended CRM environment before applying migrations; it has not been proven to be non-production.
- Do not deploy to Cloudflare or apply remote migrations without explicit owner approval.
- Sales and marketing currently share lead write access; implement/verify granular permissions if their duties should differ.
- Customer Support and Seller Support may be rostered and can sign in, but see a setup-pending screen only; they do not receive seller-lead table access until dedicated support workspaces and RLS policies are implemented.

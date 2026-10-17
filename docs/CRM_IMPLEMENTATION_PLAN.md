# Fashion Fussion CRM

Development branch: `crm-development`, based on `main`. No production changes are authorized.

## Read-only audit findings
- Existing Admin Owner Operations already includes customer and seller directories, overview metrics, and customer/seller profile RPCs.
- Existing `public.seller_leads` contains 32 records and has admin-only RLS policies. Reuse it; do not create a duplicate leads table.
- Existing order, customer support, seller support, WhatsApp outbox/consent, and Zoho email outbox tables should be integrated by reference rather than copied.
- Admin modules are dynamically loaded from `admin-panel/supabase-config.js`.

## First implementation slice
Added `admin-panel/admin-crm.js` and registered it in the Admin runtime loader. It uses the existing seller lead table for lead search, status/priority changes, lead creation/editing, summary counts, and CSV export.

## Remaining work
- Run JavaScript syntax/build checks and verify the CRM module in an authenticated admin browser session.
- Add durable follow-up tasks and activity history only after reviewing existing schema/migration conventions.
- Add import validation and duplicate-resolution workflow.
- Test admin RLS and ensure non-admin users are denied.
- Integrate communication status from existing notification outboxes without sending live messages.

## Safety boundary
No Supabase migration has been applied, no production deployment or scheduler has been activated, and no live WhatsApp/email has been sent. Do not merge or deploy without explicit approval.

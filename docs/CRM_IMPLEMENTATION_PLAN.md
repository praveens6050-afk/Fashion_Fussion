# Fashion Fussion CRM

Development branch: `crm-development`, based on `main`. No production changes are authorized.

## Read-only audit findings
- Existing Admin Owner Operations already includes customer and seller directories, overview metrics, and customer/seller profile RPCs.
- Existing `public.seller_leads` contains 32 records and has admin-only RLS policies. Reuse it; do not create a duplicate leads table.
- Existing order, customer support, seller support, WhatsApp outbox/consent, and Zoho email outbox tables should be integrated by reference rather than copied.
- Admin modules are dynamically loaded from `admin-panel/supabase-config.js`.

## First implementation slice
Added `admin-panel/admin-crm.js` and registered it in the Admin runtime loader. It uses the existing seller lead table for lead search, status/priority changes, lead creation/editing, public contact phone/email, summary counts, and CSV export.\n\n## Second implementation slice (branch only)\n- Added `supabase/migrations/20261017110000_admin_seller_lead_crm.sql` with additive public contact fields, admin-only follow-up task table, and admin-only activity timeline table/policies.\n- Added `admin-panel/admin-crm-followups.js` and registered it to provide follow-up task scheduling, completion, activity logging, and timeline view. No outbound communication is triggered.\n- Added public seller contact phone/email to the CRM form, search, list, and CSV export.\n- Added CSV import preview with a 2 MB / 1,000-row limit, required headers, basic field validation, duplicate detection against loaded leads and within-file rows, and explicit confirmation before insert-only batches. Existing leads are never overwritten.\n- Lead creation, edits, status changes, and manual follow-up activity attempt to write to the CRM activity timeline; failures are surfaced as a warning rather than pretending the timeline was saved.\n- The migration is not applied to Supabase. Until it is applied in a reviewed environment, the task/activity panel reports the schema is unavailable; this is expected fail-safe behavior.

## Remaining work
- Run JavaScript syntax/build checks and verify the CRM module in an authenticated admin browser session.
- Add durable follow-up tasks and activity history only after reviewing existing schema/migration conventions.
- Add import validation and duplicate-resolution workflow.
- Test admin RLS and ensure non-admin users are denied.
- Integrate communication status from existing notification outboxes without sending live messages.

## Safety boundary
No Supabase migration has been applied, no production deployment or scheduler has been activated, and no live WhatsApp/email has been sent. Do not merge or deploy without explicit approval.

# Fashion Fussion CRM — Foundation Plan

## Status
- Development branch: `crm-foundation`
- Base branch: `cloudflare-seller`
- Base commit inspected: `9659f37da563ffe72ca40897b292d474fc567898`
- This branch is for development and verification only. Do not merge, deploy, apply production migrations, enable scheduled jobs, or send live communications without explicit approval.

## Goals
Build CRM functionality into the existing Fashion Fussion application rather than creating a separate customer database or duplicating existing order, profile, support, seller, or notification records.

## Initial read-only findings
Existing Supabase tables include `profiles`, `orders`, `customer_addresses`, `customer_support_requests`, and `customer_support_messages`. Existing seller panel includes operational, reporting, support, onboarding, and notification-related code. The schema and code must be mapped before adding new tables or routes.

## Proposed modules
1. Admin CRM overview and activity feed.
2. Seller acquisition leads and onboarding pipeline.
3. Customer profile and order timeline (read existing order/profile data).
4. Support queue and assignment (reuse existing support records).
5. Follow-up tasks, notes, tags, and team assignment.
6. Communication history referencing existing email/WhatsApp outboxes and delivery receipts.
7. Reports, CSV/XLSX import/export, duplicate detection, and audit logs.

## Proposed lead stages
`new` → `contacted` → `interested` → `documents_pending` → `verification` → `approved` → `active`; closed outcomes should record a reason. Lead stage transitions must be validated server-side and recorded in activity history.

## Data and security principles
- Do not duplicate customer or seller identity records where a canonical record already exists.
- Use foreign keys and indexes for relationships and common filters.
- Apply RLS and server-side authorization; never trust a client-supplied admin flag.
- Keep sensitive documents out of notes and logs; restrict contact details to authorized roles.
- Store consent and communication preferences separately from delivery status.
- Use idempotency/deduplication for imports and automated tasks.
- Avoid recording message contents or secrets in operational logs.
- Use least-privilege service credentials only on the server.
- Test policies with anonymous, customer, seller, and admin contexts.

## Implementation sequence
1. Map repository routes, authentication guards, current admin entry points, support tables, seller records, notification outboxes, and migration conventions.
2. Produce a schema/permission matrix and check for existing equivalent tables.
3. Add an additive, reversible migration for genuinely missing CRM entities and RLS policies.
4. Implement admin CRM navigation and read-only dashboard queries.
5. Implement lead lifecycle, activity history, follow-up tasks, and import validation.
6. Integrate existing customer/order/support/notification records without copying them.
7. Add unit, SQL policy, integration, and browser E2E tests.
8. Run checks on this branch and report release readiness. Deployment remains a separate approval step.

## Acceptance criteria
- Existing customer/seller/order flows remain unchanged.
- No production migration, deploy, cron activation, or live message send occurs during development.
- Every CRM read/write endpoint enforces role authorization.
- Cross-customer and cross-seller access tests fail closed.
- Lead changes and administrative mutations are auditable.
- Import rejects invalid rows and detects duplicates without partial silent corruption.
- Notifications are dry-run/mock tested and honor consent and feature gates.
- Build, test, migration replay, and browser smoke results are recorded before release.

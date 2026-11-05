# Seller GST Rule 14B readiness — 14 October 2026

Status: design checklist only; no production tax logic changed.

## Regulatory source
- 57th GST Council recommendations (8 Oct 2026): https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2320934
- PIB FAQs: https://www.pib.gov.in/FaqDetails.aspx?ModuleId=4&NoteId=160387&lang=1

## Proposed seller onboarding fields (future feature flag)
- Home-state GSTIN, PAN-linked registration and GST registration type.
- Warehouse state, warehouse identifier, PPoB/APoB selection, ECO warehouse consent status and date.
- Seller-declared ITC threshold eligibility; consent workflow and compliance-review evidence.
- Multiple GST registrations and state-specific inventory locations.

## Guardrails
- Rule 14B is a Council recommendation: do not mark as operational without the final notified rules, effective date and legal review.
- Do not suggest that registration in another state is eliminated.
- Do not promise Fashion Fussion warehouse consent when no eligible ECO warehouse exists.
- Do not ask sellers to upload raw Aadhaar, PAN or bank documents to public endpoints.
- No automatic GSTIN approval; rely on government verification and appropriate compliance checks.
- Keep all existing seller onboarding operational under currently effective rules.
- Do not hardcode delivery GST or change seller deductions without confirmed notification and finance sign-off.

## Acceptance criteria
1. Current seller signup works unchanged when feature flag is off.
2. State-specific registrations never leak across sellers; validate auth and RLS.
3. Warehouse consent is explicitly recorded and revocable.
4. A missing warehouse or unavailable registration scheme is handled without false eligibility claims.
5. Seller finance amounts and tax treatment remain unchanged until reviewed.
6. Validate desktop/mobile forms and seller support copy before release.

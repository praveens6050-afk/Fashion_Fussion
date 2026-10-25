# CRM Panel Agent Task

Repository: `praveens6050-afk/Fashion_Fussion`
Start with `crm-panel/AGENT_GUIDE.md`.

## Task for the coding agent
Please inspect the existing CRM implementation and fix the actual stuck-loading/browser smoke failure in this repository. Do not build a disconnected replacement. Begin by reviewing:
- `admin-panel/crm.html`
- `admin-panel/crm-auth.js`
- `admin-panel/crm-login.html`
- `admin-panel/crm-login.js`
- `scripts/check_crm_panel_contract.js`
- `scripts/crm_browser_smoke.js`

Known historical CI failure: https://github.com/praveens6050-afk/Fashion_Fussion/actions/runs/39975362335 — Playwright timed out waiting for `#dashboard`. Recheck the latest logs and current code; this is a clue, not a presumed root cause.

Expected deliverables:
1. Evidence-backed root cause.
2. Minimal fix on a working branch.
3. Passing relevant contract, build, and browser smoke tests, or a precise explanation of any blocked test.
4. A summary of changed files and commit SHA.

Security invariants:
- Public signup must remain disabled.
- CRM remains invitation-only.
- Admin/team membership checks and email binding must remain enforced.
- Keep dashboard hidden until authentication/authorization succeeds.
- Preserve RLS and least privilege; do not add auth bypasses or secrets.
- Do not deploy production without separate explicit authorization.

# Fashion_Fussion Cloudflare Deployment Map

Fashion_Fussion is deployed on Cloudflare Pages. Legacy Vercel deployment configuration is not part of the current production architecture.

## Canonical production projects

| Panel | Cloudflare Pages project | Production branch | Root directory | Production domain |
| --- | --- | --- | --- | --- |
| Customer | `fashion-fussion-customer` | `cloudflare-customer` | `customer-panel` | `https://fashionfussion.in` |
| Admin | `fashion-fussion-admin` | `cloudflare-admin` | `admin-panel` | `https://admin.fashionfussion.in` |
| Seller | `fashion-fussion-seller` | `cloudflare-seller` | `seller-panel` | `https://seller.fashionfussion.in` |

## Repository boundary

- Production deployment work happens on the matching `cloudflare-*` branch.
- Each Cloudflare Pages project must use only its matching production branch.
- Customer, Admin and Seller frontend packages stay isolated while sharing the authorized Supabase backend.
- Do not add legacy-host deployment manifests, legacy preview instructions, or legacy-host CI checks back into the repository.
- Privileged environment values belong in Cloudflare Pages environment variables/secrets and must never be committed.

## Verification boundary

Before a production change is considered complete:

1. The matching branch validation/deep-audit workflow must pass.
2. The matching Cloudflare Pages deployment must succeed.
3. Production smoke tests must pass on the custom domain.
4. Cross-panel flows must preserve Customer/Admin/Seller authorization boundaries.

Cloudflare project branch controls should be configured so unrelated `cloudflare-*` branches do not trigger builds for the wrong Pages project.

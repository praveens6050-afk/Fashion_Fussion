# Fashion Fussion Payout Gateway

Static-egress gateway for Seller payout tokenization and RazorpayX payouts.

## Security boundary

- Deploy this service only on a host with a stable public outbound IPv4 address.
- Allowlist that IPv4 address in RazorpayX before enabling payouts.
- Keep RazorpayX credentials only in this gateway's `.env`/secret store.
- Do not put RazorpayX credentials in browser code or Git.
- Cloudflare Admin/Seller should receive only `PAYOUT_GATEWAY_URL` and `PAYOUT_GATEWAY_TOKEN`.
- Request bodies are never logged by the application.
- Payout creation requires an idempotency key and forwards it as `X-Payout-Idempotency`.

## 1. Host requirements

A small Linux VPS/VM with:

- static public IPv4
- Docker Engine + Docker Compose plugin
- inbound TCP 80/443 allowed
- outbound HTTPS allowed

Recommended hostname: `payout-gateway.fashionfussion.in`.

## 2. DNS

Create an A record:

- Name: `payout-gateway`
- Value: the VPS static public IPv4

The hostname must resolve to the VPS before Caddy can obtain HTTPS certificates.

## 3. Install

Clone only this branch on the VPS:

```bash
git clone --branch payout-gateway --single-branch https://github.com/praveens6050-afk/Fashion_Fussion.git
cd Fashion_Fussion/payout-gateway
cp .env.example .env
```

Generate the gateway bearer token locally on the VPS:

```bash
openssl rand -hex 32
```

Put that value in `.env` as `GATEWAY_TOKEN` together with the RazorpayX credentials and customer identifier. Never commit `.env`.

Start the service:

```bash
docker compose up -d --build
```

Check health:

```bash
curl -fsS https://payout-gateway.fashionfussion.in/healthz
curl -fsS https://payout-gateway.fashionfussion.in/readyz
```

Expected readiness after secrets are configured:

```json
{"ready":true}
```

## 4. RazorpayX IP allowlist

In RazorpayX, allowlist the VPS static outbound IPv4 used by this gateway. Do not use a Cloudflare Pages/Workers egress IP for this.

## 5. Cloudflare production variables

Configure both `fashion-fussion-admin` and `fashion-fussion-seller` production environments with:

```text
PAYOUT_GATEWAY_URL=https://payout-gateway.fashionfussion.in/v1/gateway
PAYOUT_GATEWAY_TOKEN=<same generated gateway token>
```

No RazorpayX key/secret is required in Cloudflare after gateway-only mode is enabled.

## 6. Activation order

1. Gateway `/readyz` returns 200.
2. VPS public IPv4 is allowlisted in RazorpayX.
3. Admin and Seller Cloudflare projects have the gateway URL/token.
4. Seller links a payout account; the provider fund-account reference is stored server-side.
5. KYC and payout account are approved by Admin.
6. Create a controlled settlement and perform the smallest provider-supported test payout only after all previous checks pass.
7. Confirm the provider result and settlement reconciliation before any larger payout.

## API

### `GET /healthz`

Liveness only. Does not expose configuration or secrets.

### `GET /readyz`

Returns `200 {"ready":true}` only when all required gateway/RazorpayX environment variables exist.

### `POST /v1/gateway`

Requires:

```text
Authorization: Bearer <GATEWAY_TOKEN>
Content-Type: application/json
```

Supported server-to-server operations:

- `create_fund_account`
- `create_payout`

`create_payout` additionally requires an `Idempotency-Key` header. The gateway forwards the same key to RazorpayX as `X-Payout-Idempotency`.

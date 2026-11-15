# Provider supply, negotiation and settlement workflow

## Workspace layout

The existing React + Vite storefront remains the source of truth for customer and seller features. The new workspace exposes independently buildable role entry points while reusing the existing application components and API:

- `apps/customer-web`: storefront entry point (development port 4173).
- `apps/seller-hub`: Seller Hub entry point (development port 4175; routes to `/seller-hub`).
- `apps/provider-portal`: provider-only entry point (development port 4174).
- `packages/shared-types`: role, product and settlement contracts.
- `packages/shared-utils`: role constants, editable-state rules and INR formatting.
- `server.ts`: shared Express API gateway and existing session / CSRF boundary.

This is an incremental modular workspace, not yet a full extraction of all customer and seller components into their own source trees. The customer and seller apps currently mount the existing root React application. They can be deployed independently by building their workspace package and routing API calls to the shared backend.

## Local development

Run the API / existing app server in one terminal:

```bash
bun run dev
```

Run any role frontend in another terminal:

```bash
bun run dev:customer
bun run dev:seller
bun run dev:provider
```

The Vite role apps proxy `/api` and `/uploads` to `http://localhost:3000`. For deployments, serve each built app on its own domain or path and configure a same-site reverse proxy to the API. The current session cookie is host-only; separate subdomains need a deliberately configured shared authentication boundary before cross-subdomain deployment.

Build / type-check all role apps:

```bash
bun install
bun run lint
bun run build
bun run build:workspace
```

## Provider lifecycle

1. A verified seller creates an invitation using `POST /api/seller/providers/invites`. The raw 256-bit token is returned once; only its SHA-256 hash is stored. It expires after 48 hours.
2. The invited user signs in through the existing Supabase sign-in flow and opens `/provider/onboard?token=...`. The onboarding API verifies invite status, expiry and invited email (when specified), encrypts tax and payout details using AES-256-GCM, links the provider to the seller, changes the account role to `PROVIDER`, and rotates the session.
3. Providers create drafts, upload compressed images, edit permitted fields and submit products for seller review.
4. Sellers can request revisions/counter-prices. Every seller negotiation / approval is appended to the product history. Provider edits are blocked after approval.
5. Sellers approve the provider cost, then publish a separate retail Product with MRP, selling price, stock, payment rules, return policy and trust flags. Provider identity and cost fields are excluded from normal Product queries with Mongoose `select: false`.
6. On delivery, the API creates an idempotent provider payable from the approved base-cost snapshot. It remains in a 24-hour clearance window. Cancelled orders void unsettled payables; seller-received returns reduce or void unsettled payables.
7. Sellers record a manual bank transfer UTR for one or more ready settlements. The receipt JSON is AES-256-GCM encrypted at rest and can be retrieved by the linked seller and provider.

## API surface

| Role | Endpoint | Purpose |
|---|---|---|
| Seller | `POST /api/seller/providers/invites` | Generate 48-hour provider invite |
| Public | `GET /api/provider/invites/:token` | Validate invite metadata |
| Signed-in invitee | `POST /api/provider/onboarding/accept` | Submit KYC/business profile |
| Provider | `GET/POST /api/provider/products` | List / create provider catalog drafts |
| Provider | `PATCH /api/provider/products/:id` | Edit only pre-approval product fields |
| Provider | `POST /api/provider/products/:id/submit` | Submit / resubmit for review |
| Provider | `POST /api/provider/upload` | Authenticated compressed image upload |
| Seller | `GET /api/seller/providers/products/review-queue` | Review linked provider catalog |
| Seller | `POST /api/seller/providers/products/:id/negotiate` | Counter / request changes |
| Seller | `POST /api/seller/providers/products/:id/approve` | Approve provider base cost |
| Seller | `POST /api/seller/providers/products/:id/publish` | Create retail storefront listing |
| Seller / Admin | `GET /api/seller/providers/:providerId/dashboard` | Read-only, audited oversight |
| Seller / Admin | `GET /api/seller/provider-settlements` | Payable ledger |
| Seller / Admin | `POST /api/seller/provider-settlements/settle` | Mark single / batch UTR payout |
| Provider | `GET /api/provider/settlements` | Receivable ledger |
| Provider / Seller | `GET .../settlements/:id/receipt` | Encrypted receipt retrieval |
| Admin | `PATCH /api/admin/providers/:providerId/kyc` | KYC decision |

## Required configuration

- `SESSION_SECRET`: strong random production secret.
- `ENCRYPTION_MASTER_KEY`: base64-encoded 32-byte key (generate with `openssl rand -base64 32`).
- `APP_URL`: canonical app origin.
- `CORS_ALLOWED_ORIGINS`: exact comma-separated frontend origins.
- `VITE_CUSTOMER_APP_URL`: optional customer app origin for provider sign-in return flow.

MongoDB must be configured for production persistence. The current provider settlement ledger uses unique idempotency keys and conditional writes. Wallet / other transactional commerce operations still require a replica set or sharded MongoDB deployment.

## Production readiness boundaries

- Payouts are recorded as manual UTR transfers; no bank/UPI payout rail is integrated.
- Seller invite email delivery is not wired to an email provider; the secure one-time link is returned for copying.
- KYC document verification is represented by an admin status decision; automated GST/bank verification is not integrated.
- The modular apps share one API and currently reuse the root customer/seller React app. Full package-level extraction and independent identity-provider callback configuration are follow-up work.
- Provider notifications are not yet delivered via email/WhatsApp; the product status and negotiation history are visible in the portal and seller review queue.
- Settlement availability is released on the next provider/seller ledger read after the 24-hour clearance time. A scheduled release worker would be preferable at scale.
- Return adjustment only applies while a provider settlement is unsettled. A return approved after payout requires a separate provider debit/credit adjustment workflow.
- Live deployment, Supabase role-transition testing, multi-seller invite testing, Mongo replica-set migration rehearsal and end-to-end sandbox tests are required before production launch.


## Provider demo test accounts

The local / non-production seed includes two synthetic provider accounts for exercising the Provider Portal:

| Demo account | Email | Demo user ID | Linked seller |
|---|---|---|---|
| Aarav Artisan Supply | `provider.aarav@example.com` | `usr_provider_1` | Meera Zaveri |
| Nisha Craft Works | `provider.nisha@example.com` | `usr_provider_2` | Raghavendra Rathore |

These are role-switch demo accounts, not email/password credentials. Sign in through the app's demo-account switcher, or call `POST /api/auth/signin` with a JSON body such as:

```json
{ "quickDemoUserId": "usr_provider_1", "email": "provider.aarav@example.com" }
```

Use `usr_provider_2` and `provider.nisha@example.com` for the second account. The email fallback also supports MongoDB-seeded records whose database IDs are generated at startup. Provider profile fixtures are created only when `ENCRYPTION_MASTER_KEY` is configured; they use synthetic tax / settlement values and remain in `PENDING` KYC state. Demo role switching is disabled when `NODE_ENV=production`. Never use these accounts or fixture values for real transactions or KYC.

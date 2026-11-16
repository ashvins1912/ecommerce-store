# Provider supply, negotiation and settlement workflow

## Workspace layout

The existing React + Vite storefront remains the source of truth for customer and seller features. The new workspace exposes independently buildable role entry points while reusing the existing application components and API:

- `apps/customer-web`: storefront entry point (development port 4173).
- `apps/provider-portal`: provider-only entry point (development port 4174).
- `packages/shared-types`: role, product and settlement contracts.
- `packages/shared-utils`: role constants, editable-state rules and INR formatting.
- `server.ts`: shared Express API gateway and existing session / CSRF boundary.

This is an incremental modular workspace, not yet a full extraction of all customer and seller components into their own source trees. The customer app mounts the root storefront. Seller operations are not a separate app: authenticated SELLER users land on `SellerHubView` inside the main application, and only sellers receive the Storefront tab. The Provider Portal is a separate role frontend. The seller dashboard is not independently deployed.

## Local development

Run the API / existing app server in one terminal:

```bash
bun run dev
```

Run the customer and provider frontends independently in another terminal:

```bash
bun run dev:customer
bun run dev:provider
```

Run the combined local stack (API + customer + provider, with seller dashboard served by the main app) using `bun run dev:all`. Start the optional logistics worker with `START_LOGISTICS_WORKER=1 bun run dev:all`.

The Vite role apps proxy `/api` and `/uploads` to `http://localhost:3000`. For deployments, serve each built app on its own domain or path and configure a same-site reverse proxy to the API. The current session cookie is host-only; separate subdomains need a deliberately configured shared authentication boundary before cross-subdomain deployment.

Build / type-check the customer and provider frontend packages:

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
| Provider | `GET /api/provider/settlements` | Searchable, sortable, paginated receivable ledger |
| Provider | `GET /api/provider/shipments` | Safe fulfilment queue for linked sellers and provider-owned published products |
| Provider | `POST /api/provider/shipments/manual` | Record provider-managed courier and tracking details; atomically move Packed to Shipped |
| Provider / Seller | `GET .../settlements/:id/receipt` | Encrypted receipt retrieval |
| Admin | `PATCH /api/admin/providers/:providerId/kyc` | KYC decision |


## Provider fulfilment and carrier workflow

1. **Provider carrier onboarding:** Provider selects an active carrier from the platform registry (currently Shiprocket and Shadowfax adapters), submits credentials, and the API validates the credentials before encrypting them with the shared AES-256-GCM field-encryption key. Credentials are stored in the provider-owned PostgreSQL table `provider_carrier_configs`; list endpoints never return them. A generated webhook secret is returned once.
2. **Provider pickup locations:** Provider creates a pickup warehouse in `provider_warehouses`. These locations are provider-owned and cannot be substituted with a seller warehouse ID.
3. **Seller authorization:** Provider requests a fulfilment delegation for one linked seller, the configured carrier codes, and exact delivery-data fields. The verified seller reviews the request in Shipping & Logistics and approves or rejects it. The seller can later revoke an active delegation. Approval is limited to fields the seller has separately enabled in `carrierDisclosure`; Shiprocket additionally requires the email permission.
4. **Rates and app booking:** Provider shipment queue shows eligible orders only after an active delegation exists. Provider requests a live rate using its selected carrier account and pickup location, then selects a service. The booking API revalidates order ownership, provider ownership of every order line, seller delegation, payment / Packed state, quote availability and current seller disclosure policy. It creates a provider-owned shipment intent and a durable `CREATE_SHIPMENT` job.
5. **Worker privacy checks:** The logistics worker decrypts the queued minimum delivery payload, verifies provider carrier ownership, reloads the current seller disclosure policy and active provider delegation, and repeats the authorization check immediately before calling the carrier. Revoked or expired delegation, disabled carrier account, or changed disclosure scope fails closed. The provider portal never receives recipient name, phone, email or delivery address.
6. **Labels and tracking:** Carrier response persists provider shipment ID, AWB, label URL, manifest URL, pickup status and ETA in PostgreSQL. Signed webhooks and tracking polls append idempotent tracking events, enforce monotonic state transitions, and update normalized shipment status. Provider shipment list exposes AWB, label / manifest links, pickup and a safe tracking timeline.
7. **Retries and fallback:** Failed bookings can be retried by the provider only while the seller delegation remains active and the provider carrier account remains enabled. Manual courier and tracking-reference entry remains available for eligible Packed orders, including a failed app booking with no AWB. Manual fallback does not create a second app carrier booking. The provider cannot dispatch mixed-provider orders; those remain seller-managed.

Provider logistics endpoints:
- `GET/POST /api/provider/logistics/carriers`, `PATCH /api/provider/logistics/carriers/:id/active`
- `GET/POST /api/provider/logistics/warehouses`
- `GET/POST /api/provider/fulfillment-delegations`
- Seller: `GET /api/seller/providers/fulfillment-delegations`, `POST .../:providerId/approve`, `POST .../:providerId/reject`, `POST .../:providerId/revoke`
- `POST /api/provider/shipments/rates`, `POST /api/provider/shipments/book`, `POST /api/provider/shipments/:id/retry`
- `GET /api/provider/shipments` returns only safe order summaries and provider-owned shipment tracking metadata.
- `POST /api/provider/shipments/manual` records a manually arranged courier dispatch without disclosing customer data to the portal.

Security boundaries:
- Seller privacy settings remain the source of truth. A delegation does not override a seller's current privacy settings.
- Provider credentials are never stored under a seller account and never returned to the browser after save.
- Customer delivery details are encrypted in the logistics job payload and only decrypted inside the private logistics worker.
- A provider may manage only an order whose seller is linked and whose every product line belongs to that provider. Mixed carts / orders are excluded from provider booking.
- Disabling a provider carrier prevents new bookings and retries. Existing shipments can still accept carrier webhooks and tracking updates.
- The SQL shipment table enforces one shipment per seller order. A seller-created shipment and a provider-created shipment cannot both book the same order.
- Manual fallback is restricted to the same provider-owned order scope and only runs while an app booking is absent or terminally failed without an AWB.

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


## Non-production demo test accounts

On every MongoDB application startup, the server checks demo users by normalized email and inserts only missing records using an insert-only upsert backed by the unique email index. This is safe across restarts and concurrent app instances: existing users are not overwritten and their role/profile is not changed. The sample catalogue is seeded only when the products collection is empty, and its seller references use the actual MongoDB user IDs returned by the upserts. The local JSON development store also ensures the same role fixtures.

| Role | Demo account | Email | Demo user ID |
|---|---|---|---|
| Admin | Kala & Karat Ops | `ops@kalaandkarat.in` | `usr_admin_1` |
| Customer (BUYER) | Ananya Mehta | `ananya.mehta@example.com` | `usr_buyer_1` |
| Seller | Meera Zaveri | `meera@zaveriatelier.in` | `usr_seller_1` |
| Provider | Aarav Artisan Supply | `provider.aarav@example.com` | `usr_provider_1` |
| Provider | Nisha Craft Works | `provider.nisha@example.com` | `usr_provider_2` |

These are quick role-switch demo accounts, not email/password credentials. Use the app's demo-account selector or call `POST /api/auth/signin` with the matching `quickDemoUserId` and `email`. The email fallback resolves MongoDB records even though MongoDB generates their ObjectIds at startup. Provider identities and provider profile/catalog fixtures are excluded in production; role-switch demo sign-in is also disabled in production. Provider fixtures require `ENCRYPTION_MASTER_KEY`, use synthetic tax/settlement values and remain in `PENDING` KYC state. Never use these accounts or fixture values for real transactions, shipping, tax, settlement or KYC.


## Role landing and responsive UI contract

- A signed-in SELLER lands on the seller dashboard in the main application. The dashboard exposes a Storefront navigation tab only to the SELLER role; it is not shown to buyers, providers or admins.
- A signed-in PROVIDER lands on the Provider dashboard. Provider APIs remain role- and tenant-scoped; the frontend does not grant access.
- BUYER / guest sessions land on the customer storefront.
- Tailwind CSS v4 is the UI utility system. The shared stylesheet imports `tailwindcss` and scans `src`, `apps` and `packages`; Vite uses `@tailwindcss/vite`. Provider dashboard layouts use responsive utility breakpoints, min-width-safe grids and overflow-managed tables. Seller dashboard components use the shared Tailwind stylesheet.
- Verify at 360px, 390px, 768px, 1024px and 1440px widths. Check no horizontal page overflow, keyboard focus, touch target sizing, form wrapping, dialog scrolling and table horizontal scrolling.

## Customer privacy and carrier disclosure enforcement

Customer delivery details are seller-controlled data. The privacy controls are enforced by the API and logistics worker; hiding fields in the React UI is not an authorization boundary.

- `GET/PUT /api/seller/privacy-settings` reads and writes the seller's own policy. The request schema is strict, seller access requires a verified seller session (Admin is permitted for administration), responses are `private, no-store`, and a missing policy is treated as all-false (deny by default).
- The seller must explicitly enable recipient name, phone and delivery address before a shipment can be queued. Customer email is a separate optional permission; Shiprocket additionally requires both explicit email permission and a non-empty buyer email. A carrier that does not require email is not sent an email when the buyer email is absent.
- `POST /api/seller/logistics/shipments` verifies that the order and carrier configuration belong to the authenticated seller, evaluates the current disclosure policy, and records an authorization audit with the exact fields, carrier, order, actor and timestamp. The queue payload contains encrypted delivery data rather than plaintext customer contact/address fields. The audit progresses through `AUTHORIZED`, `DISPATCHING`, `DISPATCHED`, `BLOCKED`, `FAILED` or `NOT_DISPATCHED`; transient failed jobs may retry against the same audit record.
- The logistics worker decrypts the minimum delivery payload, reloads the seller's current policy and re-evaluates authorization. It compares the currently authorized field set with the queued field set and fails closed if consent has been revoked or changed. It repeats the check immediately before calling the carrier adapter. The worker refuses to dispatch if the policy database or encryption key is unavailable.
- All provider-facing profile, catalogue and receivable read/write responses use explicit allowlist DTO projections. Provider product negotiation comments are omitted because they are free-form text and could accidentally contain personal data; the provider UI shows a generic workflow status instead. The safe order summary helper is available for any future provider order view; do not return raw `OrderModel` documents from provider routes.
- Provider accounts have no order-list or customer-contact endpoint. Seller order and fulfilment operations remain seller-scoped; carrier disclosure is the only path that sends required delivery fields to an external carrier.

Run the privacy regression suite with:

```bash
npm run test:privacy
```

Production deployment requirements:
- Configure MongoDB and `ENCRYPTION_MASTER_KEY` on both the API and logistics worker. They must use the same key so queued ciphertext can be decrypted.
- Configure the logistics PostgreSQL service-role connection and apply SQL migrations in order: `2026-11-logistics-postgres.sql`, `2026-11-carrier-adaptive-feedback.sql`, then `2026-11-provider-logistics.sql` before enabling provider booking.
- Deploy the API and worker from the same release. Do not run a worker build that predates the privacy recheck.
- Keep the worker private; it must not expose an HTTP endpoint for reading queue payloads or customer data.
- Before enabling a carrier, verify its sandbox request contains only the seller-authorized recipient fields. Test both an enabled and revoked policy, including revocation while a job is queued.

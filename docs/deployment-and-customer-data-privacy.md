# Independent deployment, startup and customer-data privacy runbook

**Scope:** Customer web, Seller Hub, Provider Portal, shared API, logistics worker, MongoDB, logistics Postgres/Supabase, Redis, object storage, payment providers and courier integrations.

> The role frontends are independently buildable, but currently share the root React application and API/domain layer. This is an incremental modular monorepo, not a set of fully extracted microservice backends. The privacy controls below define required behavior; they are not a claim that every control is already implemented. Do not enable live customer-data sharing until API enforcement and tests pass.

## 1. Deployment topology

| Deployable | Source / command | Responsibility | Must not receive |
|---|---|---|---|
| Customer web | apps/customer-web; bun run build:customer | Storefront, account, cart, checkout, order tracking | DB credentials, service-role keys, payment/carrier secrets, encryption key |
| Seller Hub | apps/seller-hub; bun run build:seller | Seller catalogue, orders, payments, carrier config, customer-sharing policy | DB credentials or other sellers' secrets |
| Provider Portal | apps/provider-portal; bun run build:provider | Supplier onboarding, product drafts, negotiation, settlement views | Customer PII, customer contact/address, payment/carrier credentials |
| API | server.ts; bun run start | Auth, authorization, DTO filtering, commerce APIs, webhooks, Mongo persistence | — |
| Logistics worker | apps/logistics-worker; bun run logistics:worker | Claim shipment jobs and call carrier adapters | General customer profile, order history, payment method/token, unrelated tenant data |
| MongoDB | Managed replica-set / sharded cluster | Commerce source of truth | Public access |
| Logistics Postgres/Supabase | LOGISTICS_SUPABASE_* | Carrier configs, warehouses, shipment jobs, tracking/outcomes | Browser access to service-role key |
| Redis / Upstash | UPSTASH_REDIS_* | Rate limits and bounded cache | Source-of-truth stock/order/payment state |
| R2/object storage | R2_* | Product media and permitted documents | Public access to private customer documents |

Deploy each frontend as its own static site and API and worker as separate server processes. Route each frontend's /api and /uploads paths to the shared API. Provider Portal also needs /src/assets proxied to the API if using the current asset flow. Use a shared API origin where practical. The current session cookie is host-only; separate subdomains need an explicitly tested cookie-domain, Secure, SameSite, CSRF and OAuth callback arrangement. Prefer a same-site reverse proxy/BFF rather than assuming cookies cross subdomains.

## 2. Service-level environment configuration

Set variables in the hosting platform's **individual service environment settings**. Do not copy the entire root .env into every service. Vite variables are embedded in browser bundles and are public.

### 2.1 API service (private runtime)

- NODE_ENV=production and PORT (host-assigned; server binds 0.0.0.0)
- APP_URL (canonical public app/API URL)
- SESSION_SECRET (unique high-entropy secret)
- MONGODB_URI (private Mongo replica-set/sharded URI; transactions required)
- SUPABASE_URL and SUPABASE_ANON_KEY (auth project and public anon key)
- SUPABASE_SERVICE_ROLE_KEY only if the API path needs privileged access; server-only
- ENCRYPTION_MASTER_KEY (base64-encoded 32-byte AES key)
- CORS_ALLOWED_ORIGINS (exact comma-separated HTTPS frontend origins)
- VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (public browser auth config for root app build)
- GEMINI_API_KEY and CRON_SECRET (optional server-side AI / protected cron)
- UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (optional Redis cache/rate limit)
- R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_CDN_URL (optional object storage)
- WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID (optional Meta WhatsApp)
- EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE (optional Evolution API)

Generate fresh values: openssl rand -base64 32 for ENCRYPTION_MASTER_KEY and openssl rand -hex 48 for SESSION_SECRET. The encryption key must decode to exactly 32 bytes. Back it up in a managed vault; losing it can make encrypted credentials unrecoverable. Rotation requires a versioned re-encryption migration.

### 2.2 Customer web (public build-time only)

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY (public anon/publishable key only)

The customer Vite config proxies /api and /uploads to localhost:3000 in development. In production, configure the static host/reverse proxy to route these paths to the deployed API. Do not add MONGODB_URI, SESSION_SECRET, ENCRYPTION_MASTER_KEY, SUPABASE_SERVICE_ROLE_KEY, Redis token, payment/carrier credentials or storage secrets.

### 2.3 Seller Hub (public build-time only)

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

Seller Hub is built independently but reuses the shared application/API. Configure /api and /uploads routing to the API. Seller payment credentials (Razorpay, Stripe, or any other provider only when its server adapter is implemented), webhook secrets, carrier credentials and warehouse contacts are entered through authenticated seller APIs and stored server-side encrypted. They are not Vite variables. The server must reject unsupported payment/carrier providers rather than accepting arbitrary names.

### 2.4 Provider Portal (public build-time only)

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_CUSTOMER_APP_URL (if needed for sign-in return/navigation)

Provider Portal means the supplier/provider role, not courier/driver. It must receive provider-scoped DTOs only and must never receive customer PII, carrier credentials or server secrets. In production route /api, /uploads and /src/assets to the API where the current app needs them.

### 2.5 Logistics worker (private runtime)

- NODE_ENV=production
- LOGISTICS_SUPABASE_URL
- LOGISTICS_SUPABASE_SERVICE_ROLE_KEY (worker-only; never browser)
- ENCRYPTION_MASTER_KEY (compatible key/version to decrypt seller carrier credentials)
- LOGISTICS_WORKER_POLL_MS (optional; defaults to 1500 ms)
- SHIPROCKET_API_BASE_URL and SHADOWFAX_API_BASE_URL (optional; use production endpoints in production)

The root script bun run logistics:worker sets RUN_LOGISTICS_WORKER=1. Worker credentials must be fetched only for the seller-owned carrier config attached to a claimed job. Do not accept carrier credentials from the browser. The current worker payload includes recipient name, phone, address, postal code and item/shipping data; the current Shiprocket path requires recipient email. The seller-controlled disclosure service and explicit opt-in for email must be implemented before enabling this path for live shipments.

### 2.6 Data services

- MongoDB: managed replica set/sharded cluster, TLS, private networking/allow-list, least-privilege user, backups/PITR. Checkout and ledger transactions require this topology; never use local JSON persistence in production.
- Logistics Postgres/Supabase: apply all SQL migrations, including src/server/migrations/2026-11-carrier-adaptive-feedback.sql, before enabling adaptive feedback. Enable RLS for user-facing access; keep service-role operations server-side.
- Redis: acceleration/rate limits only; Mongo/Postgres remain correctness authorities.
- R2: private buckets for customer documents and labels; short-lived purpose-scoped signed URLs. Public CDN only for intentionally public product media.

## 3. Single-command local startup

Install dependencies and configure a local non-production .env, then run:

```bash
bun install
cp .env.example .env
bun run dev:all
```

The root command starts the API and all three role frontends:

| Process | Local URL |
|---|---|
| API/root app | http://localhost:3000 |
| Customer web | http://localhost:4173 |
| Provider Portal | http://localhost:4174 |
| Seller Hub | http://localhost:4175 |

The Vite apps proxy /api and /uploads to port 3000; Provider Portal also proxies /src/assets. The logistics worker is opt-in because it needs its own logistics database and carrier credentials:

```bash
START_LOGISTICS_WORKER=1 bun run dev:all
```

Press Ctrl+C to stop the combined processes. Run one service independently with bun run dev, bun run dev:customer, bun run dev:provider, bun run dev:seller or bun run logistics:worker.

Production checks/builds:

```bash
bun run lint
bun run test
bun run build
bun run build:workspace
```

Deploy dist/customer-web, dist/seller-hub and dist/provider-portal independently. Deploy API and worker separately. Do not run the logistics worker inside every API replica; start with one worker and scale only after queue concurrency, provider rate limits and idempotency are verified.

## 4. Customer privacy: separate supplier and delivery roles

Three identities must not be conflated:

1. **Supplier/provider:** seller-linked supplier using Provider Portal. It has no routine need for the end customer's identity, phone, address, email, payment details or order history.
2. **Delivery carrier/courier/assigned operator:** fulfills one assigned shipment and needs a limited set of shipment/recipient data to complete delivery.
3. **Seller/authorized staff:** manages its own customer order for a legitimate fulfilment/support purpose, subject to applicable law, customer notices/consent and role permissions.

### Default visibility

| Data | Owning seller | Supplier/provider portal | Assigned carrier / delivery operator |
|---|---|---|---|
| Customer name | Own order, purpose checked | **Hidden** | Only if needed for active delivery |
| Phone | Seller policy + operational need | **Hidden** | Masked/proxy by default; direct only with seller opt-in if necessary |
| Email | Seller policy + operational need | **Hidden** | **Hidden by default**; documented carrier need + seller opt-in |
| Delivery address | Own order, fulfilment purpose | **Hidden** | Minimum complete address for assigned active shipment |
| Order/shipment reference | Own seller order | Opaque supplier case reference only | Shipment and carrier booking reference |
| Items/quantity | Own order | Supplier's own SKU/quantity only | Minimum shipment manifest |
| Selling price/payment method/card/UPI | Role-appropriate summary; never raw secrets | **Hidden** | **Hidden**; COD amount only if collection requires it |
| Customer history/saved addresses/preferences | Only if authorized and necessary | **Hidden** | **Hidden** |
| Risk notes, KYC, seller margin/internal notes | Restricted roles | **Hidden** | **Hidden** |

Supplier/provider privacy must be enforced in API queries and DTOs, not by hiding fields in React. Provider endpoints must not join/populate customer profiles.

### Seller-controlled delivery disclosure policy

Add per-seller settings with a preview of exactly what each selected carrier receives. Suggested policy fields:

- shareRecipientNameForDelivery: enabled only when required for delivery.
- shareRecipientPhoneForDelivery: false by default; prefer masked relay/proxy calls.
- shareDeliveryAddressForDelivery: enabled only for a booked delivery; delivery requires an address.
- shareRecipientEmailForDelivery: false by default; require documented carrier-specific necessity and explicit opt-in.
- shareShipmentItemsForDelivery: minimum manifest only; exclude unrelated basket lines and sensitive descriptions.
- shareCodAmountForDelivery: only for COD and only the collection amount.
- allowCarrierProofOfDelivery: only necessary proof metadata/media, with retention.
- policyVersion, updatedBy, updatedAt and reason: immutable audit history.

Require a reason for enabling email/direct phone. If a carrier requires a field the seller has not approved, fail closed or offer another carrier; never silently disclose. Revocation blocks future access but cannot erase data already transmitted or undo a shipment in transit; explain this in the UI. Seller settings cannot override law, customer rights or mandatory carrier contract terms.

### Just-in-time delivery access

1. Seller confirms order and selects carrier/service.
2. API verifies seller/tenant ownership, order state, active carrier config, seller policy and carrier required-field schema.
3. API creates a shipment-specific disclosure snapshot tied to one shipment, carrier config and purpose.
4. Worker claims the job and retrieves only that approved snapshot; it must not read a general customer profile.
5. Carrier receives minimum payload over TLS. Prefer carrier-side masked phone/relay.
6. Access expires on terminal shipment state or short TTL. Re-delivery/return requires fresh purpose-checked authorization.
7. Append-only audit records actor/service, seller, shipment, disclosed field names, policy version, purpose, time and outcome. Never log raw PII or secrets.

### Provider portal isolation

- Provider sees only its catalog drafts, negotiation state, approved base cost, payable state and supplier-facing instructions.
- No customer-profile joins/populates in provider dashboard, product, settlement or analytics queries.
- Supplier analytics must be aggregate/pseudonymized; suppress small cohorts where re-identification is possible.
- Exceptions use opaque case references and seller-mediated messaging, never customer direct contact.
- Enforce provider role, provider-to-seller relationship, tenant scope and resource ownership on every request. Provider is not a carrier role.

### API security contract

- Separate ProviderOrderDTO, SellerOrderDTO, CarrierShipmentDTO and CustomerOrderDTO; never serialize Mongoose documents directly.
- Explicit allowlist mapping; no broad order-object spread in role responses.
- Deny by default; enforce role, tenant, seller relationship, resource ownership and purpose.
- Use DB projections so provider queries never fetch PII.
- Build carrier payloads through a disclosure service evaluating seller policy + carrier requirements + shipment state. Never pass raw order/customer objects to adapters.
- Encrypt at rest, TLS in transit, managed secrets, credential rotation, no PII in logs/traces.
- Short-lived signed URLs for labels/proof-of-delivery; private evidence storage.
- Rate-limit and alert on bulk PII reads and cross-tenant identifier probing.
- Provide customer notice, access/correction/deletion and retention workflows consistent with applicable law.

## 5. Mandatory privacy and tenant-isolation tests

Release blocker. Add automated tests proving:
1. Provider response snapshots contain no customer name, phone, email, address, profile ID, payment fields or unrelated order lines.
2. Provider from seller A cannot read seller B's products, settlements, orders or shipment IDs.
3. Carrier payload contains only fields enabled by seller policy and required by that service.
4. Email and direct phone are absent by default and require explicit seller opt-in.
5. Unassigned carrier cannot fetch a shipment; carrier assigned to A cannot access B.
6. Terminal shipment or expired TTL blocks further PII retrieval; re-delivery needs fresh authorization.
7. Policy changes are versioned/audited; revocation blocks future disclosures.
8. Customer order APIs cannot enumerate another customer's data.
9. Logs, traces, analytics and queue metadata contain no raw PII/secrets.
10. Concurrent policy changes and booking use a consistent policy snapshot; fail closed if policy validation is unavailable.
11. Run seeded-PII tenant tests across customer, seller, supplier/provider, carrier and admin roles.
12. Sandbox-test each enabled adapter and assert exact outbound serialized payloads.

## 6. Deployment sequence and release gates

1. Provision Mongo replica set and logistics Postgres/Supabase; configure TLS, private networking, backups and least privilege.
2. Apply Mongo/SQL migrations, including carrier feedback migration; verify indexes and RPCs.
3. Configure API variables; verify auth, health, Mongo transaction support and webhook signatures.
4. Deploy each frontend with public Vite variables only; configure /api, /uploads and provider asset routing, OAuth redirects, cookies and CSRF.
5. Deploy worker with private variables; start one replica and test queue claim, retries, idempotency and carrier sandbox.
6. Configure payment provider per seller through Seller Hub; encrypt credentials and verify webhook signatures. Only implemented adapters are selectable.
7. Configure carrier per seller; validate credentials, rates, booking, labels and tracking; review disclosure policy before live booking.
8. Enable carrier sharing only after privacy tests pass. Start with minimum recipient name and address; prefer masked phone. Keep supplier/provider portal PII-free.
9. Run checkout concurrency, duplicate webhook, tenant isolation, payment/carrier sandbox, restore and load/regression tests. Monitor queue lag, webhook retries, carrier failures, rate limits and disclosure audit events.

## 7. Release checklist

- [ ] Separate environment/secret scopes for API, customer, seller, provider and worker.
- [ ] No secrets in browser bundles, source maps, build logs or Git.
- [ ] API/worker use production DBs; no local JSON fallback.
- [ ] Mongo transactions/indexes and logistics SQL migrations/RLS verified.
- [ ] CORS, OAuth, cookies and CSRF tested on all domains.
- [ ] Payment/carrier signatures, duplicate and out-of-order webhooks tested.
- [ ] Seller policy stored/versioned/enforced by API.
- [ ] Provider responses proven PII-free.
- [ ] Carrier allowlist, assignment, just-in-time access and audit tested.
- [ ] Retention/deletion, incident response and key rotation documented.
- [ ] Monitoring, rollback and database restore rehearsed.

## 8. Current implementation caveats

- The workspaces are independently buildable but share one API/domain layer; this is not a fully extracted microservice architecture.
- Current logistics worker payload includes recipient name, phone, destination address, postal code and item data; its Shiprocket path currently requires recipient email. Seller-controlled field-level disclosure, default-deny email/phone, provider PII-free response tests and disclosure audit must be implemented and verified before claiming this privacy model is enforced.
- The worker uses a privileged Supabase service key. Keep it worker-only and scope database/RPC permissions to the minimum.
- Seller-configured payment-provider availability depends on implemented server adapters and webhook support. Never claim an unimplemented provider is supported.
- Build success/local startup does not certify production readiness. Complete privacy, integration, concurrency and load tests before live customer data or shipments.

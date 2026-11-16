# Independent deployment and customer-data privacy runbook

> The customer, seller and provider workspaces are independently buildable, but currently share the root React application and server.ts. They are not fully extracted microservices. This guide documents deployment boundaries and the required privacy model; it does not claim every control is already implemented. Do not enable live sharing until API enforcement and tests pass.

## 1. Deployable services

| Service | Build/start | Responsibility | Secret scope |
|---|---|---|---|
| Customer web | bun run build:customer | Storefront, account, cart, checkout, tracking | Public Vite values only |
| Seller Hub | bun run build:seller | Catalogue, orders, seller payment/carrier setup, privacy settings | Public Vite values only |
| Provider Portal | bun run build:provider | Supplier onboarding, product drafts, negotiation, settlement views | Public Vite values only |
| API | bun run start (server.ts) | Auth, authorization, DTO filtering, commerce API, webhooks, MongoDB | API-only secrets |
| Logistics worker | bun run logistics:worker | Shipment queue and carrier adapters | Worker-only DB key and carrier decryption key |
| MongoDB | Managed replica set/sharded cluster | Commerce source of truth | Private DB credentials |
| Logistics Postgres/Supabase | LOGISTICS_SUPABASE_* | Carrier configs, warehouses, shipment queue/tracking | Worker-only service role |
| Redis/Upstash | UPSTASH_REDIS_* | Rate limits/cache | Server-only token |
| R2/object storage | R2_* | Media and permitted documents | Server-only access keys |

Deploy each frontend as a separate static site, API as a long-running server, and logistics worker as a separate worker service. Route each UI's /api and upload paths to the shared API. Prefer a same-site reverse proxy/BFF. The current session cookie is host-only; separate subdomains need explicit cookie-domain, Secure, SameSite, CSRF and OAuth callback configuration. Do not assume cookies automatically cross subdomains.

## 2. Environment variables by service

Set variables in each hosting service's own environment settings. Do not copy the entire root .env into every service. Vite variables are embedded in browser bundles and are public.

### API (private runtime)
- NODE_ENV=production, PORT (host-assigned; bind 0.0.0.0), APP_URL
- SESSION_SECRET (unique high-entropy secret)
- MONGODB_URI (private replica-set/sharded URI; transactions required)
- SUPABASE_URL, SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY only if required by server code; server-only
- ENCRYPTION_MASTER_KEY (base64-encoded 32-byte AES key)
- CORS_ALLOWED_ORIGINS (exact comma-separated HTTPS frontend origins)
- VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (public browser auth config for root app build)
- GEMINI_API_KEY, CRON_SECRET (optional server AI/protected cron)
- UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (optional cache/rate limit)
- R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_CDN_URL (optional storage)
- WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID (optional Meta WhatsApp)
- EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE (optional Evolution API)

Generate fresh values: openssl rand -base64 32 for ENCRYPTION_MASTER_KEY and openssl rand -hex 48 for SESSION_SECRET. The encryption key must decode to exactly 32 bytes. Back it up in a managed vault; losing it can make encrypted credentials unrecoverable. Rotation requires a versioned re-encryption migration.

### Customer web (public build-time only)
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY (public anon/publishable key only)
- VITE_API_BASE_URL only if the client supports it; otherwise same-origin /api
- VITE_APP_URL if consumed by the client

Never add Mongo URI, session secret, encryption key, Supabase service role, Redis token, payment/carrier key or storage secret.

### Seller Hub (public build-time only)
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_API_BASE_URL if supported; otherwise reverse-proxy /api
- VITE_CUSTOMER_APP_URL for customer-app navigation/return links

Seller payment credentials (Razorpay, Cashfree, PayU, Stripe or another actually supported provider), webhook secrets, carrier credentials and warehouse contact data must be entered through authenticated APIs and stored encrypted server-side. They are not Vite variables. A provider is not supported merely because its name is entered.

### Provider Portal (public build-time only)
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_API_BASE_URL if supported; otherwise reverse-proxy /api
- VITE_CUSTOMER_APP_URL if used for sign-in return/navigation

Provider Portal means supplier/provider, not courier/driver. It must receive provider-scoped DTOs only and must never receive customer PII or server credentials.

### Logistics worker (private runtime)
- NODE_ENV=production
- LOGISTICS_SUPABASE_URL
- LOGISTICS_SUPABASE_SERVICE_ROLE_KEY (worker-only; never browser)
- ENCRYPTION_MASTER_KEY (compatible key/version to decrypt seller carrier credentials)
- LOGISTICS_WORKER_POLL_MS (optional; default 1500)
- SHIPROCKET_API_BASE_URL and SHADOWFAX_API_BASE_URL (optional; production endpoints in production)

bun run logistics:worker sets RUN_LOGISTICS_WORKER=1. The worker must fetch credentials only for the seller-owned carrier config linked to the claimed job. Current job payload includes recipient name, phone, address, postal code and shipment data. Current Shiprocket worker path requires recipient email; do not send email by default. Add an explicit carrier-specific seller opt-in and block booking if the requirement is not approved.

### Data services
- MongoDB: Atlas replica set/sharded cluster, TLS, private networking/allow-list, least-privilege user, backups/PITR. Transactions required; no local JSON fallback in production.
- Logistics Postgres/Supabase: apply migrations including src/server/migrations/2026-11-carrier-adaptive-feedback.sql; enable RLS for user-facing access. Service-role key stays server-side.
- Redis is acceleration only; Mongo/SQL remain correctness authorities.
- R2: private buckets for customer documents/labels; short-lived purpose-scoped signed URLs. Public CDN only for intentionally public product media.

## 3. One-command local startup

```bash
bun install
cp .env.example .env
# Add local non-production values
bun run dev:all
```

dev:all starts API and all role frontends:

| Process | Local URL |
|---|---|
| API/root server | http://localhost:3000 |
| Customer web | http://localhost:4173 |
| Provider Portal | http://localhost:4174 |
| Seller Hub | http://localhost:4175 |

Vite role apps proxy /api and /uploads to port 3000; Provider Portal also proxies /src/assets. Worker is opt-in because it needs its own logistics database and carrier credentials:

```bash
START_LOGISTICS_WORKER=1 bun run dev:all
```

Ctrl+C stops all child processes. Individual commands: bun run dev, bun run dev:customer, bun run dev:provider, bun run dev:seller, bun run logistics:worker.

Production build/validation:
```bash
bun run lint
bun run build
bun run build:workspace
bun run test
```
Deploy dist/customer-web, dist/seller-hub and dist/provider-portal independently. Deploy API and worker separately. Do not run a worker inside every API replica; start one worker and scale after queue concurrency, provider limits and idempotency are verified.

## 4. Customer privacy and role separation

Three identities must remain distinct:
1. Supplier/provider: seller-linked supplier using Provider Portal. No routine need for end-customer identity, phone, address, email, payment details or order history.
2. Delivery carrier/courier/assigned operator: fulfills one assigned shipment and receives only minimum shipment data needed to deliver.
3. Seller/authorized staff: manages its own customer order for legitimate fulfilment/support, subject to applicable law, notices/consent and role permissions.

### Default access policy

| Field | Owning seller | Supplier/provider portal | Assigned carrier/operator |
|---|---|---|---|
| Customer name | Own order, purpose checked | NEVER | Only if needed for active delivery |
| Phone | Seller policy + operational need | NEVER | Masked/proxy by default; direct only with seller opt-in if necessary |
| Email | Seller policy + operational need | NEVER | NEVER by default; documented carrier need + seller opt-in |
| Delivery address | Own order, fulfilment purpose | NEVER | Minimum complete address for assigned active shipment |
| Order/shipment reference | Own seller order | Opaque supplier case reference only | Shipment and carrier booking reference |
| Items/quantity | Own order | Supplier's own SKU/quantity only | Minimum shipment manifest |
| Selling price/payment method/card/UPI | Role-appropriate summary; never raw secrets | NEVER | NEVER; COD amount only if collection requires it |
| Customer history/saved addresses/preferences | Only if authorized and necessary | NEVER | NEVER |
| Risk notes, KYC, seller margin/internal notes | Restricted roles | NEVER | NEVER |

Provider privacy is enforced in API queries and DTOs, not by hiding fields in React. Provider endpoints must not join/populate customer profiles.

### Seller-controlled disclosure settings

Add per-seller delivery privacy settings with a preview of exactly what each carrier receives. Suggested fields:
- shareRecipientNameForDelivery: enabled only when required for delivery.
- shareRecipientPhoneForDelivery: false by default; prefer masked relay/proxy calls.
- shareDeliveryAddressForDelivery: enabled only for a booked delivery; delivery requires an address.
- shareRecipientEmailForDelivery: false by default; require carrier-specific documented necessity and explicit opt-in.
- shareShipmentItemsForDelivery: minimum manifest only; no unrelated basket lines or sensitive descriptions.
- shareCodAmountForDelivery: only for COD and only the collection amount.
- allowCarrierProofOfDelivery: only necessary proof metadata/media, with retention.
- policyVersion, updatedBy, updatedAt, reason: immutable audit history.

Require a reason for enabling email/direct phone. If a carrier requires a field the seller has not approved, fail closed or offer another carrier; never silently disclose. Revocation blocks future access but cannot erase data already transmitted or undo a shipment in transit; explain this in the UI. Seller settings cannot override law, customer rights or mandatory carrier contract terms.

### Just-in-time delivery disclosure

1. Seller confirms order and selects carrier/service.
2. API verifies seller/tenant ownership, order state, active carrier config, seller policy and carrier required-field schema.
3. API creates a shipment-specific disclosure snapshot tied to one shipment, carrier config and purpose.
4. Worker claims the job and retrieves only that approved snapshot; it must not read a general customer profile.
5. Carrier receives minimum payload over TLS. Use masked phone/relay if available.
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
- Provide customer notice, access/correction/deletion and retention workflows consistent with applicable law; retain only legally required transaction/audit records.

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

## 6. Deployment order

1. Provision Mongo replica set and logistics Postgres/Supabase; configure TLS, private networking, backups and least privilege.
2. Apply Mongo/SQL migrations, including carrier feedback migration; verify indexes and RPCs.
3. Configure API variables; verify auth, health, Mongo transaction support and webhook signatures.
4. Deploy three frontends with public Vite variables only; configure /api/uploads routing, OAuth redirects, cookies and CSRF.
5. Deploy worker with private variables; start one replica and test queue claim, retries, idempotency and carrier sandbox.
6. Configure payment provider per seller through Seller Hub; encrypt credentials and verify webhook signatures. Only implemented adapters are selectable.
7. Configure carrier per seller; validate credentials, rates, booking, labels and tracking; review disclosure policy before live booking.
8. Enable carrier sharing only after privacy tests pass. Start with minimum recipient name and address; prefer masked phone. Keep supplier/provider portal PII-free.
9. Run checkout concurrency, duplicate webhook, tenant isolation, carrier/payment sandbox, restore and load/regression tests. Monitor queue lag, webhook retries, carrier failures, rate limits and disclosure audit events.

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

## 8. Known implementation gaps

- Role apps are independently buildable but still reuse shared root app/API; this is not a fully extracted microservice architecture.
- Local API development uses root .env; production values must be configured per service.
- Current logistics worker builds carrier requests from job payload and currently requires recipient email on the Shiprocket path. Seller-controlled field-level disclosure, default-deny email/phone, provider PII-free tests and disclosure audit must be implemented and verified before claiming this privacy model is enforced.
- Worker currently uses privileged Supabase service key; keep it worker-only and scope database/RPC permissions to minimum.
- Payment provider availability depends on implemented server adapters and webhook support; never claim an unimplemented provider is supported.
- Build success/local startup does not certify production readiness. Complete privacy, integration, concurrency and load tests before live customer data or shipments.

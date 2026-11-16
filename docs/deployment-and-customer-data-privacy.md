# Deployment and customer-data privacy runbook

> This runbook distinguishes the current deployable application from the intended service-level deployment model. The current branch has a root application/server; the separate customer, seller, provider and logistics-worker workspace packages described in earlier architecture plans are not present on this branch. Do not configure or claim those as deployed services until they exist. The privacy rules below are release requirements, not a claim that all enforcement is already implemented.

## 1. Current deployment unit

The current application is started from the repository root:
- Development: bun run dev
- Production: bun run start
- Build: bun run build
- Type check: bun run lint

Deploy the root application as one web/API service until the role apps and worker are actually extracted. Use a managed MongoDB replica set/sharded cluster for production; checkout and ledger transactions require transaction-capable Mongo. Do not use local JSON persistence in production or across multiple instances.

### Target service boundaries (when extracted)

| Service | Own responsibility | Environment/secret scope |
|---|---|---|
| Customer web | Browse, account, cart, checkout UI, order tracking | Public VITE_* values only |
| Seller Hub | Catalogue, orders, seller payment/carrier setup, privacy settings | Public VITE_* values only |
| Supplier/provider portal | Supplier onboarding, product drafts, negotiation, settlement views | Public VITE_* values only; no customer PII |
| API | Auth, authorization, DTO filtering, commerce API, webhooks, database access | Private server secrets |
| Logistics worker | Shipment queue and carrier adapters | Worker-only logistics DB key and carrier decryption key |

The current root app may serve UI and API together. When separating services, deploy each frontend as its own static site, API as a long-running server, and logistics worker as a separate worker service. Route each UI's /api and upload paths to the API. Prefer a same-site reverse proxy/BFF. The current session cookie is host-only; separate subdomains require explicit cookie-domain, Secure, SameSite, CSRF and OAuth callback configuration. Do not assume cookies automatically cross subdomains.

## 2. Environment variables by service

Set variables in each hosting service's own environment settings. Never copy all secrets into every service. Vite variables are embedded in browser bundles and are public.

### API / current root server (private runtime)
- NODE_ENV=production, PORT (host-assigned; bind 0.0.0.0), APP_URL
- SESSION_SECRET (unique high-entropy secret)
- MONGODB_URI (private Mongo replica-set/sharded URI; transactions required)
- SUPABASE_URL, SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY only if required by server code; server-only
- ENCRYPTION_MASTER_KEY (base64-encoded 32-byte AES key)
- CORS_ALLOWED_ORIGINS (exact comma-separated HTTPS frontend origins)
- VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY only for browser build configuration
- GEMINI_API_KEY, CRON_SECRET (optional server AI/protected cron)
- UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (optional cache/rate limit)
- R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_CDN_URL (optional storage)
- WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID (optional Meta WhatsApp)
- EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE (optional Evolution API)

Generate fresh values: openssl rand -base64 32 for ENCRYPTION_MASTER_KEY and openssl rand -hex 48 for SESSION_SECRET. The encryption key must decode to exactly 32 bytes. Back it up in a managed vault; losing it can make encrypted credentials unrecoverable. Rotation requires a versioned re-encryption migration.

### Customer web (only after separately deployed)
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY (public anon/publishable key only)
- VITE_API_BASE_URL only if the client supports it; otherwise same-origin /api
- VITE_APP_URL if consumed by the client

Never add Mongo URI, session secret, encryption key, Supabase service role, Redis token, payment/carrier key or storage secret.

### Seller Hub (only after separately deployed)
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_API_BASE_URL if supported; otherwise reverse-proxy /api
- VITE_CUSTOMER_APP_URL if used for customer-app navigation/return links

Seller payment credentials (Razorpay, Cashfree, PayU, Stripe or another actually supported provider), webhook secrets, carrier credentials and warehouse contact data must be entered through authenticated APIs and stored encrypted server-side. They are not Vite variables. A provider is not supported merely because its name is entered.

### Supplier/provider portal (only after separately deployed)
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_API_BASE_URL if supported; otherwise reverse-proxy /api

This is the supplier/provider role, not courier/driver. It must receive provider-scoped DTOs only and never customer PII or server credentials.

### Logistics worker (only after extracted)
- NODE_ENV=production
- LOGISTICS_SUPABASE_URL
- LOGISTICS_SUPABASE_SERVICE_ROLE_KEY (worker-only; never browser)
- ENCRYPTION_MASTER_KEY (compatible key/version to decrypt seller carrier credentials)
- LOGISTICS_WORKER_POLL_MS (optional; current worker reference defaults to 1500)
- SHIPROCKET_API_BASE_URL, SHADOWFAX_API_BASE_URL (optional; production endpoints in production)

The worker must fetch credentials only for the seller-owned carrier config linked to a claimed job. Carrier credentials are not frontend variables. If a carrier requires recipient email, require a carrier-specific documented need and explicit seller opt-in; do not silently send email.

### Data services
- MongoDB: Atlas replica set/sharded cluster, TLS, private networking/allow-list, least-privilege user, backups/PITR. Transactions required.
- Logistics Postgres/Supabase: configure only when logistics service exists; apply all SQL migrations and enable RLS for user-facing access. Service-role key stays server-side.
- Redis is acceleration only; Mongo/SQL remain correctness authorities.
- R2: private buckets for customer documents/labels; short-lived purpose-scoped signed URLs. Public CDN only for intentionally public product media.

## 3. Single-script application startup

After installing dependencies and configuring a local non-production .env:

```bash
bun install
cp .env.example .env
bun run start:app
```

start:app invokes scripts/start-app.sh and starts the current root application. For development use bun run start:app dev; for production-style server start use bun run start:app start. Stop with Ctrl+C. Do not run a logistics worker until its code and private environment have been deployed as a separate process.

Validation/build:
```bash
bun run lint
bun run build
bun run test
```
The current package manifest does not define independent workspace build commands. Add those only when the corresponding app packages are committed.

## 4. Customer privacy and role separation

Keep three identities distinct:
1. Supplier/provider: seller-linked supplier using Provider Portal. No routine need for end-customer identity, phone, address, email, payment details or order history.
2. Delivery carrier/courier/assigned operator: fulfills one assigned shipment and receives only minimum shipment data needed to deliver.
3. Seller/authorized staff: manages its own customer order for legitimate fulfilment/support, subject to applicable law, notices/consent and role permissions.

### Default access matrix

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

Provider privacy must be enforced in API queries and DTOs, not by hiding fields in React. Provider endpoints must not join/populate customer profiles.

### Seller-controlled disclosure settings

Add per-seller delivery privacy settings with a preview of exactly what each carrier receives:
- shareRecipientNameForDelivery: only when required for delivery.
- shareRecipientPhoneForDelivery: false by default; prefer masked relay/proxy calls.
- shareDeliveryAddressForDelivery: enabled only for a booked delivery; delivery requires an address.
- shareRecipientEmailForDelivery: false by default; require documented carrier necessity and explicit seller opt-in.
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

## 6. Deployment order and release gates

1. Provision Mongo replica set; configure TLS, private networking, backups and least privilege.
2. Apply Mongo/SQL migrations; verify indexes and RPCs.
3. Configure API variables; verify auth, health, Mongo transaction support and webhook signatures.
4. Deploy extracted frontends only after their packages exist; use public Vite variables only and test OAuth, cookies and CSRF.
5. Deploy a separate logistics worker only after it exists; start one replica and test queue claim, retries, idempotency and carrier sandbox.
6. Configure payment/carrier providers per seller through authenticated Seller Hub APIs; encrypt credentials and verify webhook signatures. Only implemented adapters are selectable.
7. Enable carrier sharing only after privacy tests pass. Start with minimum recipient name and address; prefer masked phone. Keep supplier/provider portal PII-free.
8. Run checkout concurrency, duplicate webhook, tenant isolation, sandbox, restore and load/regression tests. Monitor queue lag, webhook retries, carrier failures, rate limits and disclosure audit events.

## 7. Known implementation gaps

- Separate role apps and a dedicated logistics worker are not present in this branch; the root application is the current deployable unit.
- Seller-controlled field-level disclosure, default-deny email/phone, provider PII-free response tests and disclosure audit must be implemented and verified before claiming this privacy model is enforced.
- Do not expose a privileged Supabase service key to a browser; scope worker/service database permissions to minimum.
- Payment provider availability depends on implemented server adapters and webhook support; never claim an unimplemented provider is supported.
- Build success/local startup does not certify production readiness. Complete privacy, integration, concurrency and load tests before live customer data or shipments.

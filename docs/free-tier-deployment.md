# Free-tier deployment runbook (22 accounts / 10 active users)

### Co-located vs. split Static UI + Lean API architecture (512 MB RAM Safe)

Render does **not** provide a free tier for Background Workers (`type: worker` requires at least the paid `starter` plan and causes an **Upgrade Required** error on free Render accounts), and serving Vite static bundles + running `sharp` + background polling inside a single 512 MB Node process can trigger V8 heap exhaustion and HTTP 502 restarts.

To eliminate 512 MB OOM 502s and stay 100% free-tier compatible:
- **`ecommerce-ui` (Render Static Site, `runtime: static`, 0 MB Node RAM)**: Serves `./dist` directly over CDN with `VITE_API_BASE_URL` pointing to `https://ecommerce-api.onrender.com`.
- **`ecommerce-api` (Render Free Web Service, `runtime: node`, `DISABLE_STATIC_UI=1`, `RUN_LOGISTICS_WORKER=0`)**: Starts with `NODE_OPTIONS="--max-old-space-size=384"`, skips serving frontend HTML/assets, caps Sharp image cache (`memory: 24`, concurrency `1`), and exposes cross-origin CORS + `Authorization: Bearer` + `X-CSRF-Token` session support.
- **Admin Runtime Service Flags (`Seller Hub -> Service flags`)**:
  - `shippingQuotesEnabled` defaults to `false` (free delivery ₹0 without calling external carrier rate APIs at checkout).
  - `onlinePaymentEnabled` defaults to `false` (orders complete smoothly via COD, Seller Direct Collection, or POS Machine on Delivery without gateway blockers).
  - `posMachineEnabled` + `posDemandCartThresholdInr` highlights **POS Machine on Delivery** once cart net value meets the threshold or exceeds `codMaxOrderValueInr`, while sellers confirm received payments/POS slip RRNs directly on the order card via `POST /api/seller/orders/:id/confirm-payment`.
  - **Standalone Service Cutover (`render.services.yaml`)**: `apps/payment-service` (port `4010`, `npm run dev:payment` / `start:payment`) and `apps/shipping-service` (port `4020`, `npm run dev:shipping` / `start:shipping`) are pre-built inside the repository with signed HMAC-SHA256 internal endpoints (`/internal/v1/*`) and ready-to-deploy Render templates (`render.services.yaml`). Keep `PAYMENT_SERVICE_URL` and `SHIPPING_SERVICE_URL` blank under low traffic for in-process fallback; set both URLs + `SERVICE_INTERNAL_SECRET` later with zero code changes, and verify live connectivity from **Admin → Service flags**.

## Recommended topology

Split the static CDN UI from the Lean Node API on Render Free, keeping shipping quotes and background workers flagged off until traffic demands them.

| Concern | Initial service | Purpose |
|---|---|---|
| Static UI (`ecommerce-ui`) | Render Static Site (`plan: free`) | CDN-hosted React bundle (`dist/`), `0 MB` Node RAM, calls API via `VITE_API_BASE_URL` |
| Lean API (`ecommerce-api`) | Render Free Web Service (`DISABLE_STATIC_UI=1`) | Stateless REST API (`384 MB` V8 cap, `RUN_LOGISTICS_WORKER=0` by default) |
| Main application data | MongoDB Atlas Free cluster | Users, products, orders, platform flags, sessions |
| Logistics data + queue | Supabase Free Postgres | Carrier registry, warehouses, shipments (activated on demand via Admin flag) |
| Authentication | Supabase Auth + Bearer/Cookie | Cross-origin customer/seller/admin/provider sessions |
| Cache + rate limits | Upstash Redis Free | Shared carts/cache/rate-limit state |
| Uploaded images | Cloudflare R2 Standard | Persistent product and return-photo objects |
| Source + CI | GitHub | Build, tests, deploy on merge |

Keep all services in the nearest mutually available region. Prefer a Singapore/India-adjacent region if offered by each provider; exact region availability differs by provider and free tier.

The application has two persistence systems: MongoDB for core commerce and Supabase Postgres for logistics. Apply all three logistics SQL migrations if using carrier shipping features.

## Capacity and free-tier expectations

Splitting Static UI off Node removes static asset I/O and bundling pressure from the 512 MB API container. Keep `RUN_LOGISTICS_WORKER=0` and `shippingQuotesEnabled=false` under low traffic so Node idle RSS stays comfortably below 512 MB. Free instances sleep after 15 minutes without inbound traffic and wake in ~30–60s.

Supabase Free projects can pause after a week of low activity and have small database/storage/egress quotas. Upstash Free currently has finite storage, bandwidth and command quotas. Cloudflare R2 Standard currently includes 10 GB-month storage, 1M Class A and 10M Class B operations per month, with no egress fee. Check each provider's live usage dashboard; quotas and pricing change.

## Optional Stage 1: dedicated paid logistics worker

The default `render.yaml` intentionally remains the free-only API + static UI Blueprint. It keeps `RUN_LOGISTICS_WORKER=0` and does not provision a background worker.

When you explicitly approve the additional hosting cost, create a **separate Render Blueprint** using the repository's `render.worker.yaml` file path. This keeps the existing free-only Blueprint unchanged and prevents a routine sync of `render.yaml` from adding a paid service.

The optional worker Blueprint defines one private Render Background Worker:
- Plan: `starter` (paid; confirm current pricing in Render before applying).
- Start command: `NODE_OPTIONS="--max-old-space-size=384" bun run logistics:worker`.
- One instance, sequential job processing, 2-second queue polling.
- Auto-deploy is disabled in the worker Blueprint; deploy it manually from the same commit as the API after reviewing changes.
- The worker logs RSS, V8 heap, external memory and ArrayBuffer usage every 60 seconds to help diagnose memory pressure.

Configure these worker-only environment values in Render, copying the exact existing values from the API:
- `MONGODB_URI`
- `LOGISTICS_SUPABASE_URL`
- `LOGISTICS_SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_MASTER_KEY`

The worker must use the same MongoDB database and encryption master key as the API. Never create a second encryption key for the worker. Keep all secrets server-side; do not use `VITE_*` variables for them.

The worker entrypoint connects directly to MongoDB with a bounded connection pool and `autoIndex: false`. It deliberately avoids the full application bootstrap so that starting a worker does not seed demo data or synchronize every application index. The API remains responsible for normal application initialization.

Before enabling carrier fulfilment, verify the Supabase logistics migrations are applied, worker logs show successful database startup, and a controlled test job completes. Keep exactly one worker instance until queue concurrency and idempotency have been load-tested.

**Cost guardrail:** Do not create or apply this separate Blueprint while staying on a zero-cost hosting setup. The existing free-only Blueprint remains usable with the worker disabled, but background shipment jobs will remain queued and will not execute until a worker is provisioned.

## 1. Prepare the repository

1. Merge the deployment branch after review.
2. Ensure the repository default branch contains `render.yaml`, `.env.example`, and this runbook.
3. Use the repository root as the Render Root Directory.
4. Keep one lockfile and install from the root. Do not run `npm install` separately inside each app.
5. Internal packages are already represented as Bun workspaces. Keep package versions aligned with the root dependency declarations; use relative imports or workspace package exports for shared code rather than copying types or utilities into each app.

Local verification:

```bash
npm install --global bun
bun install --no-save
bun run lint
bun run test
bun run test:roles
bun run build
bun run build:workspace
```

Before a real production deploy, run the environment-aware check after exporting the production variables:

```bash
set -a
source .env.production.local
set +a
bun run predeploy:check
```

Never commit `.env.production.local` or any secret file.

## 2. Create MongoDB Atlas Free cluster

1. Create an Atlas project and a Free cluster.
2. Select the nearest supported region to the Render service region.
3. Create a database user with a strong unique password. Do not use an Atlas account password.
4. Add the Render outbound IP policy required by your chosen setup. For a free Render service with changing egress addresses, Atlas may require a broad IP allow-list. If you use `0.0.0.0/0`, compensate with a long random database password, TLS, a least-privilege database user, and never expose the URI to the browser.
5. Copy the SRV connection URI and replace the password/database name correctly.
6. Set `MONGODB_URI` in Render. The production server now fails closed if this value is missing or MongoDB cannot connect; it will not silently start against ephemeral JSON storage.

## 3. Create Supabase project and apply logistics migrations

1. Create one Supabase project for Auth and logistics Postgres (or use separate projects if you deliberately want isolation).
2. In Project Settings / API, copy the project URL, anon/publishable key and service-role key.
3. Set:
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` on `ecommerce-api`
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` on `ecommerce-ui` (browser-visible public values only)
   - `SUPABASE_SERVICE_ROLE_KEY` on `ecommerce-api` only if a server-side feature requires it
   - `LOGISTICS_SUPABASE_URL` and `LOGISTICS_SUPABASE_SERVICE_ROLE_KEY` on `ecommerce-api`
4. Open the Supabase SQL Editor and run these repository migrations in this exact order:
   1. `supabase/migrations/2026-11-logistics-postgres.sql`
   2. `supabase/migrations/2026-11-carrier-adaptive-feedback.sql`
   3. `supabase/migrations/2026-11-provider-logistics.sql`
5. Confirm the logistics provider registry and required RPC functions/tables exist before enabling carrier onboarding. Keep the service-role key server-side only; never put it in a `VITE_*` variable.

For Supabase Auth, configure the site URL to `https://ecommerce-ui.onrender.com` and add exact callback/redirect URLs.

## 4. Configure Upstash Redis

1. Create one Redis database in the nearest region.
2. Copy its REST URL and REST token.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on `ecommerce-api`.
4. Use Redis as a cache/rate-limit layer only. MongoDB and Supabase remain the durable sources of truth. Do not depend on process-local memory for cross-instance correctness.

## 5. Configure Cloudflare R2 for persistent uploads

Render Free has an ephemeral filesystem. The application's local `data/uploads` fallback will lose uploaded images after restart, redeploy or spin-down. For any real seller upload workflow, configure R2:

1. Create an R2 Standard bucket.
2. Create an API token restricted to that bucket with object read/write/delete permissions needed by the app.
3. Configure a public custom domain for object delivery (recommended) and set its HTTPS base URL.
4. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` and `R2_PUBLIC_CDN_URL` on `ecommerce-api`.
5. Keep bucket access private to the app where possible; publish only through the intended CDN/custom domain. Do not commit R2 credentials.

## 6. Create the Render Blueprint services

1. Connect the GitHub repository to Render.
2. Choose **Blueprint** and point it at the repository root. Render reads `render.yaml`.
3. Confirm it creates both services: `ecommerce-api` (Node) and `ecommerce-ui` (Static Site).
4. Set `VITE_API_BASE_URL=https://<your-ecommerce-api>.onrender.com` and `VITE_ASSET_BASE_URL=https://<your-ecommerce-api>.onrender.com` on `ecommerce-ui`, then trigger a static rebuild.
5. Set `APP_URL=https://<your-ecommerce-ui>.onrender.com` and `CORS_ALLOWED_ORIGINS=https://<your-ecommerce-ui>.onrender.com` (exact origin, no trailing slash) on `ecommerce-api`.
6. Set `SESSION_SECRET` (`openssl rand -hex 32`), `ENCRYPTION_MASTER_KEY` (`openssl rand -base64 32`), `MONGODB_URI`, and `ROOT_SUPERUSER_INITIAL_PASSWORD` on `ecommerce-api`.
7. Keep `DISABLE_STATIC_UI=1` and `RUN_LOGISTICS_WORKER=0` for the 512 MB free-tier split topology.
8. Deploy both services and verify `/api/health` returns `staticUiDisabled: true` and `workerActive: false`.

The API build step verifies TypeScript (`bun run lint`) and unit suites (`test`, `test:roles`) before booting.

## 7. Configure and verify root/admin/user roles

1. Sign in with the root email and the new bootstrap password.
2. Immediately rotate the root password using the application's root password update flow.
3. Confirm Level 0 root access is present and the account has the root flag in the database.
4. Invite one Level 1 admin from root.
5. Invite one seller from root/admin.
6. Invite ten providers through the seller/provider onboarding workflow and complete provider email/KYC checks as required.
7. Create ten customer accounts through the public customer sign-up flow.
8. Confirm that Level 1 admin cannot invite another ADMIN and that seller invitations remain scoped to provider onboarding.
9. Disable demo/quick-login flows in production (the server already rejects quick demo login in production).

Production startup deliberately does not seed the demo users or sample catalogue. Create the one seller, ten providers and ten customers through the real onboarding/sign-up flows. Local development seed identities and sample products are not production accounts.

## 8. Smoke test the complete workflow

- `GET /api/health` returns HTTP 200 and `dbMode: mongodb`.
- Customer: sign-up, email confirmation, sign-in, browse, search, cart, checkout, order history.
- Seller: invite/link provider, configure warehouses/carriers, approve provider delegation, view orders, review returns/cancellations.
- Provider: sign-in, manage own catalogue, request seller delegation, quote and book shipment only after authorization.
- Root/admin: cross-tenant administration, invitations, access audits.
- Carrier: test sandbox credentials, rate quote, shipment booking, label/AWB persistence, webhook signature, tracking updates and retries.
- Uploads: product and return images remain accessible after a Render redeploy.
- Security: verify service-role keys and carrier credentials never appear in browser network responses or logs.
- Restart the service and confirm sessions, orders, products, shipment jobs and uploaded media survive.

## 9. Load test for the stated cohort

Run the test from a separate machine, not from the Render instance:

1. Warm the service with one request and wait for `/api/health` to return 200.
2. Use k6 or Artillery with 10 virtual users for a 10-minute steady-state run.
3. Model realistic mix: 5 customer browse/search/cart sessions, 2 provider dashboard sessions, 1 seller dashboard session, 1 admin/root session, and 1 checkout/order workflow.
4. Keep write operations realistic and avoid sending real payments or live carrier bookings during the test.
5. Record p50/p95/p99 latency, HTTP 4xx/5xx, Mongo connection time, Supabase query latency, memory usage and Render restarts.
6. Repeat with 15 virtual users as a short burst.
7. Target p95 under 800 ms for cached catalogue reads and under 1.5 s for ordinary API reads/writes, excluding external carrier/payment calls. Target error rate below 1%. These are test goals, not guaranteed free-tier performance.
8. If memory repeatedly approaches the 512 MB limit, the instance restarts, or p95 degrades sharply, reduce image-processing concurrency and background work or upgrade the service.

## 10. Low-bandwidth and performance practices

- Keep the customer, seller, provider and admin experiences on the same origin to avoid extra DNS/TLS handshakes and CORS preflights.
- Keep the current shared packages as the single source for shared types, schemas, UI primitives and utility logic. Avoid duplicate copies of DTOs or validation rules.
- Keep API responses paginated and projected; never return full order/customer documents to provider views.
- Use cursor pagination for growing order/review/catalogue feeds. Do not fetch entire histories.
- Use Redis for short-lived catalogue/rate-quote caches and rate limiting; invalidate on product, inventory and seller-policy changes.
- Cache fingerprinted Vite assets for one year with immutable caching. Use short/no-cache for `index.html` and private/no-store for authenticated API data.
- Serve R2 images via CDN, use WebP thumbnails, lazy-load below-the-fold images, and request thumbnail URLs in product grids.
- Keep image upload processing off the hot request path where possible; cap upload size and image dimensions.
- Debounce search input (250–350 ms), cancel stale requests, and avoid firing a request on every keystroke.
- Avoid polling dashboards more frequently than necessary; use 15–30 second refresh intervals or explicit refresh for low-volume workflows.
- Batch related dashboard API requests and avoid N+1 fetches.
- Use Mongo projections, compound indexes for common seller/provider/order filters, and lean reads for read-only queries. Review explain plans before adding indexes.
- Keep one Mongo connection pool per process and one cached Supabase client per process. Do not instantiate clients per request.
- Keep logistics worker concurrency at one. The current worker claims and processes one job at a time; do not increase concurrency without memory profiling and queue lease/retry tests.
- Do not enable verbose request/body logging in production. Never log auth tokens, addresses, phone numbers, payment payloads or carrier credentials.

## 11. When to upgrade

Move beyond this free pilot before relying on it for revenue-critical operations. Minimum upgrade path:

1. Always-on API service with at least 1 CPU / 1–2 GB RAM.
2. Separate private logistics background worker (`bun run logistics:worker` on a paid `starter` plan, with `RUN_LOGISTICS_WORKER=0` on the API service).
3. MongoDB paid tier with automated backups and point-in-time recovery.
4. Supabase paid plan to avoid inactivity pausing and obtain daily backups.
5. Centralized logs, uptime checks, error alerting and a tested backup/restore process.
6. Load test at 25–50 concurrent users before raising capacity claims.

## Important operational limits

- Do not use Render's local filesystem as durable storage.
- Do not rely on in-memory carts, OTPs, rate limits or queue state across restarts. Use MongoDB/Supabase/Redis for durable/shared state.
- A free web service may sleep after 15 minutes idle; the co-located worker pauses while asleep and resumes queued Supabase jobs on wake.
- Supabase Free can pause after inactivity and has no automatic backups on the free plan.
- A free-tier deployment is appropriate for a pilot/demo and controlled low-risk launch, not a guaranteed production SLA.

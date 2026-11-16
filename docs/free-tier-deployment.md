# Free-tier deployment runbook (22 accounts / 10 active users)

## Recommended topology

Start with one same-origin Express + Vite application service. The current root app already serves the main customer/seller/admin/provider experience and API from `server.ts`; do not split it into several public services for this pilot. Keep the workspace packages in the same release so the API and browser apps use matching contracts.

| Concern | Initial service | Purpose |
|---|---|---|
| Web + API | Render Free Web Service | One Node/Bun process, same-origin cookies and API |
| Main application data | MongoDB Atlas Free cluster | Users, products, orders, sessions and core commerce |
| Logistics data + queue | Supabase Free Postgres | Carrier registry, warehouses, shipments, durable job queue |
| Authentication | Supabase Auth | Customer authentication / OAuth where configured |
| Cache + rate limits | Upstash Redis Free | Shared carts/cache/rate-limit state |
| Uploaded images | Cloudflare R2 Standard | Persistent product and return-photo objects |
| Source + CI | GitHub | Build, tests, deploy on merge |

Keep all services in the nearest mutually available region. Prefer a Singapore/India-adjacent region if offered by each provider; exact region availability differs by provider and free tier.

The application has two persistence systems: MongoDB for core commerce and Supabase Postgres for logistics. Configure both. A successful Mongo connection does not mean logistics is configured. Apply all three logistics SQL migrations in the order below.

## Capacity and free-tier expectations

This is a pilot topology, not a production availability commitment. A 512 MB Render Free web service is a tight resource envelope. It should be tested with 10 concurrent active users, not assumed to handle 22 simultaneous sessions. The service is single-instance, has no autoscaling or persistent disk, and may cold-start after idle. Render Free web services sleep after 15 minutes without inbound traffic and can take about a minute to wake. Free instances are not recommended by Render for production.

The logistics worker is optionally co-located in the web process with `RUN_LOGISTICS_WORKER=1`. This avoids paying for a separate Render background worker during the pilot. The queue itself is durable in Supabase, so queued work remains after a sleep/restart and resumes when the web process starts again. It is not an always-on worker: carrier booking/tracking jobs may wait while the web service is asleep. If fulfilment must run continuously or promptly, move the worker to a paid always-on worker service and keep it private.

Supabase Free projects can pause after a week of low activity and have small database/storage/egress quotas. Upstash Free currently has finite storage, bandwidth and command quotas. Cloudflare R2 Standard currently includes 10 GB-month storage, 1M Class A and 10M Class B operations per month, with no egress fee. Check each provider's live usage dashboard; quotas and pricing change.

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
bun run test:logistics
bun run test:hybrid
bun run test:privacy
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
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (browser-visible public values only)
   - `SUPABASE_SERVICE_ROLE_KEY` only if a server-side feature requires it
   - `LOGISTICS_SUPABASE_URL` and `LOGISTICS_SUPABASE_SERVICE_ROLE_KEY`
4. Open the Supabase SQL Editor and run these repository migrations in this exact order:
   1. `src/server/migrations/2026-11-logistics-postgres.sql`
   2. `src/server/migrations/2026-11-carrier-adaptive-feedback.sql`
   3. `src/server/migrations/2026-11-provider-logistics.sql`
5. Confirm the logistics provider registry and required RPC functions/tables exist before enabling carrier onboarding. Keep the service-role key server-side only; never put it in a `VITE_*` variable.

For Supabase Auth, configure the site URL to the deployed app URL and add the exact callback/redirect URLs used by the app. Enable only the OAuth providers actually used. Configure email delivery and test sign-up, verification and password reset end to end.

## 4. Configure Upstash Redis

1. Create one Redis database in the nearest region.
2. Copy its REST URL and REST token.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Render.
4. Use Redis as a cache/rate-limit layer only. MongoDB and Supabase remain the durable sources of truth. Do not depend on process-local memory for cross-instance correctness.

## 5. Configure Cloudflare R2 for persistent uploads

Render Free has an ephemeral filesystem. The application's local `data/uploads` fallback will lose uploaded images after restart, redeploy or spin-down. For any real seller upload workflow, configure R2:

1. Create an R2 Standard bucket.
2. Create an API token restricted to that bucket with object read/write/delete permissions needed by the app.
3. Configure a public custom domain for object delivery (recommended) and set its HTTPS base URL.
4. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` and `R2_PUBLIC_CDN_URL`.
5. Keep bucket access private to the app where possible; publish only through the intended CDN/custom domain. Do not commit R2 credentials.

## 6. Create the Render service

1. Connect the GitHub repository to Render.
2. Choose **Blueprint** and point it at the repository root. Render reads `render.yaml`.
3. Confirm it creates one Free Web Service named `ecommerce-store`.
4. Add all secret values in the Render Environment screen. The blueprint marks them `sync: false` so secrets are not committed to Git.
5. Set `APP_URL` to the final Render HTTPS URL, for example `https://<your-service>.onrender.com`.
6. Set `CORS_ALLOWED_ORIGINS` to that exact origin only (no trailing slash, comma-separated only if you intentionally add more trusted origins).
7. Set a fresh `SESSION_SECRET` generated with `openssl rand -hex 32`.
8. Set `ENCRYPTION_MASTER_KEY` to a fresh 32-byte key generated with `openssl rand -base64 32`. Preserve it securely: losing it makes previously encrypted carrier credentials unreadable. Do not rotate it without a data re-encryption plan.
9. Set `ROOT_SUPERUSER_INITIAL_PASSWORD` to a new unique strong password in Render Secrets. Do not reuse any password previously shared in chat, tickets or source code.
10. Keep `ROOT_SUPERUSER_EMAIL=ashvinsingh25@gmail.com` and `RUN_LOGISTICS_WORKER=1` for the single-process pilot.
11. Deploy and wait for the build and `/api/health` health check to pass.

The Render blueprint runs lint, the logistics/hybrid/privacy/role tests, and both browser builds before the service starts.

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
- Keep logistics worker concurrency at one on the free instance. Do not process Sharp image transformations and multiple carrier jobs concurrently on a 512 MB instance.
- Do not enable verbose request/body logging in production. Never log auth tokens, addresses, phone numbers, payment payloads or carrier credentials.

## 11. When to upgrade

Move beyond this free pilot before relying on it for revenue-critical operations. Minimum upgrade path:

1. Always-on API service with at least 1 CPU / 1–2 GB RAM.
2. Separate private logistics background worker with durable queue polling and retry alerts.
3. MongoDB paid tier with automated backups and point-in-time recovery.
4. Supabase paid plan to avoid inactivity pausing and obtain daily backups.
5. Centralized logs, uptime checks, error alerting and a tested backup/restore process.
6. Load test at 25–50 concurrent users before raising capacity claims.

## Important operational limits

- Do not use Render's local filesystem as durable storage.
- Do not rely on in-memory carts, OTPs, rate limits or queue state across restarts. Use MongoDB/Supabase/Redis for durable/shared state.
- A free web process may sleep; the co-located worker does not run while it sleeps.
- Supabase Free can pause after inactivity and has no automatic backups on the free plan.
- A free-tier deployment is appropriate for a pilot/demo and controlled low-risk launch, not a guaranteed production SLA.

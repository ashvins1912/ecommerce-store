# Parent / child project architecture

The root is an npm-workspaces monorepo. Deployable children are `customer-web`,
`provider-portal`, `api`, `payment-service`, and `shipping-service`.
Each child exposes independent `dev`, `build`, `start`, and `lint` scripts.

The customer storefront source and assets live in `customer-web/`. Provider
Portal is a separate Vite application and is no longer imported into the customer
bundle. It has its own small copies of the presentation/i18n helpers it needs.

The API child currently wraps the established root `server.ts` entry to preserve
existing runtime-relative paths during this staged split. Payment and shipping
service code lives in their own top-level child folders.

The standalone logistics-worker workspace has been removed. Its queue poller
runs inside Shipping Service from `shipping-service/src/queue-poller.ts`.
Enable it with `ENABLE_QUEUE_POLLING=1`; the old
`ENABLE_QUEUE_WORKER=1` variable remains accepted for compatibility.
Keep database atomic job claiming enabled when running more than one instance.

Existing SQL migrations are in `supabase/migrations/`. Commerce documents and
catalogue data remain in MongoDB; logistics records use Supabase PostgreSQL.

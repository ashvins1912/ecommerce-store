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

The standalone logistics-worker workspace has been removed and its queue logic
now lives in `shipping-service/src/queue-poller.ts`. Queue processing can run
inside Shipping Service with `ENABLE_QUEUE_POLLING=1`, or as a dedicated
standalone process through `shipping-service/src/worker-entry.ts` and the
root `logistics:worker` script. The previous `ENABLE_QUEUE_WORKER=1` flag is
still accepted. Use exactly one queue consumer mode at a time; keep database
atomic job claiming enabled when running more than one instance.

Existing SQL migrations are in `supabase/migrations/`. Commerce documents and
catalogue data remain in MongoDB; logistics records use Supabase PostgreSQL.

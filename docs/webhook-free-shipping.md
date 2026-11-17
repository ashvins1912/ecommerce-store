# Webhook-free Shiprocket and Shadowfax tracking

The shipping adapters are used by the existing logistics service. Commerce orders remain in MongoDB; carrier configuration, shipment state, append-only tracking events, and the logistics job queue remain in Supabase PostgreSQL. Do not create a second shipment collection or queue.

## Authentication

Shiprocket authentication uses `POST /v1/external/auth/login` with `email` and `password`. The adapter keeps the Bearer token in a process-local cache for 9 days and refreshes when fewer than 6 hours remain in that cache window. Concurrent requests for the same account share one login request. The token is not persisted to MongoDB, PostgreSQL, Redis, or logs.

Set `SHIPROCKET_API_BASE_URL=https://apiv2.shiprocket.in` unless your Shiprocket account documentation specifies otherwise. Credentials remain encrypted in the existing carrier configuration store.

## Shipment creation and courier selection

The existing `ShiprocketAdapter.createShipment()` creates an adhoc order, assigns an AWB, schedules pickup, and attempts label/manifest generation. The result contains provider shipment ID, AWB, pickup state, and available artifact URLs.

The optional `ShipmentRequest.courierId` overrides the service quote's courier ID in the Shiprocket AWB assignment request. To prioritize Shadowfax through Shiprocket, supply the courier-company ID enabled for Shadowfax on the Shiprocket account. This is distinct from using the direct Shadowfax adapter, whose credentials and API are configured separately. Never assume a courier ID; verify it from the account's serviceability/courier list.

## Webhook-free status synchronization

The logistics worker invokes the exported `syncShipmentStatuses()` on startup and every 3 hours thereafter. It selects up to 5,000 shipments with an AWB and a non-terminal normalized status, then calls the provider tracking API sequentially with a 500ms pause between AWBs. Each response is normalized through the existing status mapper and persisted through the existing monotonic, idempotent tracking-event function. Terminal statuses are excluded from subsequent polling.

The current status model maps pickup/transit milestones to `IN_TRANSIT`, out-for-delivery to `OUT_FOR_DELIVERY`, delivery to `DELIVERED`, undelivered exceptions to `NDR`, and RTO milestones to `RTO_INITIATED` or `RTO_DELIVERED`. Existing transition validation rejects stale or backward events.

## Customer live tracking

The existing customer/provider tracking refresh path is cached by order ID for 20 minutes. The helper resolves the shipment and AWB server-side, checks the polling claim, fetches the provider tracking response when needed, and returns only the customer-safe projection. Do not expose carrier credentials or let the browser choose an arbitrary AWB.

## Operations and limitations

- This mode does not depend on carrier webhooks. Existing webhook routes may remain disabled/not configured; polling is the source of status refresh.
- The worker must be running continuously for the 3-hour schedule to execute. The API process alone does not run the poller.
- The poller is sequential and rate-limited at 500ms per AWB. A 5,000-AWB batch can take roughly 42 minutes plus carrier/network latency.
- Shiprocket and Shadowfax API response shapes, courier availability, and account entitlements must be verified against the live account/sandbox before production enablement.
- No live courier booking or production tracking call is made by tests. Use test credentials and a sandbox/test order first.

# Seller privacy enforcement

This document describes the enforcement path for seller-controlled customer-data disclosure.

## Policy defaults and ownership

- Settings are stored per seller in MongoDB (SellerPrivacySettings), never in browser storage.
- Missing settings resolve to **deny all fields**.
- Only the authenticated seller (or an authorized admin acting on their own seller context) can read or update their policy through:
  - GET /api/seller/privacy-settings
  - PUT /api/seller/privacy-settings
- The request schema is strict and accepts only four booleans: recipient name, recipient phone, recipient address, and recipient email.
- GET /api/seller/privacy-disclosures returns the seller-scoped authorization audit (latest 100); admins can inspect the full audit.
- The Logistics dashboard exposes the controls and audit history.

## Provider isolation

Provider APIs use a response DTO sanitizer at the API boundary. It recursively removes buyer/customer IDs, customer identity/contact fields, recipient fields, and shipping/billing/delivery addresses from provider profile, catalogue and settlement responses. Provider role checks remain mandatory; UI visibility is not an authorization control.

The provider DTO is deliberately separate from seller order DTOs. Sellers retain access to their own order/customer information under seller authorization. Carrier workers receive only the explicitly authorized fulfilment fields.

## Carrier disclosure and queue handling

1. The seller selects a carrier for an order.
2. The API loads that seller's persisted policy and authorizes the selected carrier against it. Name, phone and delivery address are mandatory for shipment creation and must each be explicitly enabled.
3. Email is independently opt-in. Shiprocket additionally requires both an enabled email field and a buyer email address; otherwise shipment creation is rejected with a policy error.
4. The API encrypts the approved recipient/address object with the configured application field-encryption key before writing the logistics job. The queue payload contains ciphertext, not plaintext recipient details.
5. The worker initializes the production MongoDB connection, reloads the seller's current policy immediately before carrier dispatch, compares the authorized field set with the queued scope, decrypts the payload in memory and rejects missing or revoked authorization. It also checks that the queued carrier matches the configured carrier.
6. An audit record stores seller, order, carrier, actor, authorized field names and timestamp. It never stores recipient values.

Disabling a field therefore prevents new shipment creation and causes already queued jobs using that field to fail closed at dispatch. Re-enabling a field is an explicit seller action.

## Production configuration and rollout

- Configure the same durable MONGODB_URI for the API and logistics worker. The worker refuses to start in production unless MongoDB is available.
- Configure ENCRYPTION_MASTER_KEY consistently on API and worker. The same key must be available to decrypt queue payloads. Do not rotate it without a planned re-encryption / key-version migration.
- Keep the logistics Supabase service-role credential server-side only. Queue rows contain encrypted customer delivery data.
- Deploy the API before enabling shipment creation; deploy the worker with the same MongoDB and encryption configuration.
- Existing queued jobs created before this change do not contain an authorization envelope and are intentionally rejected by the worker. Re-create those shipment intents after the seller saves a policy.
- Before production rollout, run npm test, npm run lint, the customer/seller/provider end-to-end suite, and carrier sandbox tests. Verify that disabling a policy while a job is queued prevents carrier dispatch, that a provider token cannot retrieve buyer details, and that Shiprocket is blocked unless email sharing is explicitly enabled.

## API contract example

```json
{
  "carrierDisclosure": {
    "recipientName": true,
    "recipientPhone": true,
    "recipientAddress": true,
    "recipientEmail": false
  }
}
```

For Shiprocket, set recipientEmail to true only when the seller authorizes that additional disclosure. All other fields remain independently controlled.

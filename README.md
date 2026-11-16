# E-Commerce Store

A modern, user-friendly online shopping platform designed to provide customers with a smooth, secure, and convenient shopping experience.

## About the Website

This e-commerce website brings products and customers together through a simple and intuitive online shopping experience. Customers can explore products, discover new arrivals, view detailed product information, add items to their cart, and manage their shopping experience in one place.

The website is designed with a clean interface, responsive layouts, and easy navigation across desktop, tablet, and mobile devices.

## Website Features

### Customer Shopping Experience
- Browse and explore available products.
- View product images, descriptions, and pricing.
- Search and discover products easily.
- Explore products by categories.
- View detailed product information.
- Add products to the shopping cart.
- Update product quantities and remove items.
- Enjoy a streamlined shopping experience.

### User Account
- Unified account registration and sign-in, including Supabase Google and Facebook OAuth.
- Personalized customer experience.
- Manage account information.
- Access customer-related features.

### Product Experience
- Modern product listing pages.
- Detailed product pages.
- Product image viewing and zoom functionality.
- Clean product presentation.
- Easy product discovery.

### Shopping Cart
- Add and remove products.
- Update item quantities.
- Review selected products.
- View shopping cart totals.

### Admin Experience
- Manage products and product information.
- Organize product listings.
- Manage customer orders.
- Maintain the store's product catalogue.

## Design & User Experience

- Modern and clean interface.
- Responsive design for different screen sizes.
- Easy-to-use navigation.
- Customer-friendly layouts.
- Smooth shopping interactions.
- Optimized product browsing experience.

## Authentication configuration

The server uses `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The browser OAuth client uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the same Supabase project URL and public anon/publishable key). In Supabase Authentication → Providers, enable Google and Facebook and add each provider's credentials. Add the deployed storefront URL to Supabase's URL Configuration and allow the redirect URL used by the app. Seller and provider demo-account switching is available only outside production. Existing server-side role authorization remains in force.

## Non-production demo accounts

On application startup, MongoDB checks the configured demo identities by normalized email and inserts only missing users. The operation uses the unique email index and an insert-only upsert, so repeated or concurrent application starts do not duplicate accounts or overwrite an existing account's role/profile. The sample catalogue is initialized only when the products collection is empty. The same identities are present in the local JSON development store.

| Role | Demo account | Email |
|---|---|---|
| Admin | Kala & Karat Ops | `ops@kalaandkarat.in` |
| Customer (BUYER) | Ananya Mehta | `ananya.mehta@example.com` |
| Seller | Meera Zaveri | `meera@zaveriatelier.in` |
| Provider | Aarav Artisan Supply | `provider.aarav@example.com` |
| Provider | Nisha Craft Works | `provider.nisha@example.com` |

These are quick role-switch accounts, not password-based credentials. Use the demo account selector in the sign-in modal; demo sign-in is disabled in production. Provider demo identities and their synthetic profile/catalog fixtures are non-production only. Never use demo identities or fixture data for real orders, payments, shipping, tax, settlement, or KYC.

## Technology

The website uses modern web technologies to deliver a responsive and interactive shopping experience.

---

**E-Commerce Store**  
A simple, convenient, and modern way to shop online.</Writing


## Commerce security and payment workflows

Configure `ENCRYPTION_MASTER_KEY` as a base64-encoded 32-byte key (for example, generate it with `openssl rand -base64 32`). The key is used for AES-256-GCM encryption of seller payment API and webhook secrets. Back it up in a managed secrets vault and rotate with a versioned migration plan; losing it makes encrypted gateway credentials unrecoverable. Set `CORS_ALLOWED_ORIGINS` to a comma-separated list of exact HTTPS storefront origins. Session cookies use `HttpOnly`, `Secure`, and `SameSite=Lax`; state-changing requests with an authenticated session must send the session-bound `X-CSRF-Token` returned by `/api/auth/me` or sign-in.

Seller payment configuration endpoints support Razorpay and Stripe. Configure each provider's webhook URL as `/api/webhooks/razorpay/:sellerId` or `/api/webhooks/stripe/:sellerId`, using the matching seller ID in the URL. The webhook signing secret must be configured in Seller Hub. Payment confirmation is webhook-driven; never mark an order paid based only on a browser callback. Wallet ledger operations require MongoDB transactions (Atlas replica set or sharded cluster). The return evidence upload endpoint currently accepts validated photos; server-side video duration probing is not enabled, so do not submit video evidence until a media-probing pipeline is added.


## Deployment and customer-data privacy

See [Deployment and Customer-Data Privacy Runbook](docs/deployment-and-customer-data-privacy.md) for service-level environment configuration, startup, deployment order, seller-controlled carrier disclosure, provider data isolation and release tests. Start the current root application with `bun run start:app` (or pass `dev`, `start`, or `build`).
Seller payment configuration endpoints support Razorpay and Stripe. Configure each provider's webhook URL as `/api/webhooks/razorpay/:sellerId` or `/api/webhooks/stripe/:sellerId`, using the matching seller ID in the URL. The webhook signing secret must be configured in the seller dashboard. Payment confirmation is webhook-driven; never mark an order paid based only on a browser callback. Wallet ledger operations require MongoDB transactions (Atlas replica set or sharded cluster). The return evidence upload endpoint currently accepts validated photos; server-side video duration probing is not enabled, so do not submit video evidence until a media-probing pipeline is added.


## Modular provider supply workspace

See [Provider Supply, Negotiation & Settlement Workflow](docs/provider-supply-workflow.md) for workspace commands, API contracts, onboarding, seller negotiation, retail publishing, settlement lifecycle and production readiness boundaries. The customer and provider frontends can be run independently with `bun run dev:customer` and `bun run dev:provider`. Seller operations are integrated into the main application: authenticated SELLER users land directly on the seller dashboard, with a seller-only Storefront tab to return to the customer storefront. There is no separate Seller Hub frontend or deployment target. Run the complete local stack with `bun run dev:all`.

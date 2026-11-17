# Independent customer UI

The customer storefront is a standalone Vite/React application rooted at
`apps/customer-web`. It reuses the existing storefront components and shared
workspace packages; it does not start, bundle, or replace the API server.

## Local development

Run commands from the repository root so Bun resolves the shared workspaces:

```bash
bun install --no-save
bun run dev:customer
```

The UI runs on `http://localhost:4173`. During development, `/api` and
`/uploads` are proxied to the local API at `http://localhost:3000`.

In another terminal, start the API using the repository's normal command:

```bash
bun run start
```

## Production build and local start

```bash
bun run build:customer
bun run start:customer
```

The production bundle is written to `dist/customer-web`. The preview server
listens on port 4173 by default and uses the hosting platform's `PORT` when
provided. You can also run the workspace directly from its directory with
`bun run --cwd apps/customer-web build` and `bun run --cwd apps/customer-web start`.

The app's API origin is compiled into the static bundle at build time:

- `VITE_API_BASE_URL`: absolute API origin, e.g. `https://<api-host>`.
  Leave empty only when the UI and API are served from the same origin.
- `VITE_ASSET_BASE_URL`: optional origin for uploaded media; defaults to the API origin.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: public browser values only, if
  Supabase browser authentication is enabled.

Never put MongoDB, Supabase service-role, session, encryption, payment, or carrier
secrets in any `VITE_*` variable.

## Independent static deployment

The root `render.yaml` defines the customer UI as a free Render Static Site:

- Build: `bun install --no-save && bun run build:customer`
- Publish directory: `dist/customer-web`
- Rewrite: all client-side routes to `/index.html`
- Build-time API configuration: `VITE_API_BASE_URL` and optional
  `VITE_ASSET_BASE_URL`

Set the exact UI origin in the API's `CORS_ALLOWED_ORIGINS` and set the UI's
`VITE_API_BASE_URL` to the API origin before building. Static hosting does not
need a Node start command; the host serves the generated files. The
`start:customer` command is for local production-preview testing or a
container-based static host.

This change only prepares build and deployment configuration. It does not
create, deploy, or upgrade any hosting service.

# QuietCollective

QuietCollective is an AGPL-3.0-or-later private gallery, critique, and collaboration platform for small artist communities. It is a Cloudflare-hosted web app using Workers, static assets, D1, private R2 media storage, and a queue-backed export workflow.

Uploaded artwork, files, critique, and other user content remain owned by the uploader or the applicable rights holder. Running or joining an instance does not transfer ownership; the app stores and displays content only for the private community features configured by that instance.

## Project Shape

- Cloudflare Worker name: `quietcollective`
- Worker entrypoint: `worker/src/index.ts`
- Static app source: `public`
- D1 database binding: `DB` (`quietcollective`)
- D1 migrations directory: `migrations`
- Worker config: `wrangler.jsonc`
- Private R2 bucket binding: `MEDIA` (`quietcollective-media`)
- Queue binding: `JOBS` (`quietcollective-jobs`)
- Default instance name: `QuietCollective`

## Local Setup

```bash
npm install
npm run web:build
npm run d1:migrations:apply
npm run dev
```

For local development, copy `.env.example` to `.dev.vars` or set equivalent environment variables for Wrangler. Before creating the first admin, set a long random session signing secret and a separate one-time setup token:

```bash
wrangler secret put JWT_SECRET
wrangler secret put ADMIN_SETUP_TOKEN
```

Open `/setup` and use `ADMIN_SETUP_TOKEN` once. After the first admin exists, setup is disabled and normal registration remains invite-only.

## Cloudflare Deployment

These instructions use the production resource names already referenced by `wrangler.jsonc`. Do not commit deployment domains or private endpoint URLs to the repository.

1. Create the Cloudflare resources:
   ```bash
   wrangler d1 create quietcollective
   wrangler r2 bucket create quietcollective-media
   wrangler queues create quietcollective-jobs
   ```
2. In `wrangler.jsonc`, keep the Worker `name` as `quietcollective` and replace only the placeholder `database_id` with the ID returned by `wrangler d1 create quietcollective`.
3. Configure runtime values:
   - `INSTANCE_NAME` defaults to `QuietCollective`.
   - `SOURCE_CODE_URL` should point to the corresponding AGPL source location when the instance is deployed.
4. Configure secrets. Use different high-entropy values for the JWT/session signing secret and the setup token:
   ```bash
   wrangler secret put JWT_SECRET
   wrangler secret put ADMIN_SETUP_TOKEN
   ```
5. Configure browser push notification keys before deploying Web Push support:
   ```bash
   npm run vapid:generate
   wrangler secret put VAPID_PUBLIC_KEY
   wrangler secret put VAPID_PRIVATE_KEY
   wrangler secret put VAPID_SUBJECT
   ```
   Use the generated public key for `VAPID_PUBLIC_KEY`, the generated private key for `VAPID_PRIVATE_KEY`, and a contact URI such as `mailto:notifications@example.com` for `VAPID_SUBJECT`.
6. Apply D1 migrations locally when developing and remotely before production deploys:
   ```bash
   npm run d1:migrations:apply
   npm run d1:migrations:apply:remote
   ```
7. Build and deploy:
   ```bash
   npm run deploy
   ```

`npm run deploy` runs `npm run verify`, applies remote D1 migrations, then runs `wrangler deploy`.

## Safety Defaults

- Registration is invite-only after bootstrap setup.
- Galleries are private by default.
- `server_public` galleries are visible only to logged-in members.
- Keep `quietcollective-media` private. Do not make the R2 bucket public and do not serve originals directly from public R2 URLs; originals and derived media should go through permission-checked Worker routes.
- The service worker avoids API and original media caching by default.
- Comments are allowed only when the user can view the target.
- `feedback_requested` is a UI signal only; it never broadens access.

## Media Backfill

New image uploads create WebP preview and thumbnail variants for grid and feed views while keeping originals private in R2. To convert existing preview/thumbnail media to WebP after upgrading an instance, run:

```bash
npm run media:backfill:webp -- --remote
```

Use `--dry-run` first to see which image versions will be touched. If you deploy with a non-default Wrangler config, pass `--config <path>`.

## Useful Commands

```bash
npm run web:dev
npm run web:build
npm run worker:typecheck
npm run test:security
npm run verify
npm run vapid:generate
npm run media:backfill:webp -- --dry-run
npm run d1:migrations:apply
npm run d1:migrations:apply:remote
```

## API Documentation

Interactive API documentation is available from the static app at `/developers/` or `/developers.html`. The Redoc page renders `public/api/openapi.yaml`.

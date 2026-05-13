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

`wrangler` is installed as a project dev dependency, so `npm install` provides the pinned Wrangler CLI used by the npm scripts.

For local development, copy `.env.example` to `.dev.vars` or set equivalent environment variables for Wrangler. Before creating the first admin, set a long random session signing secret and a separate one-time setup token:

```bash
wrangler secret put JWT_SECRET
wrangler secret put ADMIN_SETUP_TOKEN
```

Open `/setup` and use `ADMIN_SETUP_TOKEN` once. After the first admin exists, setup is disabled and normal registration remains invite-only.

## Cloudflare Deployment

These instructions use the production resource names already referenced by `wrangler.jsonc`. Do not commit deployment domains, account-specific IDs, secrets, or private endpoint URLs to the repository; use an ignored config such as `wrangler.<instance>.jsonc` for instance-specific deployments.

Cloudflare requires account billing before R2 can be used. Add a credit card and activate R2 in the Cloudflare dashboard before running `wrangler r2 bucket create ...`; the app keeps R2 private, but the service still has to be enabled on the account.

1. Install dependencies and log Wrangler into the target Cloudflare account:
   ```bash
   npm install
   npx wrangler login
   npx wrangler whoami
   ```
2. Create the Cloudflare resources:
   ```bash
   npx wrangler d1 create quietcollective
   npx wrangler r2 bucket create quietcollective-media
   npx wrangler queues create quietcollective-jobs
   npx wrangler kv namespace create SETTINGS_CACHE
   ```
3. In `wrangler.jsonc`, keep the Worker `name` as `quietcollective`, replace the placeholder `database_id` with the ID returned by `wrangler d1 create quietcollective`, and add the returned KV namespace ID under a `kv_namespaces` entry with binding `SETTINGS_CACHE`.
4. Configure runtime values:
   - `INSTANCE_NAME` defaults to `QuietCollective`.
   - `SITE_URL` should be the canonical public URL users open in the browser, for example `https://example.pages.dev` or `https://community.example.org`. Invite, password reset, and welcome email links use this value. It can also be edited later from Admin -> Branding -> Site URL.
   - `SOURCE_CODE_URL` should point to the corresponding AGPL source location when the instance is deployed.
   - `R2_ACCOUNT_ID` should be the Cloudflare account ID shown by `npx wrangler whoami`.
   - `R2_BUCKET_NAME` should match the private media bucket name.
5. Configure secrets. Use different high-entropy values for the JWT/session signing secret and the setup token:
   ```bash
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put ADMIN_SETUP_TOKEN
   ```
6. To let browsers download permitted media directly from private R2, create an R2 API token in the Cloudflare dashboard with object read access for the media bucket, then store its S3 credentials as Worker secrets:
   ```bash
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   ```
   If these secrets or `R2_ACCOUNT_ID` are not configured, the app falls back to its permission-checked Worker media route.
7. Configure browser push notification keys before deploying Web Push support:
   ```bash
   npm run vapid:generate
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT
   ```
   Use the generated public key for `VAPID_PUBLIC_KEY`, the generated private key for `VAPID_PRIVATE_KEY`, and a contact URI such as `mailto:notifications@example.com` for `VAPID_SUBJECT`.
8. Apply D1 migrations locally when developing and remotely before production deploys:
   ```bash
   npm run d1:migrations:apply
   npm run d1:migrations:apply:remote
   ```
9. Build and deploy:
   ```bash
   npm run deploy
   ```

`npm run deploy` runs `npm run verify`, applies remote D1 migrations, then runs `wrangler deploy`.

For an instance-specific config, run the same steps with `--config wrangler.<instance>.jsonc`, for example:

```bash
npx wrangler d1 migrations apply <worker-or-database-name> --remote --config wrangler.<instance>.jsonc
npx wrangler deploy --config wrangler.<instance>.jsonc
```

After the first deploy, open `/setup` on the public URL, create the first admin with `ADMIN_SETUP_TOKEN`, then open Admin -> Branding and confirm Site URL is set to the public URL. Create a test invite and confirm its link uses that public origin.

### Pages Proxy Or External Hostname

If the public hostname cannot be attached directly to a Worker route, deploy the Worker on `workers.dev` and put a tiny Cloudflare Pages Function in front of it. This is useful for Pages-hosted URLs or DNS providers that only allow CNAMEs to Pages.

1. Create a Pages project with an empty `index.html`.
2. Add `functions/[[path]].js`:
   ```js
   const UPSTREAM_ORIGIN = "https://your-worker.your-account.workers.dev";

   export async function onRequest(context) {
     const incomingUrl = new URL(context.request.url);
     const upstreamUrl = new URL(UPSTREAM_ORIGIN);
     upstreamUrl.pathname = incomingUrl.pathname;
     upstreamUrl.search = incomingUrl.search;
     return fetch(new Request(upstreamUrl, {
       method: context.request.method,
       headers: context.request.headers,
       body: context.request.body,
       redirect: "manual",
     }));
   }
   ```
3. Deploy it:
   ```bash
   npx wrangler pages deploy pages-proxy.<instance> --project-name <pages-project-name>
   ```
4. Set `SITE_URL` or Admin -> Branding -> Site URL to the Pages URL, not the upstream `workers.dev` URL.

## Safety Defaults

- Registration is invite-only after bootstrap setup.
- Galleries are private by default.
- `server_public` galleries are visible only to logged-in members.
- Keep `quietcollective-media` private. Do not make the R2 bucket public. Media URLs should be produced only after Worker permission checks, either as short-lived R2 S3 presigned GET URLs or through the fallback signed Worker media route.
- The service worker avoids API and original media caching by default.
- Comments are allowed only when the user can view the target.
- `feedback_requested` is a UI signal only; it never broadens access.

## Useful Commands

```bash
npm run web:dev
npm run web:build
npm run worker:typecheck
npm run test:security
npm run verify
npm run vapid:generate
npm run d1:migrations:apply
npm run d1:migrations:apply:remote
```

## API Documentation

Interactive API documentation is available at `/developers`, `/developers/api`, `/developers/`, or `/developers.html`. The Redoc page renders the published OpenAPI spec from `/api/openapi.yaml`.

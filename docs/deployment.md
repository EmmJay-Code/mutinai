# Public preview deployment

Mutinai's public preview runs on [Render](https://render.com) from `render.yaml`. Why Render, and what is deliberately
not deployed: [ADR-0007](adr/0007-preview-deployment.md).

| Runs publicly | Not deployed |
|---|---|
| `mutinai-web`: Next.js via `next start` (Starter, ~$7/mo) | Resident worker (its bootstrap runs once per deploy instead) |
| `mutinai-db`: Postgres 16, private network only (Basic-256mb, ~$6/mo + storage) | Object store (snapshots go to ephemeral disk) |
| `mutinai-ingest`: Cron Job, live ingestion every 6 h (Starter, $1/mo minimum; see [live-ingestion.md](live-ingestion.md)) | |

The preview is **read-only**. Development sign-in never runs when `NODE_ENV=production`, so there is no sign-in, no
session, and no community write, vote or moderation action. It sends `noindex` and needs no external APIs. Only the
`mutinai-ingest` cron job calls upstream sources, and only it holds source tokens.

## One-time setup

1. **Private GitHub repository.** From the repo root:
   ```bash
   gh repo create mutinai --private --source=. --remote=origin --push
   ```
2. **Render.** Sign in to Render with GitHub. Then **New → Blueprint**, grant the Render GitHub App access to the
   `mutinai` repo only, select it and **Apply**. Render creates the database and the web service, wires `DATABASE_URL`,
   and attaches `mutinai.com` and `www.mutinai.com`. The Starter plan needs a payment method.
   - `region` in `render.yaml` (default `virginia`) cannot be changed later. Edit it before applying if needed.
3. **First deploy** runs automatically: `npm ci` + `next build` → `npm run db:bootstrap` (migrate, seed, ingest
   fixtures) → `npm start`. Verify on the `https://mutinai-web….onrender.com` URL shown on the service page (see
   [Checks](#checks)).
4. **DNS.** Add the records below at the registrar. Then open **mutinai-web → Settings → Custom Domains** and click
   **Verify** on each domain. Render issues the TLS certificates itself.

## DNS records for mutinai.com

Use the exact `*.onrender.com` hostname from the service page. Render appends a suffix if `mutinai-web` is taken.

| Type | Name / host | Value |
|---|---|---|
| `A` | `@` (mutinai.com) | `216.24.57.1` |
| `CNAME` | `www` | `mutinai-web.onrender.com` |

- Delete any other `A` or `AAAA` records on `@` and `www`, such as registrar parking or forwarding.
- If the registrar supports `ALIAS`/`ANAME` on the apex, `ALIAS @ → mutinai-web.onrender.com` can replace the `A`
  record. On Cloudflare DNS, use `CNAME @ → mutinai-web.onrender.com`, DNS-only (grey cloud).
- Only if the domain has `CAA` records: also allow `letsencrypt.org` and `pki.goog`.
- Render redirects between `www` and the apex automatically. After verification, check on **Custom Domains** that
  `www.mutinai.com` redirects to `mutinai.com` (the canonical URL).

## Checks

```bash
BASE=https://mutinai.com   # or the onrender.com URL before DNS
curl -s $BASE/api/health                                 # {"status":"ok"}
curl -sI $BASE/ | grep -i x-robots-tag                   # noindex, nofollow
curl -s $BASE/signin | grep -o "read-only preview"       # no sign-in in production
curl -s "$BASE/api/v1/search?q=qwen" | head -c 200
```

## Configuration

| Variable | Set by | Purpose |
|---|---|---|
| `DATABASE_URL` | Blueprint (from `mutinai-db`) | Postgres connection (internal network) |
| `NODE_ENV` | Blueprint: `production` | Disables development sign-in and all community writes |
| `MUTINAI_SITE_URL` | Blueprint: `https://mutinai.com` | Canonical origin for absolute metadata URLs |
| `MUTINAI_ALLOW_INDEXING` | Blueprint: `0` | `1` lifts `noindex`. Build-time, so redeploy after changing |

`SESSION_SECRET` and `MUTINAI_DEV_LOGIN` are not used in production. Setting `MUTINAI_DEV_LOGIN=1` has no effect there.

## Operations

- **Deploy**: every push to the default branch redeploys. A failed build or bootstrap leaves the previous version live.
- **Data**: bootstrap is idempotent. It never reseeds a seeded database, and unchanged fixtures are no-ops.
  To rebuild the demo dataset from scratch, delete `mutinai-db`, re-sync the Blueprint, and redeploy.
  (`db:reset` refuses to run in production.)
- **Logs**: Render dashboard → service → Logs. Errors reach the browser only as an opaque digest.

## Production mode locally

```bash
createdb -h 127.0.0.1 -p 54329 -U mutinai mutinai_preview      # after `npm run db:up`
export DATABASE_URL=postgres://mutinai@127.0.0.1:54329/mutinai_preview NODE_ENV=production
npm run db:bootstrap && npm run build && PORT=3100 npm start
```

## Later

- **Worker**: add a `type: worker` service running `npm run worker -- work`, with the same `DATABASE_URL`.
- **Retained raw snapshots**: need an S3-compatible `ObjectStore` (ADR-0008).
- **Indexing**: once real data is connected, set `MUTINAI_ALLOW_INDEXING=1`.
- **Community writes**: need production identity and rate limiting first.

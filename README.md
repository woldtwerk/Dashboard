# Allmight Dashboard

One dashboard aggregating mail, drive, calendar and more. Built on the [Nuxt UI dashboard template](https://github.com/nuxt-ui-templates/dashboard) (MIT).

## Architecture

Every domain is a [Nuxt layer](https://nuxt.com/docs/getting-started/layers) in `layers/`, auto-registered by Nuxt:

| Layer | Responsibility |
| --- | --- |
| `core` | Dashboard shell, services (connectors, instances, encrypted storage) and the generic setup wizard |
| `mail` | Mail domain: entities (`shared/types`), `MailProvider` port (`server/utils`), API (`/api/mail/*`), UI (`/mail`) |
| `mail-proton` | Proton Mail connector: wizard (sign-in to the Bridge container) + `MailProvider` via Proton Mail Bridge (IMAP) |
| `mail-search-meilisearch` | `MailSearchIndex` adapter: Meilisearch with hybrid (keyword + semantic) search |
| `ai` | AI domain: language model port; providers are services (`registerAiProvider`) |
| `ai-openai-compatible` | AI connectors: OpenCode (Go/Zen) and any OpenAI-compatible API (e.g. Ollama) |
| `mail-ai` | Natural language search filters for the mail page and the `/assistant` chat |
| `documents` | Documents domain: entities (`shared/types`), `DocumentsProvider` port (`server/utils`), API (`/api/documents/*`), UI (`/documents`) |
| `documents-paperless` | Paperless-ngx connector: wizard (URL + token, or username/password) + `DocumentsProvider` via the Paperless-ngx REST API |
| `redis` | Redis as Nitro storage mount `redis` (when `NUXT_REDIS_URL` is set) |
| `dev` | Development only: Nuxt DevTools tab for RedisInsight |

Each layer is a pnpm workspace package with its own `package.json`; all versions come from the `catalog:` in `pnpm-workspace.yaml`.

### Connectors and services

- A **connector** is a service type (e.g. Proton Mail). It belongs to a domain (`mail`) and declares its setup wizard as a schema of steps and fields (`SetupWizard` in `layers/core/shared/types/setup.ts`), plus optional `validate` and `test` hooks.
- A **service** is a configured instance of a connector, added via *Services → Add service*. Any number of services per connector is possible, e.g. several Proton accounts.
- Domain pages only appear in the navigation once a service of their domain exists (`domain` on the navigation entry in `app.config.ts`).
- A domain can add a submenu to its navigation entry with `defineNavigationChildren('<key>', useComposable)` in a plugin (e.g. mail folders, grouped by account).

Adding a connector, e.g. for another mail provider, is a new layer with a Nitro plugin:

```ts
export default defineNitroPlugin(() => {
  registerConnector(myConnector) // id, domain, title, wizard, validate?, test?
  registerMailProvider(myConnector.id, values => createMyMailProvider(values))
})
```

### Setup wizard

`/services/new/<connector>` and `/services/<id>` render the connector's schema generically. The server validates input against the same schema, runs the connector's `test`, and only then stores the values.

- Services are stored in SQLite (`node:sqlite` + Drizzle, `.data/allmight.sqlite`, override with `NUXT_DATABASE_PATH`). Their settings are encrypted (AES-256-GCM, key derived from `NUXT_APP_SECRET`).
- A step can name a global component a domain layer provides (`component`), which renders the step instead of its fields, e.g. the Proton sign-in. A connector's `complete` hook fills values only the server can know before they are validated.
- Fields marked `secret` are never sent to the browser. Left empty on edit, the stored value is kept. If a field listed in `bindSecretsTo` changes (e.g. host), the secret has to be re-entered, so a stored password can't be redirected to another server.

## Proton Mail

Proton has no public mail API, so mail is accessed through [Proton Mail Bridge](https://proton.me/mail/bridge) (paid plan required), which decrypts locally and exposes IMAP.

Bridge runs as its own container (`.ddev/proton-bridge`): Proton's official `.deb`, checked against Proton's signature and a pinned checksum, started as `protonmail-bridge --cli`. A small control API in the container (`control.py`, port 8080) drives that interactive CLI in a pseudo terminal. The wizard signs in through it with the Proton address, password and two-factor code (plus the mailbox password in two-password mode). Bridge keeps the account in its vault, and the dashboard stores only the Bridge IMAP credentials and Bridge's certificate.

- The Proton password goes from the browser via the server to Bridge and is never stored. The IMAP password Bridge generates never reaches the browser: the server fetches it from Bridge when the service is saved.
- The control API needs a token: generate one (`openssl rand -hex 32`) and set it as `BRIDGE_CONTROL_TOKEN` in `.ddev/.env.proton-bridge` and as `NUXT_PROTON_BRIDGE_TOKEN` in `.ddev/.env.web`.
- The volume `proton-bridge` holds the vault and the GPG key that unlocks it (no passphrase), so it is as sensitive as the mailbox itself.
- Security keys (FIDO2) cannot be used in the CLI. Sign in with an authenticator code. If Proton asks for human verification (CAPTCHA), the CLI cannot complete it.
- To update Bridge, change `BRIDGE_VERSION` and `BRIDGE_SHA256` in the Dockerfile.

The connection always requires STARTTLS. Bridge's certificate is pinned, and because it is issued for `127.0.0.1` it is also accepted for the container host. HTML mails render in a sandboxed iframe with a CSP that blocks scripts and all remote content (including tracking pixels).

> The dashboard has no authentication yet. Run it only on `localhost`, because anyone who can reach it can read mail and change services.

## Mail search

Searches go to a search index once a folder is fully indexed, otherwise to the mail provider (IMAP `SEARCH` via Bridge).

- The index is synced in the background (new, changed and deleted mails; one cluster worker per account via a lock in the database). Sync state lives in SQLite.
- Meilisearch computes embeddings itself with a local multilingual model (`paraphrase-multilingual-MiniLM-L12-v2`), so semantic search finds "Rechnung" for "invoice" without sending mail to an external service.
- Message text is stored unencrypted in Meilisearch. Keep it local and check this against data protection rules before indexing customer mail.
- Settings: `NUXT_MEILISEARCH_*` in `layers/mail-search-meilisearch/nuxt.config.ts`.

## AI

An AI provider is a service like a mail account: *Services → Add service → OpenCode* (or any OpenAI-compatible API). The wizard tests URL, key and model; the key is stored encrypted.

- **Search filters:** the sparkles button in the mail search turns "unread invoices from Stripe since October" into filters.
- **Assistant** (`/assistant`): answers questions about your mail. It searches (index first, otherwise the mail server), can read single mails, and links the mails it used. It can only read, never send or change mail.
- Questions and mail excerpts go to the configured provider. With an external provider (e.g. OpenCode), get approval before using it with personal or customer data; check OpenCode Go's terms (meant for coding agents) — Zen is meant for apps. A local model keeps everything on your machine.
- Answers are rendered as plain text, and the model is told to treat mail content as untrusted data.

## Database

SQLite via the built-in `node:sqlite` module and [Drizzle](https://orm.drizzle.team) (`sqlite-proxy` driver). Tables are defined in `layers/*/server/db/schema.ts`.

```bash
pnpm db:generate   # create a migration after changing a schema
```

Migrations land in `layers/core/server/db/migrations`, are bundled with the server and applied automatically on first database access. This is safe with several cluster workers: they wait for each other instead of migrating twice.

## DDEV

`.ddev/` runs the Nuxt dev server plus Meilisearch, Redis, RedisInsight, Paperless-ngx and Proton Mail Bridge:

```bash
ddev start
ddev describe   # URLs: app, Meilisearch dashboard (:7701), RedisInsight (https://redis.allmight.<tld>), Paperless-ngx (https://paperless.allmight.<tld>)
```

Secrets live in gitignored env files (`.ddev/.env.web`, `.ddev/.env.meilisearch`, `.ddev/.env.proton-bridge`, `.ddev/.env.paperless`). A `pre-start` hook (`.ddev/scripts/ensure-secrets.sh`) creates missing ones on `ddev start` — `NUXT_APP_SECRET`, the Meilisearch key, the Bridge token and the Paperless admin/secret key — and never overwrites existing values: a new `NUXT_APP_SECRET` would make stored services unreadable. The app's SQLite database is shared with a dev server started outside DDEV, so don't run both at once.

Paperless-ngx is a new service in `.ddev/docker-compose.paperless.yaml`; DDEV only creates it and registers its subdomain on the next **`ddev restart`**, which you have to run yourself.

## Documents

The `documents` layer is a provider-agnostic document archive (list with table/grid and thumbnails, full-text and "more like this", tags/correspondent/type/storage path/custom fields/date/ASN/owner filters, saved views, detail with preview and metadata/notes/history/suggestions/share links, upload with task progress, bulk edit and download). `documents-paperless` connects it to a running [Paperless-ngx](https://docs.paperless-ngx.com/) instance over its REST API.

- *Services → Add service → Paperless-ngx*: enter the base URL and either an API token or a username/password, from which the server obtains a token (`POST /api/token/`). Only the token is stored (encrypted, like every service credential); the password is never persisted and never reaches the browser.
- The browser never sees the token: every Paperless call goes through `/api/documents/*`, which builds the upstream URL from validated ids server side. File previews/thumbnails/downloads stream through the proxy with a conservative content type, `X-Content-Type-Options: nosniff` and a `sandbox` CSP.
- The API version is read from the instance (`X-Api-Version` on `/api/`) and sent back as `Accept: application/json; version=N`.
- Paperless-ngx is GPL-3.0; this repo only talks to its API and runs its unmodified image, it does not copy its source.

## Development

```bash
cp .env.example .env   # set NUXT_APP_SECRET (openssl rand -base64 32)
ddev exec pnpm install
ddev exec pnpm dev --host 0.0.0.0   # https://allmight.localhost
ddev exec pnpm run lint
ddev exec pnpm run typecheck
ddev exec pnpm run test
ddev exec pnpm run build
```

In development, Nuxt generates `NUXT_APP_SECRET` in `.nuxt/app-secret` if it isn't set. Clearing `.nuxt` then makes stored services unreadable, so set it in `.env`.

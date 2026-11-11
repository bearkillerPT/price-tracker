# Price Tracker

Self-hosted price tracking for a few EU web shops. It checks product pages on a schedule, keeps the price history, and sends Gotify notifications when a price drops, hits a target or comes back in stock.

- **Amazon EU stores** work today, without signing in.
- **Other shops** can be added from a product link. If they publish standard product data, it's read directly; otherwise you pick the price on the page in a live browser view. Fnac and Radio Popular work; Worten, PCDiga and Switch Technology block automated checks.
- **Amazon Business, signed-in Amazon and PcComponentes** come next; see [DESIGN.md](DESIGN.md).

Stores don't want automated checks. Keep intervals long; the Stores page shows how many requests each store is getting.

## Layout

| Path | What |
|---|---|
| `apps/api` | Express + Drizzle server: API, scheduler, store adapters, notifications, `price-tracker` CLI |
| `apps/web` | React + Vite + Tailwind + shadcn/ui front end, served by the API in production |
| `packages/shared` | The API contract (zod schemas and response types) and the store/marketplace list |
| `DESIGN.md` | Decisions, spike results, build order |

## Development

Node 24 and pnpm come from the Nix dev shell, the same nixpkgs as the Pi. Postgres runs in Docker.

```bash
nix develop            # or prefix commands with `nix develop -c`
pnpm install
pnpm db:up             # Postgres 17 on 127.0.0.1:55432
cp .env.example .env   # set CHECKS_ENABLED=false to work on the UI without making store requests
pnpm dev               # API on :4380 (PORT in .env), web on :5173 with /api proxied
```

On first visit the app asks for a password. There is only one account.

The live browser (picking prices) and browser checks need Chromium. The dev shell sets `PLAYWRIGHT_BROWSERS_PATH` to nixpkgs' build, which `playwright-core` is pinned to. Shop links and the browser refuse local and private addresses; `ALLOW_PRIVATE_HOSTS=true` in `.env` lifts that, for trying things against a local page.

## Tests and checks

```bash
pnpm typecheck
pnpm test        # API unit tests and an end-to-end API test
```

- **Amazon parser tests** use saved pages from `apps/api/test/fixtures/amazon`, never the live site. Each page is gzipped, with scripts and styles stripped and the IP-guessed postcode replaced.
- **The end-to-end test** recreates a `price_tracker_test` database on the dev Postgres. It's skipped when that isn't running.

## Build and run

```bash
pnpm build                      # apps/web/dist, and apps/api/dist (one bundle, dependencies included)
DATABASE_URL=postgres://... node apps/api/dist/main.js
```

The server applies database migrations on start. It finds `apps/web/dist` on its own; `WEB_DIST` overrides that.

**Environment** (see `.env.example`):

- `DATABASE_URL` (required)
- `HOST` (default `127.0.0.1`)
- `PORT` (default 4380)
- `CHECKS_ENABLED`
- `SESSION_KEY`: encrypts saved store sign-ins (`openssl rand -base64 32`). Without it, signing in to stores is off. Changing it makes saved sign-ins unreadable, so you'd have to sign in again.
- `GOTIFY_URL` and `GOTIFY_TOKEN`: if both are set, they create the first notification channel.

## Forgotten password

Run on the server, with the same `DATABASE_URL`:

```bash
price-tracker reset-password                    # asks for the new password
price-tracker reset-password --password-stdin   # or reads it from stdin
```

In development, use `pnpm cli reset-password`. A reset ends every login session but leaves products, listings and history untouched.

## Database changes

Edit `apps/api/src/db/schema.ts`, then run `pnpm db:generate` to write a new migration in `apps/api/drizzle/`.

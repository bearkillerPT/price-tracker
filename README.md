# Price Tracker

Self-hosted price tracking for a few EU web shops. It checks product pages on a schedule and keeps the price history. It sends Gotify notifications when a price drops, hits a target or comes back in stock.

| Store | How it's checked |
|---|---|
| Amazon (.de, .fr, .it, .es, .nl, .com.be, .ie, .se, .pl) | Over HTTP. It works without signing in; signed in, you get your own address and Prime prices. |
| Amazon Business (.de, .fr, .it, .es) | Over HTTP, with a business account's sign-in. The price without VAT counts as it is, since it's the lowest one the page states; the price with VAT shows next to it. |
| Other shops, added from a product link | Over HTTP when the page has standard product data (schema.org). Otherwise you pick the price on the page in a live browser view, and the shop is checked with that selector, over HTTP or in the browser. |

You sign in to Amazon through a live browser view: Chromium runs on the server and is streamed to the web UI. The app keeps the store's cookies, never your password. Each Amazon store needs its own sign-in.

Shops behind Cloudflare-style bot checks (PcComponentes, Worten, PCDiga, Switch Technology) can't be tracked. The app doesn't try to get past those checks.

Stores don't want automated checks, and too many can get your account blocked. Keep check intervals long; the Stores page shows how many requests each store gets per hour.

[DESIGN.md](DESIGN.md) has the decisions behind all this.

## Layout

| Path | What |
|---|---|
| `apps/api` | Express + Drizzle server: API, scheduler, store adapters, live browser, notifications, `price-tracker` CLI |
| `apps/web` | React + Vite + Tailwind + shadcn/ui web app, served by the API in production |
| `packages/shared` | The API contract (zod schemas and response types) and the built-in store list |

## Development

Node 24, pnpm and Chromium come from the Nix dev shell, which uses the same nixpkgs as the Pi. Postgres runs in Docker.

```bash
nix develop            # or prefix commands with `nix develop -c`
pnpm install
pnpm db:up             # Postgres 17 on 127.0.0.1:55432
cp .env.example .env   # CHECKS_ENABLED=false to work on the UI without making store requests
pnpm dev               # API on :4380 (PORT in .env), web on :5173 with /api proxied
```

On the first visit, the app asks you to set a password. There's only one account.

The dev shell sets `PLAYWRIGHT_BROWSERS_PATH` to nixpkgs' Chromium, which `playwright-core` is pinned to. Shop links and the live browser refuse local and private addresses. To try things against a local page, set `ALLOW_PRIVATE_HOSTS=true` in `.env`.

## Tests

```bash
pnpm typecheck
pnpm test
```

- **Parser tests** read saved pages from `apps/api/test/fixtures`, never the live sites. The pages are gzipped, with scripts, styles and personal details stripped.
- **The end-to-end API test** recreates a `price_tracker_test` database on the dev Postgres. It's skipped when that isn't running.
- **Browser tests** run Chromium against local fake shops. They're skipped outside the dev shell.

## Build and run

```bash
pnpm build                      # apps/web/dist, and apps/api/dist (one bundle, dependencies included)
DATABASE_URL=postgres://... node apps/api/dist/main.js
```

The server applies database migrations on start. It serves `apps/web/dist`, or the folder in `WEB_DIST`.

Environment (see `.env.example`):

| Variable | |
|---|---|
| `DATABASE_URL` | Required |
| `HOST`, `PORT` | Default `127.0.0.1:4380` |
| `CHECKS_ENABLED` | `false` stops scheduled checks |
| `SESSION_KEY` | Encrypts saved store sign-ins (`openssl rand -base64 32`). Without it, you can't sign in to stores. If you change it, you have to sign in again. |
| `GOTIFY_URL`, `GOTIFY_TOKEN` | If both are set, they create the first notification channel |
| `PLAYWRIGHT_BROWSERS_PATH` | Where Chromium is, for the live browser and browser checks |
| `ALLOW_PRIVATE_HOSTS` | Development only |

## Deployment

The Raspberry Pi runs it at price-tracker.bearkillerpt.xyz. The NixOS service lives in [raspberryConfs](https://github.com/bearkillerPT/raspberryConfs), in `services/price-tracker.nix`. That file builds this repo and runs it with a local Postgres database, nginx and the Pi's Gotify.

To ship a new commit, run these in raspberryConfs:

```bash
nix flake update price-tracker
nix run .#deploy
```

If `pnpm-lock.yaml` changed, the deploy fails with a hash mismatch for `price-tracker-pnpm-deps`. Copy the `got:` hash into `pnpmDeps.hash` in `services/price-tracker.nix`, then deploy again.

## Forgotten password

Reset it from a terminal on the machine that runs the app. The command depends on how it runs:

| Where | Command |
|---|---|
| A checkout, in development | `pnpm reset-password`, in the repo folder. It reads `DATABASE_URL` from `.env`. |
| The Pi | `sudo -u price-tracker price-tracker reset-password`. `price-tracker` is a command the NixOS service installs on the server; it isn't in this repo. |
| A build (`pnpm build`) | `DATABASE_URL=... node apps/api/dist/cli.js reset-password` |

It asks for the new password twice. Add `--password-stdin` to read it from standard input instead.

A reset signs out every browser. Products, listings and history are kept.

## Database changes

Edit `apps/api/src/db/schema.ts`, then run `pnpm db:generate` to write a new migration in `apps/api/drizzle/`.

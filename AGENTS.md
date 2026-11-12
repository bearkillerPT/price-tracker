# AGENTS.md

Notes for coding agents working in this repo. [README.md](README.md) covers setup. [DESIGN.md](DESIGN.md) records the decisions; read it before changing how checks, sign-ins or stores work.

## Commands

Run these in the Nix dev shell (`nix develop -c <command>`). It provides Node 24, pnpm 11, Postgres tools and Chromium.

| Command | |
|---|---|
| `pnpm install` | |
| `pnpm typecheck` | Every package |
| `pnpm test` | API tests. The end-to-end test needs the dev Postgres (`pnpm db:up`), or it's skipped. |
| `pnpm build` | The web app, then the API bundle |
| `pnpm db:generate` | Writes a migration after a change to `apps/api/src/db/schema.ts` |
| `pnpm dev` | API on :4380 and Vite on :5173 |

Before calling a change done, run `pnpm typecheck` and `pnpm test`.

## Where things are

- `packages/shared/src/api.ts`: the API contract. Request bodies are zod schemas, responses are types, and both apps import them. Change it first.
- `packages/shared/src/stores.ts`: the built-in stores, their marketplaces and rate groups.
- `apps/api/src`:
  - `routes/`: one Express router per area.
  - `stores/`: one adapter per store (`amazon/`, `generic/` for schema.org and picked selectors), plus:
    - `preview.ts`: the one-request preview when adding a listing.
    - `sessions.ts`: store sign-ins.
    - `protection.ts`: bot-check detection.
    - `private-hosts.ts`
    - `icons.ts`: store favicons, learned once from a page a check loaded.
  - `checks/`:
    - `scheduler.ts`: one loop per rate group.
    - `run-check.ts`: one check and its outcome (observation, backoff, alerts).
  - `browser/`:
    - `manager.ts`: Chromium.
    - `live.ts` and `socket.ts`: the live browser streamed over a WebSocket.
    - `picker-script.ts`: price picking.
  - `db/schema.ts`: the database. Migrations are in `apps/api/drizzle/`.
  - `auth/`: the single app account and its sessions. `secret-box.ts` encrypts saved store sign-ins.
- `apps/web/src`:
  - `pages/` and `components/`. `components/ui/` holds the shadcn components.
  - Shared pieces:
    - `store-icon.tsx`: a store's icon and name.
    - `request-budget.tsx`: requests per hour and risk per store group.
    - `product-actions.tsx`: the product menu.
  - `hooks/queries.ts`: TanStack Query hooks.

## Rules

- **Don't get past bot protection.** No stealth plugins, no hiding webdriver or faking fingerprints, no user-agent or header spoofing, no captcha solvers, no imitating another client. A shop that challenges the server gets reported as blocked, and that's the end of it.
- **Keep store requests low.** Accounts can get banned.
  - Scheduled requests go through the scheduler's rate groups.
  - Anything else is one request the user triggered, like a preview.
  - Don't add retries that multiply requests.
  - When a store's fetch method is `browser`, don't send it plain HTTP requests.
- **Tests never hit live sites.** Use saved pages in `apps/api/test/fixtures`, or local fake shops.
  - Save fixtures gzipped.
  - Strip scripts, styles, names, addresses and postcodes from them.
- **Never store store passwords.** A sign-in keeps the browser's cookies and storage, encrypted with `SESSION_KEY`.
- **Private addresses stay blocked**, for shop links and in Chromium. Only `ALLOW_PRIVATE_HOSTS` (tests, development) lifts that.
- **Migrations:** never edit one that's been applied. Change the schema and generate a new one.
- **Pinned to nixpkgs:**
  - `playwright-core` is pinned to the version of nixpkgs' `playwright-driver` (1.59.1 in nixos-26.05), whose Chromium it runs. Bump it only when the nixpkgs input moves.
  - The dev shell and the Pi use the same nixpkgs.
- **Dependencies:** pnpm 11 only runs install scripts for packages listed under `allowBuilds` in `pnpm-workspace.yaml`. Any change to `pnpm-lock.yaml` changes the dependency hash the Pi build needs; see Deployment.

## Gotchas

- **Express 5:** `app.listen` passes bind errors to its callback; they don't throw.
- **pg:** the pool needs its `error` handler, or a Postgres restart kills the app.
- **Chromium and long TMPDIRs:** a TMPDIR longer than 40 characters (nested `nix develop` shells) makes Chromium crash on start. `chromiumTmpDir()` in `browser/manager.ts` handles that.
- **Amazon's navigation bar:**
  - The account link sits inside `div#nav-link-accountList`.
  - Amazon Business's link carries `data-nav-role="signin"` even when you're signed in, so where it points is what tells.
  - Each Amazon marketplace needs its own sign-in; they don't carry over.

## Deployment

The Raspberry Pi runs the app. Its NixOS service is `services/price-tracker.nix` in raspberryConfs (`~/dev/personal/raspberryConfs`). That file builds this repo from GitHub, so a deploy only picks up pushed commits:

```bash
nix flake update price-tracker
nix run .#deploy
```

When `pnpm-lock.yaml` changed, update `pnpmDeps.hash` in that file. The first build fails with a hash mismatch; copy its `got:` value.

# CardLens

**Search Pokémon cards and see live market pricing — on Meta Ray-Ban Display glasses.**

CardLens is a production-quality MVP Web App for the **Meta Ray-Ban Display** "Web Apps" platform
(Developer Preview). You search for a Pokémon card, pick the exact set and printing, and see current
market pricing — all navigable with the glasses' Neural Band / captouch gestures. It runs and is
fully testable in a normal desktop browser on **Windows**, and deploys to a secure **HTTPS** URL you
can add to your glasses.

It uses **no camera, OCR, image recognition, or native code** — display, navigation, selection,
networking, and local storage only.

> Built after reviewing the official Meta Wearables **Web Apps** documentation and the
> **pokemontcg.io** data API. Platform findings and citations: [`docs/meta-web-app.md`](docs/meta-web-app.md).
> Design rationale: [`PLAN.md`](PLAN.md).

---

## Why this design (the two facts that shaped everything)

1. **Meta glasses input == standard keyboard events.** The glasses OS turns swipes into
   `ArrowUp/Down/Left/Right`, index-finger pinch into `Enter`, and middle-finger pinch into
   `Escape`. There is **no custom gesture API and no JS SDK** — so the exact same input model works
   on the glasses and on a Windows keyboard. We invent no Meta APIs.
2. **The glasses have no keyboard** (text input is officially unsupported). So CardLens is fully
   usable with **zero typing**: recent searches, favorites, popular Pokémon, and a **companion-phone**
   text bridge. Typing is available only where a real keyboard exists (desktop/phone).

The display is a fixed **600×600** additive screen (black renders transparent) — CardLens uses a
pure-black background with bright, high-contrast text and never scrolls.

---

## Quick start (Windows)

Requirements: **Node 20+** (tested on Node 24), npm.

```powershell
git clone <this-repo> cardlens
cd cardlens
npm install
copy .env.example .env      # optional; sensible defaults work out of the box

# Run the web app + companion/proxy server together:
npm run dev:all
# Web app:   http://localhost:5173
# API server: http://localhost:8787
```

Open http://localhost:5173. On a desktop viewport you get a **glasses preview frame** with a
**Developer Panel** (simulated Neural Band buttons, network/state toggles, storage reset, input log)
so you can drive the whole app without the glasses.

Control it with the keyboard (this is exactly what the glasses send):

| Key   | Gesture             | Action        |
| ----- | ------------------- | ------------- |
| ↑ / ↓ | swipe up/down       | move focus    |
| ← / → | swipe left/right    | secondary nav |
| Enter | index-finger pinch  | select        |
| Esc   | middle-finger pinch | back / cancel |

Prefer running the two processes separately? `npm run dev` (web) and `npm run server` (API) in two
terminals. Force mock data with `VITE_USE_MOCKS=true` (no network needed).

---

## Scripts

| Script                                          | What it does                                                 |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                                   | Vite dev server (web app)                                    |
| `npm run server`                                | Companion + optional proxy server (tsx watch)                |
| `npm run dev:all`                               | Both of the above together                                   |
| `npm run build`                                 | Typecheck + production build to `dist/`                      |
| `npm run preview`                               | Serve the production build locally                           |
| `npm run typecheck`                             | `tsc -b` project typecheck                                   |
| `npm run lint` / `lint:fix`                     | ESLint                                                       |
| `npm run format` / `format:check`               | Prettier                                                     |
| `npm run test` / `test:watch` / `test:coverage` | Vitest unit/integration tests                                |
| `npm run e2e`                                   | Playwright end-to-end flows (auto-starts servers with mocks) |
| `npm run verify`                                | typecheck + lint + unit tests                                |

First Playwright run: `npm run e2e:install` (downloads Chromium).

---

## Features

- Search Pokémon cards by name, with `Charizard ex`, `Pikachu 025`, `Charizard 4/102` style queries.
- Result ranking: exact name → starts-with → collector number → set name → fuzzy → recency.
- Card details: set, collector number, rarity, artist, release date, **finish-labeled** market/low/mid
  pricing with **source** and **updated** time. Absent prices show **Unavailable**, never `$0.00`.
- **Favorites**, **recent searches** (reopen without retyping), and **recently viewed** cards, all in
  versioned local storage with sane caps.
- **Companion-phone input** at `/input/:code` for typing without a keyboard on the glasses.
- Cached-first rendering with stale markers; request debounce/cancel/timeout/retry.
- Multi-game architecture (Pokémon implemented; others documented, not built).

---

## Architecture

```
React SPA (Vite static build, HTTPS)
  app/          screen state machine + providers (QueryClient, input, catalog, library, text-entry)
  integrations/
    meta/       WearableInputAdapter -> Meta/Keyboard/Mock (keyboard-event based)
    pokemon/    CardCatalogProvider  -> PokemonTcgIo + Mock (+ Zod validation, ranking)
    pricing/    normalize tcgplayer  -> CardPriceResult
  services/     search (debounce/cancel/rank), text-input providers, companion client, http
  storage/      versioned localStorage: favorites, recents, viewed, card/price caches
  features/     home · results · card-details · favorites · recent · popular
  components/   GlassesFrame preview · DevPanel · FocusList · PriceBlock · states
  pages/        /input/:code (companion) · /privacy
        │ HTTPS (companion relay + optional API proxy only)
        ▼
server/  Express: short-poll session relay + optional pokemontcg.io proxy (server-side key + cache)
```

Platform-specific input, data sources, and text entry are each hidden behind an interface so the UI
stays portable and unit-testable. Details: [`docs/architecture.md`](docs/architecture.md).

**Data & backend.** The catalog + pricing API (`api.pokemontcg.io/v2`) is keyless and open-CORS, so
the core app needs **no backend** and ships as static files. The `server/` exists only for the
companion relay (shared session state) and an **optional** proxy that attaches a server-side API key
plus caching — **no API secret is ever shipped to the browser**. See
[`docs/pokemon-provider.md`](docs/pokemon-provider.md) and [`docs/pricing.md`](docs/pricing.md).

---

## Environment variables

Copy [`.env.example`](.env.example) to `.env`. Frontend vars (`VITE_*`) are public; secrets live only
in the server vars.

| Var                             | Scope  | Purpose                                                                                               |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`             | web    | Catalog/pricing base. Default `https://api.pokemontcg.io/v2`; set to `/api/catalog` to use the proxy. |
| `VITE_COMPANION_API_BASE_URL`   | web    | Companion relay base (default `/api`; use the server's absolute URL in prod).                         |
| `VITE_USE_MOCKS`                | web    | `true` = deterministic mock data, no network.                                                         |
| `VITE_ENABLE_DEV_PANEL`         | web    | `false` hides the dev panel in production.                                                            |
| `POKEMONTCG_API_KEY`            | server | Optional key (kept server-side; lifts limits to 20k/day).                                             |
| `ALLOWED_ORIGINS`               | server | Comma-separated CORS allowlist.                                                                       |
| `COMPANION_SESSION_TTL_SECONDS` | server | Session lifetime (default 300).                                                                       |

---

## Testing

- **Unit / integration (Vitest + Testing Library):** search normalization, ranking, pricing
  normalization (incl. finish-specific + empty), cache expiration, storage migration, focus
  movement, input events, navigation reducer, API-response validation, companion-session expiry,
  and search loading/failure/empty states. `npm run test`
- **End-to-end (Playwright):** search Charizard → select → view price → favorite → reopen; recent
  search reopen; popular (no-typing) search; keyboard-only navigation; failed-request handling with
  retry; and the companion-phone input relay. `npm run e2e`

All flows run at the true **600×600** glasses viewport.

---

## Deploy

CardLens = a **static frontend** (any HTTPS static host) + a small **Node server** (for the
companion relay / optional proxy).

### Frontend — Vercel / Netlify / Cloudflare Pages

Config is included: [`vercel.json`](vercel.json), [`netlify.toml`](netlify.toml),
[`public/_redirects`](public/_redirects) (SPA fallback so `/input/:code` and `/privacy` resolve),
plus a strict Content-Security-Policy and secure headers.

- **Vercel:** import the repo → build `npm run build`, output `dist` → deploy. HTTPS is automatic.
- **Netlify:** connect repo (settings are read from `netlify.toml`).
- **Cloudflare Pages:** build `npm run build`, output `dist` (uses `public/_redirects`).

Set `VITE_COMPANION_API_BASE_URL` to your server's HTTPS origin (below). Add that origin to the CSP
`connect-src` in `vercel.json`/`netlify.toml` if you use the companion feature.

### Server — Render (or any Node host)

[`render.yaml`](render.yaml) is a ready blueprint: start command `npm run server:start`, health check
`/api/health`. Set `ALLOWED_ORIGINS` to your frontend origin and (optionally) `POKEMONTCG_API_KEY`.

_(The core search + pricing works without the server. Deploy it only for the companion feature or a
server-side API key.)_

---

## Add CardLens to your Meta Ray-Ban Display glasses

Requires the Meta AI app **v272+** and glasses software **v125+**. Verify labels against the current
[Meta Web Apps setup/test docs](https://wearables.developer.meta.com/docs/develop/webapps/) — this is
a Developer Preview and menus can shift.

1. **Enable Developer Mode:** Meta AI app → **Settings → App Info** → tap the **App version number 5
   times** → **Enable**.
2. Deploy CardLens and copy the hosted **HTTPS** URL (HTTP is rejected by the glasses).
3. In the Meta AI app: **App Settings → App Connections → Web Apps → Add a Web App**.
4. Enter a name and the URL → **Connect**.
5. Launch CardLens from the glasses app grid.
6. While it runs, a **middle-finger pinch** opens the universal Web App menu (restart / resume /
   permissions).

On the glasses the app renders the raw 600×600 surface (no preview frame, no dev panel).

---

## Definition of done

- ✅ Runs in a Windows desktop browser and in a 600×600 wearable-sized preview.
- ✅ Entire app controllable with arrow keys + Enter + Escape (and simulated Neural Band buttons).
- ✅ Search a Pokémon card, choose an exact set + collector number, view normalized market pricing.
- ✅ Save and reopen favorites; recent searches retained locally.
- ✅ Meta input adapter uses only documented APIs (keyboard events) — no invented SDK.
- ✅ Deployable to an HTTPS URL and addable via Meta Developer Mode.
- ✅ `npm run verify` (typecheck + lint + unit) and `npm run e2e` pass; no API secrets committed.

## Known uncertainties (Developer Preview)

- Whether the glasses runtime allows cross-origin `fetch` to `api.pokemontcg.io` is **not documented**
  — verify on-device. If blocked, point `VITE_API_BASE_URL` at the `server/` proxy (same origin).
- Exact Chromium/WebView feature level and any runtime-imposed CSP are undocumented.
- pokemontcg.io is transitioning to **Scrydex**; the provider is isolated so a migration touches one
  file.

See [`docs/`](docs) for the full write-ups, and [`docs/privacy.md`](docs/privacy.md) for privacy.

---

_CardLens is an independent project and is not affiliated with, endorsed by, or sponsored by
Nintendo, The Pokémon Company, TCGplayer, or Meta._

# CardLens — Implementation Plan

CardLens is a Pokémon card **search + pricing** Web App built for **Meta Ray-Ban Display**
glasses (Developer Preview), and fully runnable/testable in a normal desktop browser on Windows.

This document records the platform research that drove the design, the decisions taken, and the
build sequence. It is the source of truth for _why_ the code looks the way it does.

---

## 1. Platform research findings (Meta Ray-Ban Display Web Apps)

Verified against official Meta sources (`wearables.developer.meta.com/docs/develop/webapps/*`,
`developers.meta.com/wearables/faq/`, `github.com/facebookincubator/meta-wearables-webapp`).
Full write-up and citations live in [`docs/meta-web-app.md`](docs/meta-web-app.md).

The findings that shaped the architecture:

| Area           | Finding                                                                                                                                                                                                                                              | Consequence for CardLens                                                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform       | Official "**Web Apps**" path exists, **Developer Preview**. Standard HTML/CSS/JS served over HTTPS, rendered on the glasses display. Cannot yet publish to end users.                                                                                | Ship a static hosted web app over HTTPS. Treat everything as preview-grade.                                                                                                                                                                                                    |
| Input          | Glasses OS translates Neural Band + captouch gestures into **standard DOM keyboard events**: swipes → `ArrowUp/Down/Left/Right`, index-finger pinch → `Enter`, middle-finger pinch → `Escape`. **No custom gesture API, no JS SDK, no npm package.** | The Meta input adapter is a **keyboard-event adapter**. This is _identical_ to the desktop dev mapping — so the same navigation model works on glasses and on Windows. We invent nothing.                                                                                      |
| Text input     | **Not supported** on glasses (officially on the "not yet supported" list, along with camera, mic, notifications, offline, back-nav, continuous cursor).                                                                                              | The app must be fully usable with **zero free-text entry**: recent searches, favorites, popular Pokémon, alphabetical browse, and a **companion-phone** text bridge. `requestInput()` on-glasses returns "unsupported"; desktop uses a prompt; phone uses the companion relay. |
| Display        | Fixed **600×600 px** viewport, **no scrolling**, additive display (**black renders transparent**; use bright, high-contrast colors on black).                                                                                                        | Design tokens use a pure-black background and bright foreground. Every screen fits 600×600 with in-app vertical paging instead of scroll.                                                                                                                                      |
| Storage        | `localStorage` / `sessionStorage` supported (~5 MB).                                                                                                                                                                                                 | Favorites, recents, and caches use versioned `localStorage`.                                                                                                                                                                                                                   |
| Sensors / GPS  | `DeviceMotion`/`DeviceOrientation` and phone `navigator.geolocation` available.                                                                                                                                                                      | Not needed by this MVP; noted for future.                                                                                                                                                                                                                                      |
| Networking     | `fetch`/XHR/WebSocket to third-party origins is **not explicitly documented** for the glasses runtime.                                                                                                                                               | Marked **UNCERTAIN**. The app is built to degrade gracefully (cached-first, clear network-error state) and can be pointed at either the public API or our own same-origin proxy. Documented as a risk to verify on-device.                                                     |
| Add to glasses | Meta AI app → enable Developer Mode (tap App version 5×; needs Meta AI v272+, glasses v125+) → **App Settings → App Connections → Web Apps → Add a Web App** → enter HTTPS URL → **Connect**.                                                        | README documents this exact flow.                                                                                                                                                                                                                                              |

**Starter kit note.** The official starter (`facebookincubator/meta-wearables-webapp`) is a
_vanilla_ HTML/CSS/JS AI-coding plugin, not an npm library. The product spec explicitly permits
React, and the glasses render any standard static HTML/CSS/JS. We therefore build with
**Vite + React + TypeScript** (per the spec's stack) and ensure the production build is a lean
static bundle that satisfies the glasses runtime. We honor the starter kit's _principles_
(D-pad focus model, `.focusable` navigation, black additive background, 600×600) rather than its
file layout.

---

## 2. Pokémon data + pricing decision

Full write-up: [`docs/pokemon-provider.md`](docs/pokemon-provider.md) and
[`docs/pricing.md`](docs/pricing.md).

- **Primary API: `https://api.pokemontcg.io/v2`.** No API key required to start (optional free key
  lifts limits to 20k/day). Returns card metadata + images + **embedded TCGplayer & Cardmarket
  pricing** in one response. Sends `Access-Control-Allow-Origin: *`, verified live — so the browser
  can call it **directly with no proxy**.
- **Pricing field paths (exact, verified live):**
  `tcgplayer.prices.<finish>.{low,mid,high,market,directLow}` where `<finish>` ∈
  `normal | holofoil | reverseHolofoil | 1stEdition | 1stEditionHolofoil | unlimited | …`, plus a
  per-object `updatedAt` string (`YYYY/MM/DD`). Cardmarket is a flat EUR object. We normalize
  TCGplayer USD raw pricing for the MVP and label each finish explicitly.
- **Backup provider: TCGdex** (`api.tcgdex.net`, keyless, MIT data, multilingual, now has pricing).
  Modeled behind the same interface for future use; not wired into the MVP UI.
- **Terms:** pokemontcg.io is a donation-funded fan project (not affiliated with
  Nintendo/TPCi); no published commercial-use prohibition. We display the pricing **source** and
  **`updatedAt`** freshness and never present listings as completed sales.

### Backend decision

The core catalog + pricing need **no backend** (open CORS, no secret). We ship the app as static.
A small backend is used **only** for two optional concerns, isolated from the core flow:

1. **Companion-phone text bridge** — needs short-lived server-side session state (a browser can't
   relay to another device by itself).
2. **Optional API proxy** — lets us attach a server-side `POKEMONTCG_API_KEY`, central caching, and
   rate limiting _without_ exposing the key in the browser. The frontend works with or without it
   via `VITE_API_BASE_URL`.

Chosen implementation: a tiny **Node + Express** service in [`server/`] using an **in-memory,
TTL-expiring session store** and **short polling** (simplest reliable option; SSE/WebSocket on
stateless serverless needs external KV, which is overkill for an MVP). It runs on Windows for dev +
Playwright and deploys to Render/Fly/any Node host. Static frontend deploys to
Vercel/Netlify/Cloudflare Pages. No secret is ever shipped to the browser.

---

## 3. Architecture overview

```
Meta Ray-Ban Display (600×600, keyboard events)   Desktop dev browser (arrow keys)   iPhone (companion)
                 \                                        |                              /
                  \                                       |                             /
                   ▼                                      ▼                            ▼
                         React SPA  (Vite static build, HTTPS)
   app/            screen state machine + providers (QueryClient, adapters, navigation)
   integrations/
     meta/         WearableInputAdapter  → Meta/Keyboard/Mock adapters (keyboard-event based)
     pokemon/      CardCatalogProvider   → PokemonTcgIo + Mock providers (+ Zod validation, ranking)
     pricing/      CardPricingProvider   → normalize tcgplayer/cardmarket → CardPriceResult
   services/       search (debounce/cancel/rank), text-input providers, cache
   storage/        versioned localStorage: favorites, recents, viewed, card/price caches, prefs
   features/       home · search · results · card-details · favorites · recent
   components/     GlassesFrame preview · DevPanel · FocusList · Price · Loading/Error/Empty
   pages/          /input/:sessionCode (companion) · /privacy
                                        |
                                        | HTTPS (companion + optional proxy only)
                                        ▼
                         server/  Express: session relay (short-poll) + optional /api proxy+cache
```

Key seams (so platform code never leaks into UI):

- `WearableInputAdapter.subscribe(listener)` emits a normalized `WearableInputEvent`
  (`SWIPE_*` / `SELECT` / `BACK`). UI components consume events, never raw `keydown`.
- `CardCatalogProvider` / `CardPricingProvider` abstract the data source; UI uses TanStack Query
  hooks over them.
- `TextInputProvider.requestInput()` abstracts _how_ text arrives (unsupported on glasses → browser
  prompt on desktop → companion phone). UI asks for text without knowing the mechanism.
- `TradingCardGameProvider` models multi-game; only the Pokémon provider is implemented.

---

## 4. Interaction & focus model

One active screen at a time; a screen owns a **focus ring** of `.focusable` items.

| Gesture (glasses)  | DOM key                    | Event              | Action                              |
| ------------------ | -------------------------- | ------------------ | ----------------------------------- |
| Swipe up / down    | `ArrowUp` / `ArrowDown`    | `SWIPE_UP/DOWN`    | move focus within the vertical list |
| Swipe left / right | `ArrowLeft` / `ArrowRight` | `SWIPE_LEFT/RIGHT` | page / secondary nav                |
| Index pinch        | `Enter`                    | `SELECT`           | activate focused item               |
| Middle pinch       | `Escape`                   | `BACK`             | pop screen / cancel                 |

Every focusable renders a visible focus state (never color-only, never hover). No pointer required.

---

## 5. Build sequence (this repo)

1. ✅ Inspect repo + toolchain (Windows, Node 24, npm 11).
2. ✅ Research Meta Web Apps + Pokémon APIs (parallel agents) → this PLAN + `docs/`.
3. Scaffold: package.json, tsconfig, vite, vitest, playwright, eslint, prettier, CI, env.
4. Models + Zod schemas + design tokens/global CSS.
5. Storage layer (versioned, migration-safe) + caches.
6. Meta input adapters (Meta/Keyboard/Mock) + `useWearableInput` + navigation state machine.
7. GlassesFrame preview + DevPanel (Windows-only testing surface).
8. Pokémon provider (mock first, then real) + search normalization/ranking + Zod validation.
9. Pricing normalization.
10. Screens: home → search → results → details → favorites → recent.
11. Text-entry providers + companion-phone fallback (client) + `server/` relay.
12. Caching (price 15–60 min, metadata 7 days), stale markers.
13. Unit tests (Vitest) + Playwright flows.
14. Deployment config (Vercel/Netlify/Cloudflare Pages + server host) + `.env.example`.
15. Run typecheck, lint, unit tests, Playwright. Fix failures.
16. Finalize README with exact commands + Meta add-to-glasses steps.

---

## 6. Explicitly out of scope (documented, not built)

- Camera / OCR / scanning / image recognition (spec forbids; glasses camera unsupported for web).
- Native iOS/Android code.
- Games other than Pokémon (architecture only — see
  [`docs/adding-new-games.md`](docs/adding-new-games.md)).
- Graded/Japanese/completed-sales pricing (raw English market only for MVP).
- Publishing to end users (not available in Developer Preview).

## 7. Known uncertainties (verify on-device)

- Whether the glasses runtime permits cross-origin `fetch` to `api.pokemontcg.io`. If blocked, flip
  `VITE_API_BASE_URL` to the same-origin proxy in `server/`.
- Exact Chromium/WebView feature level and any CSP the runtime imposes.
- Real-world localStorage headroom and DeviceOrientation permission behavior.

These are surfaced in the UI as graceful cached-first + network-error states, and in the README.

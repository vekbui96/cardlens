# Spec: Foundation

**Phase 0. Nothing else starts until this lands.** One owner.

## Status: built

The shell, tokens, primitives, routing, workshop, fixtures, the toggle, and the
e2e harness are all in. **Phase 1 may start.**

One item was deliberately deferred and moved out of Phase 0 — lifting
presentation helpers out of `models/`. It blocks nothing, and doing it now would
put a shared-module refactor directly under nine branching streams. The
reasoning is with that item at the end of this file.

What a stream should know before it starts:

| Command / URL                              | What it gives you, or protects                  |
| ------------------------------------------ | ----------------------------------------------- |
| `npm run check:v2`                         | No raw colours or lengths outside `tokens.css`  |
| `npm run build` (its `postbuild`)          | v2 stays out of the entry bundle a v1 user gets |
| `npx playwright test --project=v2-desktop` | v2 specs at 1440                                |
| `npx playwright test --project=v2-phone`   | v2 specs at 390                                 |
| `npm run snapshots`                        | Re-baseline visuals for this platform           |
| `npm run snapshots:linux`                  | Re-baseline the ones CI gates (needs Docker)    |
| `?v=2`                                     | Pin the version, whatever is stored             |
| `?seed=binders`                            | Real data, written through real storage         |
| `#/dev/workshop`                           | Every primitive, in every state                 |

## Purpose

Give every later stream a shell to render into, a vocabulary to build from, and
data to build against — so that nine screens built by different people at the
same time come out looking like one app, and none of them has to invent a card
tile, a page grid, or a way to get a binder with cards in it onto the screen.

## Parity checklist

The foundation has no user-facing parity of its own except these, which v1 does
and v2 must not lose:

- [x] `#/…` routes round-trip identically (`src/app/screenUrl.ts`) — a pasted
      link opens the same screen in either version.
- [x] Back behaves as a stack, not as browser history alone.
- [x] The glasses and preview shells are untouched and still render v1.
- [x] An uncaught render error shows the error screen rather than a white page
      (`src/app/ErrorBoundary.tsx`), in v2 too.
- [x] Sync status, and its three distinct messages (`bad-token`, `disabled`,
      generic), are reachable from the v2 shell.

## Deliverables

### 1. `src/app/uiVersion.ts`

Resolves `v1 | v2` from `?v=` → localStorage → default `v1`. Pure, tested.
Only consulted when `layoutMode === "web"`.

### 2. The switch

A control in both shells that flips the stored version and reloads. It must be
reachable from v2 even if every v2 screen below it is broken — so it lives in
the v2 shell header, not inside a screen.

### 3. `src/v2/tokens.css`

Colour, space, radius, type, and the card geometry (`--v2-card-aspect: 5/7`,
`--v2-pocket`). Scoped to `[data-ui="v2"]`. **The only place a raw value is
allowed.** Add the lint rule that enforces it — a convention nobody can check is
a convention that decays.

### 4. `src/v2/primitives/`

`Stack`, `Row`, `Grid`, `Panel`, `Card`, `Rail`, `Sheet`, `CardArt`, `Meter`,
`Chip`, `Money`. Each with a workshop entry showing every state.

`CardArt` matters more than it looks: v1 has three ways to draw a card and one
of them hard-codes 54x76, which produced 54px of art inside a 380px pocket and
again inside a 92px picker tile. v2 has exactly one, and it is sized by its
container.

### 5. `src/v2/shell/`

Header, navigation, the screen frame, the error boundary, and the responsive
rules. **The shell owns width**; screens never set their own page margins.

### 6. `src/dev/fixtures.ts`

Named fixtures loaded with `?seed=<name>`, dev/e2e only, refusing to run in a
production build. At minimum: `empty`, `collection`, `binders`, `trade`, `scan`.

Each writes through the real repositories (`src/storage/`), never by poking
localStorage directly, so a fixture cannot drift from what the app can actually
store — and a fixture that fails to save is a bug in storage worth knowing about.

### 7. `#/dev/workshop`

Every primitive, every state, against fixtures. A v2 route, lazily loaded, not a
new dependency.

### 8. `e2e/v2/pages/`

Page objects exposing intent. Plus the visual-regression harness: one
`toHaveScreenshot()` per primitive group and per screen, at 390 and 1440.

Baselines are committed for **both Linux and Windows**, because Playwright keys
a snapshot to the platform that took it and the two genuinely differ (font
rasterisation, scrollbar width). CI runs Linux, so Linux is the set that gates
anything — but a Windows-only baseline would mean every visual change passes
locally and fails in CI. Regenerate both together: `npm run snapshots` and
`npm run snapshots:linux` (the latter uses the official Playwright Docker image
pinned to this repo's version, so it produces exactly what CI compares against).

## Data

None of its own. It provides the providers (React Query, Library, Navigation)
and must place them so **v1 and v2 never mount two copies** — a second
QueryClient means two caches, two sets of requests, and a sync that races
itself.

## States

| State                 | What shows                                                                             |
| --------------------- | -------------------------------------------------------------------------------------- |
| Loading a lazy screen | The shell, with a skeleton in the content area — never a bare spinner on an empty page |
| Screen threw          | Error panel inside the shell, with the version switch still reachable                  |
| Route unknown         | Home, and the URL corrected                                                            |
| Offline               | Shell renders; screens say what they cannot reach                                      |

## Layout

390px: single column, header, content, no rails.
1440px+: the shell takes the window (v1's 1180px cap is gone — see
`GlassesFrame.module.css`); content max-width is per screen, not global.

## Interactions

Keyboard reachable throughout: skip link, focus-visible rings from tokens, no
focus trap outside dialogs. The glasses' four-gesture focus ring does **not**
apply — it is off on web in v1 for the same reason (it preventDefaults arrows
and fights native scrolling).

## Acceptance

- [x] `?v=2` renders the v2 shell; `?v=1` and no flag render v1.
- [x] A square 600x600 viewport renders v1 whatever `?v=` says.
- [x] The v2 chunk is absent from the entry bundle for a v1 user (assert on the
      built `dist/` output, not by eye).
- [x] `[data-shell="web"]` rules from `web-theme.css` do not apply inside
      `[data-ui="v2"]` — asserted by a test, like `e2e/shell-isolation.spec.ts`
      does for the glasses.
- [x] `?seed=binders` produces a binder with cards, in both versions, and does
      nothing in a production build.
- [x] Switching version keeps the current `#/` route.
- [x] Exactly one QueryClient exists at runtime.
- [x] `#/dev/workshop` renders every primitive with no console errors.

## Also owned by this stream (found in review — see PLAN §1, §7)

These are not optional extras; each one blocks or silently breaks screens.

- [x] **Gate the wearable input adapter on `layoutMode !== "web"`.**
      `KeyboardBackedInputAdapter` preventDefaults arrows/Enter/Escape at the
      document, and `InputProvider` installs it in web mode too. Every v2 screen
      with a field, a `<select>` or a modal fights it. Done at the source rather
      than the call site: `createInputAdapter` takes `{ wearable }` and
      `App.tsx` passes `false` for v2, so a v2 screen cannot reintroduce it by
      forgetting a flag. v1 is untouched. Covered by
      `integrations/meta/inputGating.test.ts`, and by an e2e that dispatches a
      real ArrowDown and asserts nothing called `preventDefault`.
- [x] **Neutralise `global.css` for v2**: `body`/`#root` centring, the global
      `:focus { outline: none }`, and the bare `.sr-only`. Without breaking the
      glasses. Done in `src/v2/shell/reset.css`, anchored on
      `html[data-ui="v2"]` — an attribute only `V2App` sets, so the cascade
      cannot reach the glasses rather than us remembering not to send it.
- [x] **Define v2's own `--cl-viewport` equivalent.** 2 CSS modules read v1's,
      set on `.webSurface`; a v2 shell that does not render `GlassesFrame` loses
      it silently.
- [x] **Adopt `src/utils/`**: `format.ts` (money, `"Unavailable"`, relative
      time, collector numbers) and `image.ts` (`optimizedImageUrl`). One home,
      or ten streams disagree about how to render a dollar. `Money` and
      `CardArt` are the only things in v2 that format a price or build an image
      URL, and both call these — so a screen never touches either directly.
- [ ] **Lift presentation out of `models/`**: chart geometry in `history.ts`,
      labels in `ownedSort.ts` / `finishes.ts` / `target.ts`, formatting in
      `movement.ts`, the 0–1 bar width in `setCompletion.ts`. And the upward
      imports in `hooks/useSetView.ts` and `hooks/useCollectedSets.ts`.
      **Deliberately not done — see below.**
- [x] **Add `e2e/v2/**` to the Playwright projects' `testMatch` once**, so no
      stream has to edit that shared file, and no v2 spec accidentally runs at
      the 600×600 glasses viewport. Done as two new projects, `v2-phone` and
      `v2-desktop`, matching anything under `e2e/v2/`; the 600×600 `chromium`
      project now explicitly ignores that directory.

### Why the `models/` refactor was dropped from Phase 0

It was misfiled. Everything else on the list above either blocks a screen or
breaks one silently. This does not: a v2 screen can import `graphGeometry` from
where it already lives, and nothing in these helpers is v1-specific enough to be
wrong in v2.

What it would cost is real. It edits shared modules covered by ~900 tests, at
the exact moment nine streams start branching off them — so every stream would
rebase through a refactor none of them needed, for a tidiness gain none of them
asked for. That is the opposite of what Phase 0 is for.

It is still worth doing: after the streams land, or alongside whichever one
first genuinely needs one of these helpers and can prove the move against a real
call site.

## Out of scope

Any screen. The foundation proves itself through the workshop and the fixtures,
not by building Home.

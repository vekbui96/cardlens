# Spec: Foundation

**Phase 0. Nothing else starts until this lands.** One owner.

## Purpose

Give every later stream a shell to render into, a vocabulary to build from, and
data to build against — so that nine screens built by different people at the
same time come out looking like one app, and none of them has to invent a card
tile, a page grid, or a way to get a binder with cards in it onto the screen.

## Parity checklist

The foundation has no user-facing parity of its own except these, which v1 does
and v2 must not lose:

- [ ] `#/…` routes round-trip identically (`src/app/screenUrl.ts`) — a pasted
      link opens the same screen in either version.
- [ ] Back behaves as a stack, not as browser history alone.
- [ ] The glasses and preview shells are untouched and still render v1.
- [ ] An uncaught render error shows the error screen rather than a white page
      (`src/app/ErrorBoundary.tsx`), in v2 too.
- [ ] Sync status, and its three distinct messages (`bad-token`, `disabled`,
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

### 6. `src/dev/fixtures/`

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

- [ ] `?v=2` renders the v2 shell; `?v=1` and no flag render v1.
- [ ] A square 600x600 viewport renders v1 whatever `?v=` says.
- [ ] The v2 chunk is absent from the entry bundle for a v1 user (assert on the
      built `dist/` output, not by eye).
- [ ] `[data-shell="web"]` rules from `web-theme.css` do not apply inside
      `[data-ui="v2"]` — asserted by a test, like `e2e/shell-isolation.spec.ts`
      does for the glasses.
- [ ] `?seed=binders` produces a binder with cards, in both versions, and does
      nothing in a production build.
- [ ] Switching version keeps the current `#/` route.
- [ ] Exactly one QueryClient exists at runtime.
- [ ] `#/dev/workshop` renders every primitive with no console errors.

## Also owned by this stream (found in review — see PLAN §1, §7)

These are not optional extras; each one blocks or silently breaks screens.

- [ ] **Gate the wearable input adapter on `layoutMode !== "web"`.**
      `KeyboardBackedInputAdapter` preventDefaults arrows/Enter/Escape at the
      document, and `InputProvider` installs it in web mode too. Every v2 screen
      with a field, a `<select>` or a modal fights it.
- [ ] **Neutralise `global.css` for v2**: `body`/`#root` centring, the global
      `:focus { outline: none }`, and the bare `.sr-only`. Without breaking the
      glasses.
- [ ] **Define v2's own `--cl-viewport` equivalent.** 43 CSS modules read v1's,
      set on `.webSurface`; a v2 shell that does not render `GlassesFrame` loses
      it silently.
- [ ] **Adopt `src/utils/`**: `format.ts` (money, `"Unavailable"`, relative
      time, collector numbers) and `image.ts` (`optimizedImageUrl`). One home,
      or ten streams disagree about how to render a dollar.
- [ ] **Lift presentation out of `models/`**: chart geometry in `history.ts`,
      labels in `ownedSort.ts` / `finishes.ts` / `target.ts`, formatting in
      `movement.ts`, the 0–1 bar width in `setCompletion.ts`. And the upward
      imports in `hooks/useSetView.ts` and `hooks/useCollectedSets.ts`.
- [ ] **Add `e2e/v2/**` to the Playwright projects' `testMatch` once**, so no
      stream has to edit that shared file, and no v2 spec accidentally runs at
      the 600×600 glasses viewport.

## Out of scope

Any screen. The foundation proves itself through the workshop and the fixtures,
not by building Home.

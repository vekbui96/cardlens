# CardLens v2 — the rebuild

A second UI for the web app, built beside the first, switchable at runtime, and
specified before it is written so several people (or sessions) can build parts
of it at once without colliding.

This file is the **plan**: what we are rebuilding, what we are deliberately not,
how the toggle works, what has to exist before parallel work can start, and who
owns which files. The per-stream specs live in `specs/`.

---

## 1. What is actually being rebuilt

**The presentation layer. Not the app.**

The parts of this codebase that took the longest to get right are not the
screens — they are the things `CLAUDE.md` is full of: the finish vocabulary, the
OR-Set collection with tombstones, the binder merge rule, the recognition accept
gate, the printings oracle and its `generated` variants, the shared sync
validator. Every one of those is a measured answer to a problem that bit
somebody, and rebuilding them would mean re-learning all of it by being bitten
again.

So v2 **keeps and shares**:

| Kept as-is                | Why                                                                        |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/models/`             | Domain vocabulary and rules. Measured, tested, shared with the server.     |
| `src/storage/`            | OR-Set, tombstones, migrations, corruption-safe reads.                     |
| `src/services/`           | Sync, watermarks, image store, HTTP.                                       |
| `src/scan/`               | Perceptual hash and the accept gate, in parity with the Python recogniser. |
| `src/hooks/` (data hooks) | React Query wiring around the above.                                       |
| `server/`                 | Untouched. v2 is a client.                                                 |

And v2 **replaces**:

| Rebuilt               | Why                                                                           |
| --------------------- | ----------------------------------------------------------------------------- |
| Screens (`src/web/*`) | Grown one feature at a time; each screen invents its own layout.              |
| Layout and shell      | Built as "the glasses screen, stretched"; the web is now the primary surface. |
| Styling               | 14 CSS-module files with duplicated tokens, spacing and card geometry.        |
| Navigation            | A screen stack designed for a device with four gestures.                      |

> **If a change belongs in the kept column, it is not a v2 change.** Fix it in
> place, on `main`, where v1 gets it too. A v2 stream that finds a domain bug
> should fix it in the shared layer and say so — not fork it.

### Where the seam actually leaks

A survey of the codebase found the "keep" column is **not** clean. These are
presentation living in files v2 is told not to touch, so v2 either adopts v1's
wording and geometry verbatim or forks the shared layer on day one. Neither is
acceptable silently. **Phase 0 lifts each of these out** into `src/v2/` (or into
a shared `presentation/` module v1 keeps importing), and until it does, the
boundary is a lie:

| File                         | What is presentation in it                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `models/history.ts:102-143`  | SVG chart geometry — `width`, `height`, `pad`, `innerW/innerH` — consumed by `components/CollectionGraph.tsx` |
| `models/ownedSort.ts:21-26`  | Sort-control **labels**                                                                                       |
| `models/finishes.ts:118-124` | `finishLabel`, `TYPE_LABELS`, `FOIL_LABELS`                                                                   |
| `models/target.ts:121`       | `statusLabel` — "Not checked yet", "Out of stock"                                                             |
| `models/movement.ts:76`      | Percent formatting                                                                                            |
| `models/setCompletion.ts:68` | Progress-bar width, 0–1                                                                                       |

And the data layer imports **upward** into v1 feature folders, which a v2 build
would drag along:

- `hooks/useSetView.ts:7` → `features/results/rarityFilters.ts`
- `hooks/useCollectedSets.ts:5` → `features/collection/completionTier.ts`
- `hooks/useSetInformation.ts:72` sorts by `byPriceDesc` — a presentation choice
  made in the data layer.

**`src/utils/` was in neither column and is entirely presentation.**
`utils/format.ts` (USD via `Intl.NumberFormat`, the string `"Unavailable"`,
`formatUpdated`'s "Just now"/"min ago", `formatCollector`'s "223/197") and
`utils/image.ts:16-21` (`optimizedImageUrl`, the wsrv.nl proxy and its `w=&q=72`).
Every v2 screen needs these. **They belong to the Foundation stream.** Left
unassigned, ten streams re-invent currency formatting and disagree about
"Unavailable".

Confirmed genuinely reusable, with zero navigation coupling and zero layout
reads: `hooks/` (data hooks), `services/`, `storage/`, `scan/`. `navigation.ts`
already flattens the web stack to depth 2 and delegates `pop()` to
`history.back()`. There is no service worker to invalidate.

### The one thing v2 does NOT cover

**The glasses.** `layoutMode` still resolves `glasses` and `preview`, and those
render v1 screens, forever, unchanged. v2 is `web` only. The glasses UI is a
different product on a 600x600 additive display and rebuilding it is not on the
table — see `CLAUDE.md` on why the two shells genuinely want opposite things.

---

## 2. The toggle

`src/app/uiVersion.ts` resolves `v1 | v2`, in this order:

1. `?v=1` / `?v=2` in the URL — wins, and is how e2e and a shared link pin it.
2. `localStorage["cardlens:v1:ui-version"]` — how a person opts in and stays in.
3. **`v1`.** The default does not move until v2 reaches parity (§6).

Rules that keep this from becoming a mess:

- **The glasses never see it.** `uiVersion` is only consulted when
  `layoutMode === "web"`. A square 600x600 device gets v1 whatever the flag says.
- **v2 is lazy.** It is a separate chunk; a v1 user never downloads it. Verify
  after any deploy that the entry bundle did not grow.
- **One switch, both ways.** Every shell renders a control that flips the
  setting and reloads, so nobody can get stranded in a half-built v2.
- **The URL survives.** Both versions read and write the same `#/…` routes
  (`src/app/screenUrl.ts`), so a link works in either and switching keeps you on
  the screen you were on.
- **No shared CSS.** v2 styles are scoped under `[data-ui="v2"]`. v1's global
  rules in `web-theme.css` are scoped to `[data-shell="web"]` and would
  otherwise reach straight into v2 — the same isolation trick, one level down,
  and it is proven by a test rather than assumed.

---

## 3. Tooling to set up first

These are the things that pay for themselves immediately, and that are painful
to retrofit once ten screens exist. **All of Phase 0.**

### 3.1 Fixtures (`?seed=`) — the biggest single win

Building this session repeatedly meant hand-writing localStorage seed scripts in
a browser console to see a binder with cards in it. That is slow, unrepeatable,
and it is the same data every e2e test needs.

A dev-only fixture loader: `?seed=binders` populates the store with a known
collection, binders and settings, then reloads. One named fixture per scenario
(`empty`, `collection`, `binders`, `trade`, `scan`). Used by hand, by e2e, and
by the component workshop, so all three exercise identical data.

**Dev and test only.** It writes to real storage, so it is compiled out of a
production build and refuses to run unless `import.meta.env.DEV` or the e2e flag
is set.

### 3.2 A component workshop

There is no Storybook in this repo. v2 needs one — not for documentation, but
because a screen assembled from unreviewed primitives is how v1 ended up with
three definitions of a card tile. Options, in order of preference:

1. **A route, not a dependency**: `#/dev/workshop` in the v2 shell, rendering
   every primitive in every state against the fixtures. Zero new deps, works in
   the real shell with real tokens, and is itself a v2 screen. Costs a lazy
   chunk that never ships to users.
2. Storybook, if the workshop route proves too thin. It is ~40MB of devDeps and
   a second build to keep working; only pay that if (1) is not enough.

**Start with (1).**

### 3.3 Visual regression

Parallel streams break each other's pixels silently. Playwright already runs in
CI; add `toHaveScreenshot()` snapshots for the workshop route and one per
screen, at phone and desktop widths. A stream that changes a shared primitive
then _sees_ what it changed everywhere, in the diff, before review.

### 3.4 Tokens as the contract

One file, `src/v2/tokens.css`, and **screens may not invent values**. v1's
tokens are duplicated across stylesheets, which is why the binder list had its
own idea of a card's aspect ratio. A lint rule (`no-restricted-syntax` on raw
hex in `src/v2/**`) makes it enforceable rather than aspirational.

### 3.5 Layout primitives before screens

`Stack`, `Row`, `Grid`, `Panel`, `Card`, `Rail`, `Sheet`. Every screen composes
these. This is the difference between "nine screens that each hand-roll a grid"
and a system — and it is the actual deliverable of Phase 0, more than any screen.

### 3.6 An e2e page-object layer

`e2e/v2/pages/*.ts` — one object per screen exposing intent (`openBinder`,
`fillPocket`) rather than selectors. Streams then write tests that survive
another stream's markup change.

---

## 4. Phases

**Phase 0 — Foundation. One person. Nothing else starts until it lands.**

The toggle, the v2 shell, routing, tokens, primitives, fixtures, the workshop
route, the e2e page-object base, and the visual-regression harness. Everything
in §3. It is the critical path and it is deliberately not parallel: eight people
inventing primitives at once is how you get eight card tiles.

**Phase 1 — Screens, in parallel.** One stream per spec in `specs/`. Each owns
its own directory and its own spec, and touches nothing outside it (§5).

**Phase 2 — Parity and cutover.** §6.

---

## 5. Parallel streams, and who owns what

The ownership map is the thing that makes this parallel. A stream owns its
directory and **nothing else**; a change needed outside it is a request to the
foundation owner, not an edit.

| Stream            | Spec                         | Owns                                                                                          |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| Foundation        | `specs/00-foundation.md`     | `src/v2/{shell,primitives,tokens.css,routing}`, `src/dev/fixtures.ts`, `e2e/v2/pages/base.ts` |
| Home              | `specs/01-home.md`           | `src/v2/screens/home/`                                                                        |
| Collection & sets | `specs/02-collection.md`     | `src/v2/screens/collection/`                                                                  |
| Set cards         | `specs/03-set-cards.md`      | `src/v2/screens/set/`                                                                         |
| Binders           | `specs/04-binders.md`        | `src/v2/screens/binders/`                                                                     |
| Binder builder    | `specs/05-binder.md`         | `src/v2/screens/binder/`                                                                      |
| Scan              | `specs/06-scan.md`           | `src/v2/screens/scan/`                                                                        |
| Shares & trade    | `specs/07-shares.md`         | `src/v2/screens/share/`                                                                       |
| Target & sealed   | `specs/08-target-sealed.md`  | `src/v2/screens/target/`, `.../sealed/`                                                       |
| Search & details  | `specs/09-search-details.md` | `src/v2/screens/search/`, `.../details/`                                                      |

Conflict rules:

- **Never edit another stream's directory.** Two streams needing the same
  component means it belongs in `primitives/`, which is a foundation change.
- **`src/v2/routes.ts` is append-only** and one line per screen. It is the only
  shared file streams touch, and one line each is a conflict you can resolve by
  reading it.
- **Fixtures are additive.** Add a named fixture; never change one another
  stream uses.

---

## 6. Definition of done, and the cutover

A stream is done when its spec's acceptance criteria pass, it has unit tests for
logic and an e2e test for the path a person actually takes, its screenshots are
committed, and it works at 390px and 1440px.

**v2 becomes the default when, and only when:** every screen in `specs/` is
done; the parity checklist in each spec is fully ticked; the e2e suite passes
against `?v=2` as well as `?v=1`; and the entry bundle has not grown for a v1
user. Then the default in `uiVersion.ts` flips and v1 becomes the fallback —
kept, not deleted, for at least one release.

---

## 7. Hazards found in review — fix in Phase 0, before any screen

These were found by surveying the codebase against this plan. Each one would
otherwise surface as a mysterious bug in several streams at once, and be
diagnosed separately by each of them.

### 7.1 The input adapter eats keys on the web — the worst of them

`src/integrations/meta/KeyboardBackedInputAdapter.ts:37` attaches a
**document-level `keydown`** listener that calls `preventDefault()` on arrows,
Enter and Escape. `InputProvider` (`src/app/contexts.tsx:12-15`) installs it
**unconditionally, including in web mode.**

v1 gets away with it only because its web screens pass `enabled: false` to
`useWearableInput`. Any v2 screen with a text field, a `<select>`, a modal, or
arrow-key scrolling will silently fight it, and the symptom — Escape does not
close, arrows do not scroll — reads as a bug in that screen. Nine streams would
each diagnose it.

**Fix: gate the adapter on `layoutMode !== "web"` in Phase 0.** It is the one
change in this plan that also improves v1.

### 7.2 `global.css` centres everything and kills focus rings

`src/styles/global.css:32-44` makes **both `body` and `#root`** flex containers
with `align-items:center; justify-content:center`, sets a global
`:focus { outline: none }`, and defines a bare non-module `.sr-only`.

A v2 root mounted in `#root` is therefore vertically centred and has no focus
outlines until it fights all three. This is a bigger leak than anything in
`web-theme.css`. Phase 0 owns the fix, and it must not break the glasses.

### 7.3 `--cl-viewport` is what makes screens fluid

`GlassesFrame.module.css:81` sets `--cl-viewport: 100%` on `.webSurface`, and
**43 CSS modules read it**. That single line is what converts the fixed 600px
square into a fluid column. A v2 shell that does not render `GlassesFrame` loses
it, and anything v2 reuses from v1 collapses to a 600px box. v2 must define its
own equivalent explicitly rather than inheriting by luck.

### 7.4 `playwright.config.ts` is a shared, unowned file

Its `phone` and `desktop` projects are scoped by **filename regex**
(`testMatch: /(phone-layout|web-header|…)\.spec\.ts/`) over a 600×600 glasses
default viewport. So every new v2 spec requires editing that shared file — a
serialisation point and a merge conflict for every stream — and a spec that
forgets runs at 600×600 and fails confusingly.

**Fix in Phase 0: add an `e2e/v2/**` directory to the projects' `testMatch`
once**, so a new spec is a new file and nothing shared changes.

### 7.5 `?seed=` sits beside an existing `?sim=`

`src/app/contexts.tsx:43-51` already reads `?sim=fail|empty|slow` to simulate
catalog failures. `?seed=` is a different axis — `sim` fakes the NETWORK, `seed`
populates STORAGE — so they are kept separate deliberately rather than merged.
But they are one vocabulary to a user: document them together, and never let a
third dev query parameter appear without a reason.

Note also that **nothing in this repo uses `import.meta.env.DEV` yet**. The
fixture guard is the first, so verify by inspecting the built bundle that the
fixtures really are dropped — do not assume the flag works.

## 8. Conventions v2 keeps from v1

These are not up for renegotiation; they were paid for.

- **Comments say WHY, with the measurement.** The house style. A number in a
  comment is a number someone can re-check.
- **Absent means default.** Never write a field holding its default value — it
  manufactures a sync edit. See `quantity`, `forTrade`, `cover`.
- **A silent no-op is the bug.** Every control either does something or says why
  it cannot.
- **Verify against the served bytes, and look at the page.** A blank SPA
  returns 200.
- **Never spell out an enum at a gate.** Use the narrowing helper.

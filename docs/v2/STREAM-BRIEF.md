# Building a v2 screen — the contract

Read this, then your own spec in `specs/`. Phase 0 is built; you are Phase 1.

Everything here exists because nine screens are being built at the same time by
people who cannot see each other's work. The rules are narrow on purpose: inside
your own directory do whatever the spec needs, and outside it change nothing.

---

## 1. What you own, and what you must not touch

**You own exactly one directory:** `src/v2/screens/<yours>/` — components, CSS
modules, unit tests, all of it. Plus your own spec file under `docs/v2/specs/`
if you learn something worth recording there.

**You may also add** e2e specs under `e2e/v2/`. Name them after your screen
(`e2e/v2/home.spec.ts`). They run at 390 and 1440 automatically.

**Do NOT touch these.** Each is shared, and an edit here is a merge conflict for
every other stream:

| File                          | Why not                                              |
| ----------------------------- | ---------------------------------------------------- |
| `src/v2/V2Router.tsx`         | The integrator wires your screen in. Just export it. |
| `src/v2/tokens.css`           | Need a token? Ask. Do not add one locally.           |
| `src/v2/primitives/`          | Need a primitive changed? Ask. Do not fork it.       |
| `src/v2/shell/`               | The shell owns width, header and navigation.         |
| `playwright.config.ts`        | Already matches everything under `e2e/v2/`.          |
| `package.json`                | No new dependencies without asking.                  |
| `src/models/`, `src/storage/` | Domain layer. A bug here is a real bug — report it.  |
| Anything under `src/web/`     | That is v1. It stays working, untouched.             |

If you genuinely need something outside your directory, **stop and say so in
your final report** rather than reaching for it. That is the whole mechanism.

---

## 2. Export exactly this

```tsx
// src/v2/screens/<yours>/index.ts
export { YourScreen } from "./YourScreen.tsx";
```

The component takes the props its `Screen` variant carries in
`src/app/navigation.ts` (e.g. the set screen takes `setId` and `setName`), or no
props at all. It renders **content only** — no page margins, no max-width, no
header. The shell owns all of that.

---

## 3. The vocabulary

Import from `../../primitives/index.ts` and nowhere else inside it:

`Stack` `Row` `Grid` `Panel` `Card` `CardArt` `Meter` `Chip` `Money`
`RailHost` `Sheet` `ScreenReaderOnly` `cx`

Run `#/dev/workshop` and look at every one before you write anything. It shows
each in every state it has, against real fixtures.

Things worth knowing before you rediscover them:

- **Spacing is a scale, not a number.** `gap={3}`, never `gap="12px"`. There is
  no prop anywhere that accepts a length; that is deliberate, and
  `npm run check:v2` fails the build on a raw colour or length in `src/v2/`.
- **`CardArt` has no width prop.** It fills its container at 5:7. Its `detail`
  prop is how many pixels to ask the CDN for, not a size on the page.
- **`Money` never renders `$0.00`.** An unpriced card and a free card are not
  the same card. Pass `loading` while a price is in flight.
- **A `Card` with no `onPress` and no `href` renders inert** — no pointer, no
  hover. A surface that looks pressable and is not is how a UI lies.
- **A shut `RailHost` takes zero width.** Use it for a desktop side panel and
  `Sheet` for the phone equivalent; the caller picks, because only the caller
  knows whether the content survives being 320px wide.

Need something the set does not cover? **Ask, do not invent.** A tenth primitive
is fine; a second card tile is not.

---

## 4. Data

All the providers are already mounted above you, shared with v1. **Do not mount
any.** No `new QueryClient`, no `new Repositories`, no `<LibraryProvider>` —
`src/v2/providers.test.ts` fails the build if you do, because a second cache
means two sets of requests and a sync racing itself.

Use the existing hooks: `useLibrary()`, `useSets()`, `useSetView()`,
`useLibraryValue()`, `useNavigation()`, and the rest of `src/hooks/`. Read your
spec's **Data** section — it names the exact calls and, more importantly, the
request budget. Those budgets are measured, not guessed:

> Home may not add a per-set request. It makes ONE `/api/catalog/prices` call
> for the whole collection. That call replaced 19 separate ones taking 4.5–6.7s
> each, several of which failed.

Formatting comes from `src/utils/format.ts` and `src/utils/image.ts`. Do not
write another currency formatter.

---

## 5. States are not optional

Every spec has a **States** table. It is the actual work — the happy path is the
easy quarter of a screen. Build all of them:

- **Loading** — a skeleton in the shape of the content, never a bare spinner.
- **Empty** — say what is missing and offer the action that fixes it. An empty
  dashboard is a dead end.
- **Partial** — the honest form. "480 of 973 printings priced", not a bare total
  that looks complete and is not.
- **Failed** — say what could not be reached, offer a retry, and do not blame
  the user. The catalog fails roughly a quarter of the time in bursts.
- **Offline** — local data still renders; the parts that need the network say so.

`?seed=empty` and `?sim=fail|empty|slow` exist so you can actually see these.

---

## 6. Accessibility is how the tests find things

Both suites select by **role and accessible name**. That is deliberate: a
control the tests can find is a control a screen reader can find, so this is not
a separate task you do afterwards.

- Real `<button>` and `<a href>`. Never a clickable `<div>`.
- Headings descend without skipping. `Panel` takes `headingLevel` for this.
- Colour is never the only carrier of meaning. Gold means complete **and** the
  label says "complete" — green-against-gold is the pair deuteranopia collapses.
- Interactive targets are at least 44px (`--v2-tap`). The reason is a thumb, so
  it does not shrink on a wide window.
- Decorative art is `alt=""` and `aria-hidden` (`CardArt decorative`). A screen
  reader should not be read nine card names it cannot act on.

---

## 7. What "done" means

All of these, before you report back:

```bash
npm run verify        # format, typecheck, lint, token check, unit tests
npm run e2e           # everything except @visual
npm run e2e:visual    # visual regression (win32/linux baselines)
```

- **Unit tests** for the decisions, not the markup. "An unpriced card says
  Unavailable" is a test; "the div has class X" is not.
- **At least one e2e** per screen under `e2e/v2/`, driving it the way a person
  would, from a fixture.
- **One visual snapshot** per screen. Add it to your own e2e file inside a
  `test.describe("... @visual")` block, and generate baselines with
  `npm run snapshots`. If you have Docker, also `npm run snapshots:linux` —
  that is the set CI compares against. If you do not, say so in your report and
  the integrator will generate them.
- **Commit on your branch** with a message explaining _why_, including any
  measurement that drove a decision.

## 8. Your report back

Short, and in this shape:

1. What you built, and any place you knowingly departed from the spec — with
   the reason. A spec is a plan written before contact with the code; if it is
   wrong, say so. That is worth more than silent compliance.
2. Anything you needed outside your directory and did not take.
3. Anything you found that is a real bug in the shared layer.
4. The exact verify / e2e / visual results. Do not report "done" on work you
   did not run.

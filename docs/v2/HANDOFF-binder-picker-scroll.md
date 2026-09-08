# Handoff: the binder picker's printing chooser is below the fold

**Status: OPEN on `main`. Not fixed. One attempted fix exists and must not be
ported as written — see §5.**

Written at the end of the session that found it, for whoever picks it up.

---

## 1. The bug, as reported

> "this weird thing happens when i search and click a card to add in, i have to
> scroll down to select variant"

The user confirmed the flow when asked: **inside a binder**, not the top-level
Search tab. So:

open a binder → tap a pocket → search a card by name → tap the card →
**scroll a long way** → pick the printing.

## 2. Where it is

`src/v2/screens/binder/BinderPicker.tsx` on `main`.

- The chosen card is held in `chosen` state (~line 103).
- The chooser is rendered **last**, after the results list (~line 205). Its own
  comment says so: _"Last, so 'which printing' is asked where the thumb already
  is, under"_ the results.
- **There is no `scrollIntoView` and no `useEffect` in the file.** Nothing moves
  the reader to the chooser when a card is picked.

The name search here deliberately asks for **every** printing of a Pokémon
rather than the top forty ("Where does my Charizard go" is a question about the
108 that exist). So tapping a result halfway down a hundred leaves the chooser a
long scroll below it, and the tap that should have finished the job starts a
hunt.

## 3. What NOT to change

The chooser sitting **below** the results rather than replacing them is
deliberate and correct. Choosing a printing used to swap the results out, so the
card you were comparing against vanished at the moment the comparison mattered.
Keep the placement. Bring the reader to it instead.

Sticky positioning is **not** the answer, though it looks like it. The chooser is
the last child of its container, so a bottom-stuck element has no travel to
stick through. Making sticky work means restructuring the picker into a
scrolling list plus a pinned footer — a much bigger change than this justifies.

## 4. The fix

When `chosen` becomes non-null: scroll the chooser into view and move focus to
it.

```tsx
const detailRef = useRef<HTMLDivElement>(null);
const chosenId = chosen?.id ?? null;
useEffect(() => {
  if (!chosenId) return;
  const el = detailRef.current;
  if (!el) return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  el.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}, [chosenId]);
```

- `block: "nearest"` scrolls the least that will do, so a chooser already on
  screen does not jump.
- Focus follows the scroll, or a keyboard and screen-reader user is left standing
  on the result they just activated with the printings announced nowhere.
  `preventScroll` because the scroll above already placed it.
- The node carrying the ref needs `tabIndex={-1}` so it can receive focus. It is
  a landing place, not a stop in the tab order.

## 5. The trap — read this before writing the code

An attempted fix is committed on the dead branch
`worktree-agent-a2ea42245416eb2df` as **`be98670`**. **Do not port it as
written.** It is credibly the cause of a severe regression on that branch:

|                       | `e2e/v2/binder.spec.ts --workers=1`  |
| --------------------- | ------------------------------------ |
| `main`                | **34 passed, ~26 seconds**           |
| branch with `be98670` | **1 passed, 4 failed, 13.4 minutes** |

Same machine, same command, quiet conditions. A 30× slowdown with unrelated
tests (trade copy counting, per-pocket pricing, the request budget, the visual
snapshot) timing out is not a broken assertion — it is the signature of a
**render loop**, and that effect is the only new thing in the file.

Not proven, but the most likely mechanism, and the thing to design against:

- **Key the effect on `chosen?.id`, never on `chosen`.** The object identity
  changes on unrelated re-renders.
- **Put the ref on a node that is always mounted**, not one inside an
  `if (chosen)` branch. The attempted fix attached it to a conditionally-rendered
  node, so the mount → effect → focus → render cycle could re-enter.
- Note that on `main` the equivalent code path is a different shape from the
  branch's (`main` has no `PocketDetail.tsx`), so the fix has to be written
  against `main`'s file rather than transplanted.

## 6. The test, and why this shipped

The existing test asserted `toBeVisible()` — which in Playwright means "is in
the layout with a box". **That is true of an element a hundred results below the
fold.** That is exactly how this reached a user.

Assert the viewport instead. Polled, because the scroll is smooth:

```ts
const prompt = page.getByText(/Which printing goes in/);
await expect(prompt).toBeVisible();
await expect
  .poll(async () => {
    const box = await prompt.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) return false;
    return box.y >= 0 && box.y + box.height <= viewport.height;
  })
  .toBe(true);
```

This was confirmed to fail at **both** 390 and 1440 without a fix (verified by
stashing the fix and watching it go red, then restoring it). The test is the
good half of `be98670` and is worth taking even though the implementation is not.

## 7. Verification gate

Running the spec is not enough. **Check the runtime as well as the pass count.**

```
CL_E2E_PORT=<yours> CL_E2E_API_PORT=<yours> \
  npx playwright test e2e/v2/binder.spec.ts --workers=1
```

Baseline on `main`: **34 passed in ~26 seconds.** If it passes but takes minutes,
the fix is wrong in the way described in §5. A pass count alone would have hidden
this.

Use your own port pair — `reuseExistingServer` silently reuses a busy port, so
without one you may be testing another checkout's code.

## 8. Context you may want

- The branch `worktree-agent-a2ea42245416eb2df` is **superseded**. All nine v2
  screens shipped from other streams; that branch's own binder implementation is
  dead code and its test failures are not worth investigating.
- Two shared-layer fixes found in the same session were ported and are **live on
  `main` as `e3ecfda`**: `settledKey` (six hooks could never observe a query
  failing) and `forceEmpty` honoured by `listSets`/`getCardsBySet` (`?sim=empty`
  did nothing on set-reading screens). Nothing else from that branch is wanted.
- A second, unrelated layout problem was spotted and **not** investigated,
  because the user confirmed it was not what they hit: on **card details** at
  phone width, the art column and a seven-row facts list sit above the Printings
  panel, so you scroll past both to reach the thing you came to do. The fix
  would be to order Printings above the facts. Unverified — treat as a lead.

# Spec: Binders (the shelf)

## Purpose

"Which binder is that one." A list that answers it by sight, the way a shelf of
books does — not by making you read names in order.

## Parity checklist

From `src/web/binders/WebBindersScreen.tsx`, `BinderCover.tsx`.

- [ ] Each binder is a tile with **art**: the cover it was given, or failing
      that a real page from it at pocket scale, gaps and all.
- [ ] The art costs **no fetch** — `CardSlot` already carries `imageSmall`
      denormalised. Lazy-loaded.
- [ ] The cover is decorative: `alt=""`, `aria-hidden`; the tile's button
      carries name, format and fill in words.
- [ ] Covers are one fixed height; the page's WIDTH varies by format.
- [ ] Fill as a bar and a number; gold at 100%.
- [ ] Format · pages; copies too, but only for a trade binder where copies and
      pockets diverge.
- [ ] "For trade" tag.
- [ ] Value, only for binders that opted in, with the unpriced count beside it.
      "Pricing…" while in flight, never `$0.00`.
- [ ] Delete takes **two presses** — the tombstone survives a sync, so a
      misclick reaches every device.
- [ ] Create is the last tile on the shelf, not a form across the top.
- [ ] Header summary: binders and total cards.

**Dropped on purpose:** nothing.

## Data

Binders from local storage. `useBindersValue` for opted-in binders only — each
is a request per set it spans, so the filter stays at the call site where the
cost is visible.

## States

| State                             | What shows                                                                 |
| --------------------------------- | -------------------------------------------------------------------------- |
| No binders                        | The create tile alone — it is its own empty state                          |
| Binder with no cover and no cards | An empty page of pockets, honestly                                         |
| Cards with no art                 | Face-down card, not an empty pocket — a full binder must not read as empty |
| Pricing                           | "Pricing…"                                                                 |
| Unpriceable                       | "Unavailable · N unpriced"                                                 |

## Layout

`auto-fill` grid, min 150 / 190 / 220px by breakpoint. Fixed cover height is
what makes auto-fill safe — while the cover took height from column width, the
shelf jumped a row taller mid-resize.

## Interactions

Whole tile opens. Delete is a quiet glyph that asks, over the binder it is
about.

## Acceptance

- [ ] A binder with a cover shows the cover; without one, a page mosaic.
- [ ] Opening the shelf issues zero image requests beyond the visible tiles.
- [ ] `getByRole("img")` finds nothing on this screen.
- [ ] One press never deletes.
- [ ] All tiles in a row are the same height at every breakpoint.
- [ ] A 12-pocket cover is visibly wider than a 9-pocket one.

## Out of scope

The builder (`05`).

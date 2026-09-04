# Spec: Collection & sets

## Purpose

"How far through each set am I, and what do I own." v1 merged two screens into
one here on purpose — Sets and Collection answered nearly the same question, and
Collection was a subset of Sets with a different row design. **Keep them one
screen.** `#/sets` must still resolve.

## Parity checklist

From `src/web/sets/WebSetsScreen.tsx`, `src/web/collection/`.

- [ ] One screen: in-progress sets, complete sets, all sets — grouped, in that
      order.
- [ ] Per set: logo, name, code, year, card count, and progress.
- [ ] **Base and master completion are different numbers** and both are shown
      with the words BASE / MASTER — never colour alone (green and gold are the
      pair that fails deutan vision).
- [ ] Value panel: total, folded to the five most valuable sets, with the
      remainder **named and priced on the expander** rather than merely hidden.
- [ ] `#/owned` — every printing held, as one sortable list.
- [ ] The card showcase: one printing large, the rest scrolling beneath, arrow
      keys, and the stage stays put when the strip scrolls.
- [ ] Sets order by collector number, not price.
- [ ] Sync connect entry point.

**Dropped on purpose:** nothing.

## Data

`useSets` (cached, versioned key), `/api/catalog/prices` (shared with Home — it
must hit the same React Query key, not a second one), collection from local
storage. **No per-card requests.**

## States

| State               | What shows                                                 |
| ------------------- | ---------------------------------------------------------- |
| Loading             | Set rows as skeletons, in group order                      |
| Empty collection    | All sets, none in progress, and a line saying how to start |
| Partial pricing     | "4 of 5 printings priced"; unpriced sets say "Unavailable" |
| Filtered to nothing | Says so, with the filter that caused it                    |
| Offline             | Cached sets render; value degrades                         |

## Layout

390: one column of rows.
1440+: auto-fill grid, ≥3 columns, each row sized by content — the width goes
into COLUMNS, not into a gap inside a row. Row height under 72px (that floor is
a thumb target a pointer does not need).

## Interactions

A row opens the set. The value panel expander is a button, not a hover.

## Acceptance

- [ ] `#/sets` and `#/collection` both open this screen.
- [ ] Base and master completion each render with their word.
- [ ] The value panel names every set it folded away.
- [ ] At 1440 there are ≥3 columns and no row wider than 500px.
- [ ] Sets are in collector-number order, and `101a` / `TG01` / `SV001` sort
      sanely.
- [ ] The showcase stage does not move when the filmstrip scrolls.

## Out of scope

The per-set card grid (`03-set-cards`).

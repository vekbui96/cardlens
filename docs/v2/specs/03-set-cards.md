# Spec: Set cards

## Purpose

"Which cards in this set do I have, and which printing of each." The screen a
master-set collector spends real time in, marking cards off.

## Parity checklist

From `src/web/sets/WebSetCardsScreen.tsx`, `CardSheet.tsx`, `SetSwitcher.tsx`.

- [ ] Cards in collector-number order, in nine-pocket **pages** — the rhythm the
      hobby actually uses (`models/binder.ts`).
- [ ] **A filtered view is not a binder page.** When a filter is active, fall
      back to a flat grid; never draw pages over a discontinuous run.
- [ ] Per-printing marking, not per-card. A card with normal + reverse + holo
      shows three targets.
- [ ] Printing badges are 44px tappable buttons on web. Collect mode and the
      printing picker are glasses-only and stay hidden here.
- [ ] Per-printing prices, priced separately per printing.
- [ ] Rarity filter, and the rarity bar.
- [ ] Set switcher without going back.
- [ ] Unknown foils are accepted and humanised — never an enum.

**Dropped on purpose:** the focus ring (web has a pointer).

## Data

`useSetView(setId, setName, { wantPrintings: true })` — printings come from
TCGdex via the server cache, one request per set, ~8KB. Prices per printing.
**No request per card.**

## States

| State                      | What shows                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Loading                    | Page skeletons in collector order                                                       |
| Set has no variant data    | Cards still mark; prices say unavailable (Pitch Black returns `prices: {}` for all 120) |
| A lone `generated` variant | Takes the lone market price; two prices stays unpriced                                  |
| Filtered                   | Flat grid, and the count that survived the filter                                       |
| Filtered to nothing        | Says so                                                                                 |
| Offline                    | Cached set renders; marking still works and syncs later                                 |

## Layout

390: one page column, cards 3 across.
1440+: pages side by side where they fit; a pocket is the same size in every
format (`--v2-pocket`).

## Interactions

Tap a printing badge to mark it. Marking is local-first and never blocks on the
network. Nothing here is destructive.

## Acceptance

- [ ] A set of 120 cards issues one printings request, not 120.
- [ ] Applying a filter switches to a flat grid, and clearing it restores pages.
- [ ] Marking a printing writes one row and survives a reload.
- [ ] A card with three printings offers three independent targets.
- [ ] An unrecognised foil renders with a humanised name rather than crashing.
- [ ] Every badge is ≥44px.

## Out of scope

Binder layout (`04`/`05`). Card details (`09`).

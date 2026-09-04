# Spec: Home

## Purpose

"What is my collection, and what is it worth, right now." It is the landing
screen and the only one that prices everything at once, which makes it the
screen most able to be accidentally expensive.

## Parity checklist

From `src/web/home/WebHomeScreen.tsx`.

- [ ] Collection total, with **how much of it is priced** beside it ("480 of 973
      printings priced"). Never a bare total.
- [ ] Sets in progress, with completion.
- [ ] The collection-value graph over time.
- [ ] Entry points: Sets/Collection, Search, Scan, Binders, Sealed, Target.
- [ ] Sync status line, with the three distinct messages.
- [ ] Empty state: "Nothing tracked yet" plus the two actions that start you off.

**Dropped on purpose:** nothing.

## Data

- `/api/catalog/prices?sets=…` — **one** call, 12h disk cache. 213ms median,
  4ms warm. Do not regress this into a call per set; that is exactly what it
  replaced (19 calls, 4.5–6.7s each, several failing).
- `/api/printings/:setId` — currently one per set, 19 calls, ~760ms in parallel,
  measured and deliberately not batched. If this screen makes it hurt, batch it
  server-side rather than hiding it.
- The graph reads local history only.

**Budget: this screen may not add a new per-set request.**

## States

| State            | What shows                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Loading          | Skeleton totals; never `$0.00`                                                                          |
| Empty            | "Nothing tracked yet" + Browse sets / Search                                                            |
| Partial          | Total, plus "X of Y priced" — the honest form                                                           |
| No prices at all | "Unavailable", not zero                                                                                 |
| Offline          | Local counts still render; value says it cannot price                                                   |
| Flat history     | Series centred, not pinned to the bottom edge — a steady collection must not read as "you have nothing" |

## Layout

390: one column, value card, then progress, then actions.
1440: value and graph side by side; actions as a row of tiles, not a menu list.

## Interactions

Every tile is a link with a real target. No tile that only looks tappable.

## Acceptance

- [ ] With 973 printings across 19 sets, Home issues exactly one
      `/api/catalog/prices` request.
- [ ] A set the oracle cannot price is named, and the rest still total.
- [ ] `$0.00` never renders while pricing is in flight.
- [ ] A flat value history renders centred.
- [ ] Empty state offers both actions and neither is a dead end.

## Out of scope

The collection list itself (`02-collection`). Home links to it.

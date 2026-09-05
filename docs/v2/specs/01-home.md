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

---

## What was actually built, and where it departed from the above

### The entry-point tiles were not built, on purpose

The parity checklist says the six destinations come "from
`src/web/home/WebHomeScreen.tsx`". They do not — that file has none of them, and
carries a comment explaining why: on web those destinations live in the app bar,
one tap from everywhere, and repeating them down the middle of Home would make it
a worse copy of a menu the user already has.

v2's shell nav **is** that app bar, on this very screen, with `aria-current`
marking where you are. So parity is already met by the shell, and a second copy
would be two competing answers to "where do I go", one of which goes stale the
moment the nav gains an entry.

What Home draws instead are the links that carry something the nav cannot: the
total with its denominator (→ Collection), the set you were last in with your
progress on it, each set closest to complete with its bar, and — only when there
are any — a binders line with a count of what is in them. `e2e/v2/home.spec.ts`
asserts the absence, because an absence nobody checks comes back.

### Sync only appears when sync needs a person

The shell already prints `syncLine`'s label on every screen. Home adds a panel
only for `bad-token` and `disabled` — the two states that stay broken until
somebody acts. Everything else recovers by itself or was chosen deliberately, and
a status line that is almost always fine trains the reader to skip it.

`syncLine`'s _hints_ are not used here: they are written for the glasses
("Select to re-enter", "← to disconnect") and describe gestures a browser does
not have. The label is shared so the two versions cannot disagree about what a
state is called.

### "Value over time" is printings over time

`models/history.ts` is explicit that the app only ever knows today's prices, so a
value line would be a curve that never happened. The chart counts printings and
says so; the panel beside it is the money.

### An honest "pricing…" that ends

`useCollectionValue` counts a **disabled** query as pending, and a set's pricing
query is disabled while its name is unknown. A slow or failed set list therefore
leaves every set held permanently "pricing…", waiting on a request nobody is
making. `pricingSummary` subtracts sets the loaded set list does not contain and
reports them as unpriceable instead. The underlying behaviour is a shared-layer
bug, reported rather than patched from here.

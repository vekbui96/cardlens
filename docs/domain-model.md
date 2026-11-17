# Domain model

Moved out of CLAUDE.md; read when touching printings, the collection OR-Set, binders, trade binders, binder art, or sync.

## Printings are `type` or `type:foil` strings

`normal`, `reverse`, `holo`, `reverse:pokeball`, `reverse:masterball`, `reverse:energy`, `holo:tinsel`, `firstEdition`, `shadowless`.

**Never make this an enum.** Three 2025-26 sets introduced nine foils between them (`pokeball, masterball, tinsel, cosmos, energy, friendball, loveball, quickball, team-rocket`); anything hardcoded is wrong by the next release. Unknown foils are accepted and humanised for display.

A scalar key matters: it is the OR-Set key, so rows never change shape and sync payloads stay flat.

Legacy values (`holofoil`, `reverseHolofoil`, `pokeBall`, `masterBall`) migrate via `canonicalFinish`. **Canonicalise on write as well as read** — writing raw while reading canonical put `holofoil` and `holo` in the store as two rows for one printing, and both survived the merge.

## The collection is an OR-Set

One row per `(card, finish)` with tombstones (`src/storage/printings.ts`).

- A removal is a **tombstone, never a missing row** — a missing row is indistinguishable from "never seen", so deletions would resurrect on the next sync from a stale device.
- Merging is order-independent and idempotent; ties resolve toward the tombstone.
- Tombstones prune after 180 days. Removing them earlier lets a long-offline device resurrect deleted cards.
- **To wipe data, write tombstones — do not delete the file.** Deleting the server copy leaves device rows stranded, and the device will not re-push them because its watermark says it already did.

## Binders converge per binder, last write wins — NOT as an OR-Set

`src/storage/binders.ts`, shared with the server the same way `printings.ts` is.

The collection merges per `(card, finish)` because two devices marking different
cards are both right. A binder is one arrangement: pocket 4 of page 2 holds
exactly one card, and merging pocket by pocket would produce a page neither
person laid out. Granularity is per **binder** so editing different binders on
two devices never conflicts — the case that actually happens — and only
concurrent edits to the same binder lose the older one.

Everything else follows the collection's rules deliberately: **deletes are
tombstones** (`deletedAt`), ties go to the tombstone, tombstones prune at 180
days, and the watermark is `max(updatedAt, deletedAt)`. Tombstones drop their
pages — the id must survive, the contents need not.

Binder watermarks are **separate** from the collection's (`bindersPushedAt` /
`bindersPulledAt`). One shared pair would let a collection push move the binder
watermark past binder edits that were never sent.

Binder ids must be unique across DEVICES, not just one — they are the key the
merge converges on.

## Binder formats are gated in THREE places, and only one can lose data

`BINDER_SPECS` / `BINDER_FORMATS` / `isBinderFormat` in `models/binderLayout.ts`
are the source. The gates are `models/binderParse.ts` (what may be stored),
`isBinder` in `storage/repositories.ts` (what may be READ back), and the format
pickers. **Never spell the formats out at a gate** — use `isBinderFormat`.

The read gate is the dangerous one. It listed `"9" || "12"` inline, so adding
4-pocket produced a binder that saved and then vanished on the very next read:
created, gone, nothing said. Every unit test passed, because none of them went
through a storage round trip. `repositories.test.ts` now round-trips every
format in `BINDER_FORMATS`.

**4-pocket has no facing pages** (`hasFacingPages`). Two 2-column pages abreast
read as one 4-across grid, which is exactly what a 12-pocket page looks like —
the formats would be indistinguishable at a glance. Screens call `pageGroups`,
never `toSpreads` directly; `toSpreads` still owns the off-by-one pairing and is
tested on its own.

## A trade binder is a flag on a binder, not a second kind of object

`forTrade` on the binder; `quantity` and `condition` on a card slot. Collectors
build a trade binder exactly the way they build any other, and a set binder
becomes a trade binder the afternoon they decide to sell it — two types would
mean two screens, two sync paths and two merge rules for one thing. The flag
changes what the binder AFFORDS, never what it can hold.

- **Absent means one copy, and unstated condition.** Neither is written when it
  holds the default: a quantity of 1 is stored as no quantity at all, and
  `forTrade: false` as no flag. Every binder that predates trading has neither, and re-writing them to say "1" would stamp `updatedAt` on all of them and push the
  lot through sync to record nothing. Worse, two ways to spell the same value is
  how last-write-wins starts ping-ponging between devices that agree.
  `slotQuantity` is the single reader.
- **Unstated condition is NOT near mint.** It is a real answer and has to stay
  reachable, which is why pressing a grade it already has clears it.
- **Condition never changes a price.** The oracles publish one market price per
  printing and say nothing about what condition it assumes, so any multiplier
  ("LP is 85% of NM") would be a number this app invented and then printed
  beside real ones. It is shown next to the price and left to the traders.
- **Copies multiply the total; pockets are what get counted as priced.** A trade
  binder is the first thing here where "how many cards" and "how many pockets"
  diverge, and reporting "23 of 24 priced" over a total that summed forty cards
  would be a quiet lie about what was measured. `countBinder` returns both.
- **Validation is shared, like the merge rule.** `src/models/binderParse.ts`
  decides both what the server may STORE and what the trade page may DRAW. Two
  validators that drift fail the same way two merge rules do: the ends disagree
  about what a binder is and a pocket vanishes at one of them. The server's
  `binderStore.ts` re-exports it, so callers and tests see no change.

Trade links reuse the share store — same id space, same 16 random bytes, same
revocation, same 404 for revoked and never-existed alike. `Share` is a tagged
union and a row with **no `kind` is a set share**, because there is a live
`shares.json` on the server full of them.

`POST /api/share/binder` **refuses with 409 `binder_not_synced`** when the
server holds no copy of the binder. Minting a link that 404s for whoever it was
sent to is worse than refusing, and "share a binder you just made" is the normal
first-time case.

## Custom binder art lives on the server, never in the binder

A binder is pushed **whole** on every edit, so an inline data URI would go through the sync endpoint on every pocket move and into the localStorage budget
this app has already exhausted once. So: the client resizes to ≤900px JPEG,
`POST /api/binders/images` stores the bytes, and the slot carries a 20-byte
`imageId`.

- The URL is resolved at **render** time (`imageSlotSrc`), never stored — a
  binder travels between devices that reach the server on different origins.
- Reads are unauthenticated, like a live share: the id is 16 random bytes and is
  the credential. Uploads need `COLLECTION_TOKEN`.
- **SVG is refused.** It is script execution served from the API origin.
- The id pattern is shared between `binderImages.ts` and `binderStore.ts`. An id
  one accepts and the other refuses to serve is a permanently broken pocket.
- Orphans are swept after a merge, but only images **older than 7 days**. An
  image is uploaded before the binder referencing it is pushed — the client
  debounces sync by 10 seconds — so a sweep with no age floor deletes pictures
  inside that window.

## Sync has no outbox queue

"What still needs sending" is derivable: every row stamped after the last successful push. A queue can be lost, double-applied, or drift from the data it describes; a watermark recomputes truth from the rows. A failed sync needs no cleanup.

The token lives in `localStorage`, entered per device. **It must never go in a `VITE_` variable** — this ships as a static bundle on GitHub Pages, so anything baked in at build time is public and the auth is worthless.

Sync failure is a status line, never a toast: the local write already succeeded. Only `bad-token` and `disabled` get distinct wording, because those stay broken until someone acts.

## Conventions (rationale)

- Screens own their `BackRow` and drive focus through `useBackableFocus`; `MenuRow` only works inside a `FocusList`, so standalone controls use `ToggleRow`.
- **A blank page kept on purpose and one left over are identical**, so nothing
  may trim trailing empty binder pages automatically. Doing so made "Add page"
  a silent no-op for as long as binders existed: the commit added the page and
  the same commit removed it. `addPage` / `removeLastPage` are explicit, and
  `reformat` compacts by re-flowing rather than by trimming.
- The mock fixtures do NOT contain Pitch Black (`me5`), which several screens
  default to — an e2e test that needs cards must switch to a set that exists,
  e.g. Obsidian Flames.
- Sets list in collector-number order (`byCollectorNumber`) — binder order, not price. Numbers are strings and not always numeric (`101a`, `TG01`, `SV001`).
- Storage reads are corruption-safe and migrate on read: total, idempotent, and cannot half-apply if the app closes mid-write.

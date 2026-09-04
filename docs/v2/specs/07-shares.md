# Spec: Shares & trade

Three public pages a stranger opens from a link, with no account and no
collection of their own.

## Purpose

- **Showcase** (`#/showcase`) — somebody's set progress, read from the LINK.
- **Live** (`#/live/:shareId`) — the same, read from the SERVER, so it changes
  after it was sent.
- **Trade** (`#/trade/:shareId`) — somebody's binder, offered, priced per copy.

> Showcase/live say what its owner HAS. Trade says what its owner will GIVE UP.
> They are different pages on purpose; do not merge them.

## Parity checklist

From `src/web/showcase/`, `src/web/trade/TradeShareScreen.tsx`.

- [ ] No token, no account, no collection required. Renders for a stranger.
- [ ] Ownership is judged against the **sharer's** collection, not the viewer's
      — that is why `BinderPageView` takes an `owns` predicate.
- [ ] Trade: two views of one binder — as laid out, and a list sorted by value —
      bound together by the **pocket address** (`2·5`), which is how two
      collectors will name a card to each other out loud.
- [ ] Tapping a list row scrolls to that pocket and lights it.
- [ ] Copies and condition shown; **condition never adjusts a price**.
- [ ] Priced per copy; the unpriced count rides with the total.
- [ ] A revoked link and a link that never existed both 404 identically.
- [ ] Legacy untagged shares read as SET shares — there is a live `shares.json`
      full of them.
- [ ] Read-only: pockets are not buttons.
- [ ] Everything validates through `models/binderParse.ts` before it is drawn.

**Dropped on purpose:** nothing.

## Data

`/api/share/:id`. Untrusted input — a share is drawn only after `parseBinder`.
Prices per printing.

## States

Loading · valid share · revoked/unknown (404, same page) · malformed payload ·
a binder whose images 404 · offline · empty binder.

## Layout

The same spread geometry as the builder, from the same primitives — the owner
must see what the recipient will see, with no separate preview to drift.

## Acceptance

- [ ] Opening a trade link in a fresh profile with no storage renders fully.
- [ ] Ownership shading reflects the sharer, not the viewer.
- [ ] A list row scrolls to and highlights its pocket.
- [ ] A revoked link is indistinguishable from a never-existed one.
- [ ] A share row with no `kind` renders as a set share.
- [ ] No pocket on these pages is focusable as a button.
- [ ] A payload with a bad slot drops that slot, not the page.

## Out of scope

Minting links (that is the builder's Settings). The share store.

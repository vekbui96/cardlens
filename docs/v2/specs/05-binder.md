# Spec: Binder builder

The most complex screen in the app. Budget accordingly.

## Purpose

"Lay this binder out." Plan positions, including pockets kept empty on purpose
and cards not owned yet — a binder is a plan, and planning around gaps is the
point.

## Parity checklist

From `src/web/binders/WebBinderScreen.tsx`, `src/components/BinderPage.tsx`.

- [ ] Pages as the binder falls open: page 1 alone against the inside front
      cover, then facing pairs. **4-pocket has no facing pages** — two 2-column
      pages abreast are indistinguishable from a 12-pocket page.
- [ ] A pocket is a pocket: the same size in 9 and 12; **bigger** in 4-pocket,
      which exists for jumbo cards. The PAGE gets wider with more columns.
- [ ] The cover: a real slot before page 1, fillable, draggable onto, and **not
      a pocket** — no index, excluded from the filled count, untouched by
      reformat.
- [ ] Select a pocket, then pick a card. Placing advances to the next empty
      pocket; clearing stays put.
- [ ] Unowned cards render shadowed and tagged "Don't own", and stay placeable.
- [ ] Drag between pockets, and on and off the cover. Pocket→pocket **swaps**;
      a card from the picker **replaces**. Mouse drags past 5px; touch requires
      a hold, because a press that moves is a scroll.
- [ ] The drop must not also select the pocket.
- [ ] Add page / Remove page are explicit; **nothing trims trailing empty pages
      automatically** — that made "Add page" a silent no-op for as long as
      binders existed.
- [ ] Settings disclosure: pocket size, show-value-in-list, trading. What is on
      shows as a tag when shut.
- [ ] Trade mode: copies and condition per pocket. Absent means one copy and
      unstated condition, and neither is written when default. Condition never
      changes a price.
- [ ] Custom images: resized client-side, stored server-side, referenced by id,
      URL resolved at render. SVG refused. States its precondition when there is
      no token.
- [ ] Search every set by name; browse one set; "fill with one of each".
- [ ] Per-pocket price, and a footnote total with the unpriced count.

**Dropped on purpose:** nothing.

## Data

`useBinderValue` (one request per set the binder spans — the Riolu binder spans
thirty), `useSetView` for the picker, `useSets`. Binder writes are local-first
and debounced ~10s before sync.

## States

Loading · empty binder · full binder · trade mode · uploading an image · upload
failed (four distinct messages: bad token, sync disabled, too large, unreachable)
· offline · a pocket whose art is missing · binder not found.

## Layout

**390:** pages stack one at a time; the picker is a sheet along the bottom that
appears when a pocket is selected. This is the layout confirmed on hardware —
do not regress it.

**≥1000:** pages left, picker a collapsible rail right. The rail is **shut until
asked for**, and opens when a pocket is selected. Shut it must take **zero**
width: two 12-pocket pages plus the gutter need 1108px, and even a 28px handle
cost the pocket 3.5px, which breaks "a pocket is a pocket".

## Interactions

Drag is pointer events, not HTML5 DnD (`dragstart` never fires on touch). Three
things that each break it silently and must be handled: handlers reading React
state instead of a ref (a flick completes inside one frame); the browser's own
image drag; and `touch-action` applied after the browser has already claimed the
gesture as a pan.

## Acceptance

- [ ] 9 and 12 pocket widths are equal to within 1px; 4-pocket is ≥1.3x.
- [ ] Dropping a card back where it started does not destroy it.
- [ ] Dragging onto an occupied pocket swaps; from the picker, replaces.
- [ ] A drop does not open the picker on the target pocket.
- [ ] The cover is not counted in filled/pockets, and survives a reload.
- [ ] Add page then reload keeps the page.
- [ ] Remove page is disabled for the last page and for a non-empty one.
- [ ] A binder with 30 sets issues 30 printings requests, not 300.
- [ ] The picker rail shut costs the spread no width.

## Out of scope

The shelf (`04`). The public trade page (`07`).

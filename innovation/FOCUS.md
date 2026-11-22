# Focus

<!--
Ve's steering for the loop's proposals (LOOP.md section 5). Edit freely; keep it short.
The loop reads this file and never writes it. Empty or missing = no steering.
It weights what the loop proposes; it does not change what the loop may build (LOOP.md rules 7 and 8 still apply).
-->

## Direction (set 2026-11-19 by Ve; replaces the 2026-11-17 features-first override)

Move CardLens toward the experience of the best collector apps (Rare Candy, Collectr, Dex): knowing what
the collection is worth and how it is moving, finishing sets, and showing cards off, in a polished,
fast phone UI. Match **capabilities**, never their branding, names, art or exact layouts. Single user
(Ve) on the **web / phone** shell; no accounts, marketplace, payments or social network (see Avoid).

**UI/UX quality is first-class.** Every proposal:

- says in **Why**, in one plain sentence, what Ve will notice on the phone (before -> after);
- for a UI change, lists in **How it would be tested** the before and after screenshots it will attach
  to the PR (390px phone width, plus 1440px when desktop layout changes);
- keeps the web rules: focus ring off, 44px tap targets, no layout shift while prices load, partial
  success over blank, "unpriced" over invented numbers;
- targets the **v2** screen when one exists (Ve uses v2 most: `ui.v2` 11 vs `ui.v1` 6 over 30 days), and
  leaves v1 working; closing a v2 parity gap (`docs/v2/PLAN.md` section 6) counts as UI work.

## Approve specs, not single ideas (set 2026-11-21 by Ve)

Ve approves a spec once and every slice builds on that approval (auto-approved via spec, LOOP.md
section 1 "Specs"), so one approval should unlock several builds.

- **Default to a spec** (LOOP.md 5.7) for anything more than one small, self-contained change:
  multi-step features, anything touching several screens, anything needing new stored data or a server
  piece, and any priority below that cannot ship as one Size-S slice. Single proposals are only for
  genuinely small polish or fixes: Size S, one screen, front end only. Never a run of unlinked issues.
- **Keep one spec waiting for Ve.** After any slices to open, if `slots.mayOpenSpec` is true and a slot
  is free, the session's first new item is a spec whenever a worthwhile multi-step idea exists. The
  LOOP.md limit stays: at most one unapproved spec at a time.
- **Write specs that flow without Ve:** 3-5 slices, each independently shippable, in build order. Put
  anything Manual / needs Ve (new stored data, server data changes, claims about Ve) in the FIRST slice(s),
  or name it plainly in the spec, so later slices are not held behind an open Manual slice. Prefer a design
  with no Manual slice where a safe one exists (derive from data already stored, or device-local storage).
- **Next specs, in this order** (check open and closed issues first; never re-propose a rejected one):
  1. **Want list across sets**: one cross-set missing list with each card's price, filters (set, rarity),
     and a summed "to finish" total, from stored ownership only (builds on #106, #122, #136, #137). A stored
     wishlist would be new data: only as slice 1, marked Manual.
  2. **First-run onboarding** on a fresh phone: empty collection, no sync token, prices still loading,
     Mault offline, the Home 429 burst; each state explains itself and offers the next step (builds on #120).
  3. **v2 design-system consistency pass**: one price / percent / empty / error presentation across v2
     screens, one-off styles removed, a screen or two per slice (follows #139).
  4. **Collector showcase**: a read-only page of chosen cards shared through the existing share-link
     mechanism (like the trade link); no profiles, followers or feeds. A new share kind is new stored
     data: slice 1, Manual.

## Priorities (in order)

1. **Value and movement (portfolio).** Already live: total, Most valuable strip, 7/30-day movement % on
   Home, Biggest movers (7/30-day switch) with a Biggest change sort, set completion cost, collection
   growth, and the value-over-time spec #108 (daily snapshot `/api/value-history`, chart #117, device-local
   "since you last looked" #110). Remaining work here is follow-ups to those, as small single proposals.
   Percent only, never mixing EUR into USD; floor out cheap cards (see `movement.ts`).
2. **Home / dashboard polish.** One phone dashboard: worth, movement, completion, what's next; clear
   hierarchy, loading skeletons instead of jumping numbers, tappable rows that lead somewhere.
3. **Set completion and want list.** Master-set progress across sets, "what would finishing cost"
   beyond one set, a cross-set missing list built from what is already stored (spec 1 above). v2 Copy
   missing list (#137) and v2 finishing cost (#136) are open; owned tags on search (#96) was closed.
4. **First-run and empty states.** A fresh device (no sync token, empty collection, Mault offline,
   prices still loading, the 429 burst on Home) should explain itself and offer the next step.
5. **Consistency / design system.** v2 tokens and primitives everywhere, one way to show a price,
   a percentage, an empty list, an error; remove one-off styles.
6. **Accessibility and touch ergonomics.** Contrast, labels for icon buttons, focus return from sheets,
   reduced motion, thumb reach for primary actions, safe areas on iOS.
7. **Speed and perceived performance.** Home and My cards time to first useful number, lazy chunks,
   optimistic marks.
8. **Binder and trade-binder UX** on phone / web, and robustness tests around sync, storage round-trips
   and parsing (as supporting work, not in place of the above).

## Avoid

- **Glasses-specific proposals** (set 2026-11-17 by Ve, until Ve removes this line): no new glasses
  features, glasses UI, gesture flows or glasses-only fixes. Web / phone work only; a shared change must
  leave the glasses behaviour as it is (say so in the proposal).
- **Out of scope for this app** (they need what CardLens does not have): marketplace, buying/selling,
  instapacks or any payments; accounts, followers, feeds or public profiles; push / email price alerts;
  graded-card values (no graded price source: would need PSA/eBay sold data, a paid feed); Japanese or
  other-language pricing; multi-currency totals; AI grading or condition estimates.
- Copying another app's branding, names, art or exact layouts.
- Recognition, the card index, scanner gate constants (`phash.ts` / `judge.py` parity). The scan review
  screen's UI is fine to improve; what the scanner decides is not.
- `/api/target/*`
- Sync merge / validation rules
- Cache-version bumps
- Secrets, `.env`, NSSM
- New dependencies, unless clearly worth a manual step
- Anything that changes the shape of stored data (owned sealed product, grades, a wishlist or value
  snapshots are all new stored data: Manual / needs Ve or a spec)

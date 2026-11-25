# Focus

<!--
Ve's steering for the loop's proposals (LOOP.md section 5). Edit freely; keep it short.
The loop reads this file and never writes it. Empty or missing = no steering.
It weights what the loop proposes; it does not change what the loop may build (LOOP.md rules 7 and 8 still apply).
-->

## Direction (set 2026-11-19 by Ve; growth features lead from 2026-11-24)

Move CardLens toward the experience of the best collector apps (Rare Candy, Collectr, Dex): knowing what
the collection is worth and how it is moving, finishing sets, trading, and showing cards off, in a
polished, fast phone UI. Match **capabilities**, never their branding, names, art or exact layouts. Single
user (Ve) on the **web / phone** shell; no accounts, marketplace, payments or social network (see Avoid).

**2026-11-24, Ve: "innovate more on features so the product can grow."** The UI/UX polish pass of
2026-11-22 has done its job (about 60 polish items shipped between 11-22 and 11-25). New ideas now lead
with **features that give a collector a new reason to open CardLens**, not more readability tweaks.

## Order of work (set 2026-11-22, updated 2026-11-24 by Ve)

1. **Approved work finishes first.** Approved proposals, approved specs and their slices and request
   children keep building ahead of anything new, exactly as today. Do not propose anything that
   overlaps or reworks an approved, unbuilt slice.
2. **New ideas are growth features.** Every new spec, and most new proposals, add a capability Ve does
   not have today: something new to do, see or decide in CardLens. A feature with a good UI beats a
   better UI on an existing feature.
3. **Polish is capped: at most 1 in 5 new items** (count the open proposal queue plus this run's new
   items) may be polish-only (spacing, labels, wording, tap targets, focus rings, skeleton tweaks, error
   copy on a screen that already works). While 2 or more polish-only proposals are open, propose no more
   polish. A run that finds no feature idea worth proposing proposes fewer items, not polish to fill
   the slots. Accessibility bugs that block a task and real defects are not capped.

## Feature specs wanted (set 2026-11-24, in this order)

Write each as a spec (LOOP.md 5.7, 3-5 slices). Check open and closed issues first and build on what is
live; the "Already live" line under each says what not to re-propose.

1. **Collection insights.** A screen (or a Home section that leads to one) that answers "what is my
   collection?": value and count by set, era, rarity and type; most valuable cards; how concentrated
   the value is (top 10 cards = n% of the total); price coverage; what was added this month and what it
   is worth now; gain or loss since a card was added where the add date is stored. Derived from data
   already stored and the prices already fetched, so it should need no server or stored-data change.
   Already live: Home total, value over time (#117), biggest movers (#102 / #121), since you last looked
   (#110), per-set worth and Most valuable sort (#134), Biggest change sort (#129).
2. **Set goals and a real want list.** Choose which sets Ve is chasing (and whether a set means the base
   list or every printing / master set), see progress and cost to finish per goal, and mark single cards
   as wanted outside owned sets (the chase card from a set Ve does not collect). Shopping view: the
   wanted cards sorted by price with a running budget, copyable for a card show. Already live: derived
   want list across owned sets (#142 / #146 / #147 / #150), set To finish cost (#136), Copy missing list
   (#137), Closest to complete (#106 / #122).
3. **Bulk add, import and full export.** Add many cards fast without the scanner: paste or type a list
   ("SV3 125", set code + number, quantity, printing), a whole-set "I have 1-50" range, CSV import, with
   a preview of what will be added and an undo. Full backup export of the collection and binders (CSV
   and JSON) from the phone. Imports go through the existing add path; merge rules stay untouched.
   Already live: Download CSV of owned cards (#138).
4. **Price watch and card price history, in-app only.** A watch list of cards Ve is thinking of buying
   or selling, each with its current price and its 7 / 30 day movement, a Home row when a watched card
   moves past a threshold Ve sets (shown in the app, never pushed), and a price history line on card
   details. Measure first: what per-card history the price source and server already keep; if per-card
   history needs a server piece, that is slice 1 and needs Ve. **Decided by Ve 2026-11-25: alerts stay
   in-app only; no push or email alerts, do not propose them.** Already live: movers strip and windows,
   mover current price (#155).
5. **Trade builder.** Pick cards from Ve's trade binder against the other collector's list, see both
   sides' value and the balance as it changes, and mark a trade done and move the cards. **Decided by Ve
   2026-11-25: no trade share link (no new share type, no new `shares.json` row, no server change); at
   most copy the trade as text or save it as an image, front end only.** Already live: trade share page
   and enlarged card sheet (#207 / #221 / #236 / #282 / #295), binder showcase share (#191).

After these, earlier queued ideas still count as features: faster shop mode for scan bursts (PRODUCT.md
bet 3, scan UI only) and trade-link conversion (bet 4, measure first).

## Server, stored data and approval (read before writing any spec)

Ve's standing policy (`innovation/AUTONOMY.json`) auto-approves only Pages-only work outside the server,
stored data and protected areas. Most growth features touch one of those, so:

- **Anything that needs a server change or a new or changed stored data shape (collection, binders,
  shares, a wishlist / watch list / goals, value or price snapshots, new storage keys, even
  device-local ones) comes as a spec for Ve.** Say so plainly at the top of the spec: "Needs Ve:
  <server / stored data>, because <reason>", and put that piece in the FIRST slice so the rest can flow.
- Where it is honest, offer a derived-first design: slice 1 shows what can be computed from data that
  already exists (Pages only), later slices add the stored or server part.
- Never present a server or stored-data slice as Pages-only to get it auto-approved.

## Rules for every UI proposal

- **Why** says, in one plain sentence, what Ve will notice on the phone (before -> after); for a feature,
  what Ve can now do that he could not before.
- **Evidence:** cite the Observer's finding(s) for that screen (loop-refs) and, with DESIGN_SKILLS on,
  one `shot` of the live target screen at 390x844 and, if useful, one `detect` on its files (LOOP.md
  section 9: at most two skill calls per proposal); quote what you saw, at what width.
- **How it would be tested** lists the before and after screenshots for the PR (390px, plus 1440px when
  desktop layout changes).
- **Lens and metric:** name the closest listed lens ("web UI/UX" for polish).
- Web rules: focus ring off, 44px tap targets, no layout shift while prices load, partial success over
  blank, "unpriced" over invented numbers.
- **v2 first** (Ve uses v2 most); v1 keeps working. Use the v2 tokens and primitives (ErrorNotice, the
  shared empty state, Skeleton); new screens look like the existing v2 screens, no new visual language.

## Approve specs, not single ideas (set 2026-11-21 by Ve)

Ve approves a spec once and every slice builds on that approval (auto-approved via spec, LOOP.md
section 1 "Specs"), so one approval should unlock several builds.

- **Default to a spec** (LOOP.md 5.7) for anything more than one small, self-contained change:
  multi-step work, anything touching several screens, anything needing new stored data or a server
  piece. Single proposals are for small features on one screen or the capped polish.
- **Keep one spec waiting for Ve.** After any slices to open, if `slots.mayOpenSpec` is true and a slot
  is free, the session's first new item is a spec from the list above. The LOOP.md limit stays: at most
  one unapproved spec at a time.
- **Write specs that flow without Ve:** 3-5 slices, each independently shippable, in build order, a
  screen or two per slice. Put anything Manual / needs Ve in the FIRST slice(s) and name it plainly.
- **Done or approved already** (never re-propose): value over time #108, want list #142, first-run
  onboarding #153, v2 consistency #166, collector showcase #191, card details v2 #203, loading and
  perceived speed #243, Collection and Home polish #266.

## Priorities (in order, for new ideas)

1. **Growth features from the list above** (insights, set goals and want list, bulk add / import /
   export, price watch and history, trade builder).
2. **Smaller features on live screens** that add a capability (a new sort, filter, total, shortcut or
   link between screens that answers a collector's question).
3. **Value, movement and set completion follow-ups** that add information, not only layout. Percent
   only, never mixing EUR into USD; floor out cheap cards.
4. **Binder and trade-binder features** on phone / web, and robustness tests around sync, storage
   round-trips and parsing (supporting work).
5. **Polish** (interaction quality, states, consistency, accessibility, motion), within the 1 in 5 cap.

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

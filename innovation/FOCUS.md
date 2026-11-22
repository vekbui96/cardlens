# Focus

<!--
Ve's steering for the loop's proposals (LOOP.md section 5). Edit freely; keep it short.
The loop reads this file and never writes it. Empty or missing = no steering.
It weights what the loop proposes; it does not change what the loop may build (LOOP.md rules 7 and 8 still apply).
-->

## Direction (set 2026-11-19 by Ve; UI/UX lead added 2026-11-22)

Move CardLens toward the experience of the best collector apps (Rare Candy, Collectr, Dex): knowing what
the collection is worth and how it is moving, finishing sets, and showing cards off, in a polished,
fast phone UI. Match **capabilities**, never their branding, names, art or exact layouts. Single user
(Ve) on the **web / phone** shell; no accounts, marketplace, payments or social network (see Avoid).

## Order of work (set 2026-11-22 by Ve)

1. **Approved work finishes first.** Approved proposals, approved specs and their slices (#166 slices
   #175, #176, #181; the #191 showcase slices) and request children keep building ahead of anything new,
   exactly as today. Do not propose anything that overlaps or reworks an approved, unbuilt slice.
2. **New ideas are front-end UI/UX enhancements.** Every new proposal and spec enhances how the web /
   phone UI looks, reads and feels: v2 screens, polish, interaction quality, motion with purpose,
   empty / loading / error states, information hierarchy, consistency, accessibility, perceived speed.
   New features are fine when the idea is mainly a UI/UX improvement to a screen Ve already uses.

## Rules for every UI proposal

- **Why** says, in one plain sentence, what Ve will notice on the phone (before -> after).
- **Evidence:** cite the Observer's finding(s) for that screen (loop-refs) and, with DESIGN_SKILLS on,
  one `shot` of the live target screen at 390x844 and, if useful, one `detect` on its files (LOOP.md
  section 9: at most two skill calls per proposal); quote what you saw, at what width.
- **How it would be tested** lists the before and after screenshots for the PR (390px, plus 1440px when
  desktop layout changes).
- **Lens and metric:** name "web UI/UX" alongside the closest listed lens.
- Web rules: focus ring off, 44px tap targets, no layout shift while prices load, partial success over
  blank, "unpriced" over invented numbers.
- **v2 first** (Ve uses v2 most: `ui.v2` 11 vs `ui.v1` 6 over 30 days); v1 keeps working; closing a v2
  parity gap (`docs/v2/specs/`) counts as UI work. Use the v2 tokens and primitives (ErrorNotice from
  #174, the shared empty state from #165); no redesigns, no new visual language.

## Approve specs, not single ideas (set 2026-11-21 by Ve)

Ve approves a spec once and every slice builds on that approval (auto-approved via spec, LOOP.md
section 1 "Specs"), so one approval should unlock several builds.

- **Default to a spec** (LOOP.md 5.7) for anything more than one small, self-contained change:
  multi-step work, anything touching several screens, anything needing new stored data or a server
  piece. Single proposals are only for genuinely small polish or fixes: Size S, one screen, front end
  only. Never a run of unlinked issues.
- **Keep one spec waiting for Ve.** After any slices to open, if `slots.mayOpenSpec` is true and a slot
  is free, the session's first new item is a spec whenever a worthwhile multi-step idea exists. The
  LOOP.md limit stays: at most one unapproved spec at a time.
- **Write specs that flow without Ve:** 3-5 slices, each independently shippable, in build order, a
  screen or two per slice. Put anything Manual / needs Ve in the FIRST slice(s) or name it plainly;
  prefer a design with no Manual slice (derive from data already stored, or device-local storage).
- **Done or approved already** (never re-propose): want list #142, first-run onboarding #153, v2
  consistency #166, collector showcase #191. Check open and closed issues before any new spec.
- **Next UI/UX specs, in this order:**
  1. **Card details v2**: image first, a clear price / printing / owned hierarchy, marking a printing
     from the details screen in one tap with immediate feedback, swipe or arrows to the next card.
  2. **Loading and perceived speed**: skeletons shaped like the final layout on Home, My cards, Set and
     Search; time to first useful number; optimistic marks that confirm or roll back visibly.
  3. **Motion and feedback with purpose**: sheet and screen transitions, mark / unmark and copy
     confirmations, progress changes; short, interruptible, off under `prefers-reduced-motion`.
  4. **Accessibility and touch pass on v2**: contrast, labels for icon buttons, focus return from sheets,
     thumb reach for primary actions, iOS safe areas, a screen or two per slice.
  5. **Navigation and hierarchy**: the v2 shell, back behaviour, what each screen leads with, Home's
     "what's next" rows that go somewhere.

## Priorities (in order, for new ideas)

1. **Interaction quality and polish of v2 screens.** Tap feedback, one-tap paths for common jobs, clear
   primary actions, nothing that looks unfinished at 390px.
2. **Empty, loading and error states; perceived speed.** Every state explains itself and offers the next
   step; skeletons instead of jumping numbers; lazy chunks where the first screen waits on them.
3. **Information hierarchy and consistency.** One way to show a price, a percentage, an empty list, an
   error; the most important number first; one-off styles removed.
4. **Accessibility and touch ergonomics.** Contrast, labels, focus return, reduced motion, thumb reach,
   safe areas.
5. **Motion with purpose.** Only where it explains a change of state; never decoration.
6. **Value, movement and Home follow-ups** as small UI improvements to what is live (total, movers,
   value over time #108 / #117 / #110). Percent only, never mixing EUR into USD; floor out cheap cards.
7. **Set completion and want list follow-ups** on the shipped want list screens (#146, #147, #150).
8. **Binder and trade-binder UX** on phone / web, and robustness tests around sync, storage round-trips
   and parsing (supporting work, not in place of the above).

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

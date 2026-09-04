# Spec: Search & card details

## Purpose

- **Search** — "find a card whose set I do not remember." The only way to reach
  a card without knowing where it lives; 218 sets in a dropdown is not a way to
  find one card.
- **Details** — "everything about this printing", and mark it from here.

## Parity checklist

From `src/features/results/`, `src/features/card-details/`, `src/web/scan/`.

### Search

- [ ] Typing does not search. **Submit does.** pokemontcg.io fails ~25% of the
      time in bursts and rate-limits; a request per keystroke spends that budget
      on prefixes nobody asked about.
- [ ] Results as a grid — a name search returns 108 Charizards.
- [ ] Each result shows set and collector number, because the name is not enough.
- [ ] Recent searches.
- [ ] Says when nothing matched, rather than showing an empty strip.
- [ ] A failure offers a retry inline, and says the catalog is flaky rather than
      blaming the user.

### Details

- [ ] Every printing of the card, each markable independently.
- [ ] Per-printing market price, and "n/a" where there is none — a blank where a
      price belongs reads as loading forever.
- [ ] Large art.
- [ ] Rarity, set, collector number, and the printed denominator.
- [ ] Reachable from search, the set grid, the showcase and a scan row.

**Dropped on purpose:** the glasses' collect-mode toggle and printing picker —
they exist because a pinch needs to say _which_ printing it means, and a finger
does not ask that.

## Data

`/api/search` (proxied, retried across ~4s), `/api/printings/:setId` for the
card's set, prices per printing.

## States

Idle (recent searches) · searching · no results · catalog error with retry ·
results · details loading · a printing with no price · offline.

## Acceptance

- [ ] Typing eight characters issues zero requests; submitting issues one.
- [ ] A 500 from the catalog shows a retry, and retrying works.
- [ ] Every result states its set.
- [ ] A card with three printings shows three prices, `n/a` where unknown.
- [ ] Marking from details is reflected on the set screen without a reload.
- [ ] Back from details returns to the results, scrolled where you left them.

## Out of scope

The search proxy and its retry policy (`server/`).

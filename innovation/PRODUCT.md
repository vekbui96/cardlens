<!--
  This file is YOURS, Ve: edit it by hand whenever the product picture changes. The innovation loop reads it
  (Phase B and the weekly product review) and never writes it; it steers what gets proposed, like FOCUS.md,
  and never authorises building anything. Numbers below come from CLAUDE.md / docs/handoff.md as of
  2026-11-16; replace them when you re-measure.
-->

# CardLens: product

## Product

CardLens is a Pokemon card collection app built for Meta Ray-Ban Display glasses first, with a phone /
desktop web shell on the same code and a companion server on server-pc.

**Vision:** the fastest way to log, value and show a Pokemon collection, glasses-first.

## Users

- **Primary: Ve**, a collector, on the glasses and the phone (desktop for sorting and binder work).
- **Secondary:** people Ve shares binders and trade links with (view-only visitors of a share link).
- **Open question: grow to other collectors? (undecided).** Until Ve answers here, proposals must not
  assume multi-user growth (no accounts, onboarding, multi-tenant storage or public discovery).

## Jobs to be done, and where they happen

| Job                                | Context                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Log cards fast                     | at a card shop or a table: hands busy, glasses on, only the four gestures the glasses send, bursts of 20-30 cards |
| Sort at home                       | desktop or phone, the whole collection, binders open                                                              |
| Check what the collection is worth | phone or glasses, Home's total and per-set pricing                                                                |
| Build and show binders             | desktop/phone to arrange, glasses/phone to show                                                                   |
| Trade                              | share links / trade links with another collector                                                                  |

## Success metrics (baselines as of 2026-11-16)

| Metric                       | Baseline                                                                                                              | Loop can measure read-only?                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scan auto-accept rate        | 91.4% (1,730 of 20,205 index cards come back AMBIGUOUS; 1,078 of those are near-misses 2-7 bits away, 652 exact ties) | No. Live scan outcomes (and which recogniser answered) are recorded on the device, not in the server log, and the offline benchmark needs a script the loop cannot run: Manual / needs Ve. |
| Price coverage               | "480 of 973 printings priced" on Home before the catalog-prices fix                                                   | Partly: `GET /api/catalog/prices?sets=...` returns `missing` per set (GET only, aggregate counts, no collection contents).                                                                 |
| Home load                    | 8.7 s cold / 97 ms warm (`/api/catalog/prices`)                                                                       | Yes: time GET requests to the live API (cold vs warm).                                                                                                                                     |
| Sync failures / dropped rows | target 0                                                                                                              | No: there is no server-side counter; the server log only shows startup lines. Needs Ve.                                                                                                    |
| Manual picks per scan batch  | lower is better (no baseline)                                                                                         | No: client-side only. Needs Ve or a future aggregate log line.                                                                                                                             |
| Server health                | `/api/health` up, recogniser reachable                                                                                | Yes: GET `/api/health`.                                                                                                                                                                    |

## Principles

- **Glasses first.** 600x600 additive display (black is transparent), `keydown` only, no hold, no key-up;
  every row of chrome costs about two rows of cards; prefer shape and brightness over colour.
- **Never lose collection data.** The OR-Set, tombstones, binders and storage round-trips are sacred;
  merge/validation rules are out of the loop's scope.
- **Show uncertainty, never invent numbers.** No condition multipliers, no guessed prices; say "unpriced".
- **Partial success over empty.** "480 of 973 priced" beats a blank screen.
- **Measure before scoping.** A number in the proposal, or a measurement as the first step.

## Bets Ve may want proposed (as Manual / needs Ve projects, broken into small steps)

1. **Scanner gap measurement:** what a chroma channel or a 128-bit hash does to the 1,078 near-misses,
   before anyone scopes OCR (read-only analysis first; no change to `phash.ts` / `judge.py` / the index).
2. **Collection value over time, with price-spike alerts.**
3. **Faster shop mode for scan bursts** (20-30 cards, gesture economy, fewer confirmations).
4. **Trade-link conversion:** how often a shared link leads to a trade, and what gets in the way.

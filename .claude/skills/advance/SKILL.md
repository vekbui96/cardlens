---
name: advance
description: Use when asked to keep going, pick the next thing, work autonomously, or improve CardLens without a specific task named — "just keep doing the things", "what's next", "make the web version better", "do what you think is best".
---

# Advance CardLens

Autonomous development on a project whose hardest failures were all **confident and wrong**. Every rule here exists because the opposite already happened in this repo.

## 1. Choose

Read in this order and take the highest-value unblocked item:

1. `docs/handoff.md` — what is half-built, what is blocked on the user's device
2. `docs/web-plan.md` — phone/desktop client
3. `docs/performance-plan.md` — request counts, bundle, storage

**Data integrity outranks features.** A bug writing wrong rows into the collection beats anything visible. **Infrastructure outranks features built on it** — splitting a shell after landing features on it means building them twice.

State the choice and why in one line, then go. Do not ask which item unless two are genuinely equal.

## 2. Measure before designing

**If the feature depends on an external source's shape, coverage or quality, probe the live source before choosing a design.**

This is the rule that pays. Twice in one session the measurement invalidated the plan:

- Valuing the collection on pokemontcg.io looked obvious. Measured: 130/130 cards priced in one set, **0/120 and 0/124 in the others**. The design moved to TCGdex before a line was written.
- Per-card price movement looked free. Measured: Cardmarket rounds to the cent on cards worth €0.02–0.04, so one card's week reads as **−50%**. Movement became portfolio-only, with a computed noise floor.

Probe with `curl` + `python` against the live API or the live server. Quote the numbers in the commit message.

## 3. Build

- **Tests fail first.** Break the fix, watch the new test fail, restore. CLAUDE.md: two earlier attempts passed against the bug before one reproduced it. Say in the report which assertions actually discriminate and which are only guards.
- **Shared data layer, split presentation.** Two shells is the goal; two answers to "which printings does this card have" is the failure. Put logic in a hook both use (`useSetView`), not in a screen.
- **Web changes stay in `src/web/` or `[data-shell="web"]`.** The glasses are an additive display — black is transparent, shadows do not render, the type scale is for glance distance. Never restyle a shared token globally.

## 4. Look at it

**For any visual change, screenshot it and read the image.** Do not reason about whether it looks right.

Build, serve with `VITE_USE_MOCKS=true`, drive with Playwright, `Read` the PNG. One pass caught a hard seam down a wide screen, filter chips clipped mid-chip on a phone, and a missing panel edge — none of which were visible in the code.

## 5. Ship and verify

Use the `ship` skill. Then, beyond it:

- **Poll for the run matching THIS sha**, not the latest run. Checking "the most recent run" once reported success from the previous commit.
- **Fetch the deployed asset and grep it for the new code.** Screens are code-split, so the entry bundle is a false negative — follow entry → screen chunk → lazy chunk.
- Server too if `server/` or anything in `tsconfig.node.json` changed. Warm any cache whose version was bumped.

## 6. Report

Lead with what changed and the measured evidence. Then, in the same message and unprompted:

- **What is still not done** from the user's actual ask
- **What is unverified** — emulation is not a device
- **Anything only they can do**

## Red flags — stop

| Thought                                         | Reality                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| "The API surely returns X"                      | Measure it. Two designs died to this in one session.                |
| "It looks fine"                                 | Screenshot it and read the image.                                   |
| "The workflow went green"                       | Green ≠ the code is in the served bundle. Grep the asset.           |
| "Close enough to what they asked"               | Say plainly what you did not do. They will ask otherwise.           |
| "This cache bump is harmless"                   | A bump costs 120–295 upstream requests per set. Shape changes only. |
| "I'll tighten glasses detection while I'm here" | That device cannot be tested here. Leave it and flag it.            |

## Never

- Delete `collection.json` to clear rows — write tombstones (`ship` skill)
- Mix EUR (Cardmarket) and USD (TCGplayer) in one figure
- Duplicate a screen to make it "web" — split only where web outgrows it
- Claim done without running `npm run verify` and `npx playwright test`

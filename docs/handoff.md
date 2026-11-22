# Handoff — where CardLens stands

Current state only, kept short on purpose: every agent reads this first. History,
old session notes and the reasoning behind past decisions are in
`docs/handoff-archive.md` (read it only when a task touches that history).
Procedure is in `docs/runbook.md`; durable rules in `CLAUDE.md`.

**Last refreshed 2026-11-19.** Update this file at the end of any session that
changes what is live, half-built or blocked. Replace stale lines; don't append a
diary (that is what made the old file 63 KB).

## Live

- **Pages front end** (https://vekbui96.github.io/cardlens/) and the **`cardlens`
  server** on SERVER-PC (:8787, Funnel :8443) are both on current `main`.
- **Web/phone is the active surface.** Glasses work is paused (the innovation
  loop's `FOCUS.md` avoids glasses-specific proposals until Ve lifts it). v2 UI is
  built but opt-in.
- **Scanner:**
  - **Camera:** phash first (server `/api/recognize`, device fallback), ~91%
    auto-accept on framed captures.
  - **Unsure camera captures:** sent to Mault for a second opinion (web layout
    only). Mault may only confirm one of phash's candidates.
  - **"Upload photo":** goes through Mault (`/api/cards/identify`), which finds
    the card in the photo, with a manual crop fallback.
  - Details and eval numbers: `docs/scanner.md`.
- **Mault** runs in Docker on SERVER-PC (`D:\services\mault`, loopback :3001)
  with a private patch adding `/cards/photo`; see `docs/server-ops.md` (re-apply
  the patch after any upstream update, and Docker can't pull images unattended).
  Mault is GPLv3: never copy its code into this repo. It is back after a reboot
  only once Ve signs in to Windows (Docker Desktop starts at logon), so photo
  scan reads "offline" until then.
- **Value history** (#112, decision `docs/decisions/value-history.md`): the
  server writes one row a day to `D:\services\data\value-history.json` (kept
  forever, in the nightly data zip); read via `GET /api/value-history` (sync
  token). #117 (the chart) reads it. #110 "Since you last looked" is a
  device-local key `cardlens:v1:last-look:v1`.
- **Biggest movers** (#102) is live on v2 Home; a 7-day / 30-day switch (#121)
  is proposed.
- **Usage metrics** are counts only, `GET /api/metrics/summary?days=N`; events
  in `src/models/metricsEvents.ts`.
- **Innovation loop** (`innovation/`, daily, its own ideas only) proposes issues,
  and builds and deploys them once Ve adds `approved`. Never edit `innovation/` or
  add `approved` as part of other work. It reads the ops hub's plan budget
  (`D:\hub\state\plan-budget.json`), auto-approves slices of an approved spec
  (`/hold` vetoes), and holds up to 5 proposals for review. The hub's dashboard
  (https://server-pc.tail0e4194.ts.net:8444/, tailnet only) ranks them.

## Waiting on Ve

- **PR #63** (scan review: price each printing and the batch total) is open.
- **Loop issues #85 and #96** are `approved` + `loop:failed`: both were built,
  merged, then reverted. Remove `loop:failed` to retry them, or close them.
- **Real phone photos** for a Mault check on real captures:
  `D:\services\mault-trial\photos` (current numbers come from synthetic images).

## Half-built / known gaps

- **Same-art reprints** (~9% of the index) still need a human pick. The
  collector number is the only safe separator, and reading it needs OCR on a
  native-resolution crop (see `docs/scanner.md`). Mault does not close this gap.
- **About 4% of cards are missing from Mault's catalog** (20,500 of ~21,432
  Pokémon EN cards synced).
- **A fresh device gets bursts of 429s on Home**, probably the printings rate
  limit across ~87 sets. Not yet fixed.
- **Value chart #117** is approved and queued for the loop. Spec slices marked
  Manual are done as direct requests; later slices fail until they ship (#117
  failed twice on 2026-11-21 before #112 existed).
- **Riftbound / a second game** is a data-model project (`docs/adding-new-games.md`),
  not started.

## Don't re-litigate

- Glasses input is plain `keydown` only: no hold, no key-up (tested on hardware).
- The phash accept gate `margin >= (distance <= 2 ? 8 : 10)` was measured
  across 123,702 trials. It moves only together with `cardrec/judge.py`.
- Never let Mault alone file a card. It leaked same-art reprints on the eval
  (`src/scan/cameraMault.ts`).
- Collection data is an OR-Set: write tombstones, never delete files.
- Auto-approving loop proposals by score was refused by Claude Code's safety
  check as removing oversight (2026-11-21). The agreed alternative is the hub's
  "Ready to approve" shortlist. Don't rebuild it.

# Spec: Scan

## Purpose

"Point the camera at a pile and add them." The highest-risk screen to rebuild,
because the thing that makes it correct is not in the UI.

> **The recogniser is NOT yours to change.** `src/scan/phash.ts` and its accept
> gate `margin >= (distance <= 2 ? 8 : 10)` are mirrored in `cardrec/judge.py`
> on SERVER-PC, which is not in this repo and not under git. A change to one
> alone is either inert or a silent parity break. v2 rebuilds the SCREEN only.

## Parity checklist

From `src/web/scan/ScanScreen.tsx`, `ScanCardPicker.tsx`, `ScanFinishes.tsx`.

- [ ] Server-first, device-always: POST each capture to `/api/recognize`, fall
      back to the local hash on any failure that is not a rejected token.
- [ ] Every capture records **which recogniser answered** — a silent failover
      must not look like the server working.
- [ ] Auto-capture on a NEW subject, not any change: settle, `MIN_DETAIL >= 16`
      (measured: 160 real cards min 22.4/median 42.3; empty frames under 11.4),
      and differ from the last CAPTURED hash — or the guide was visibly empty.
- [ ] Captures go as **PNG** at 245x342.
- [ ] An unsettled row **shows** the collector number, cropped from the video at
      camera resolution (~31px tall), placed under "Which one?" and above the
      candidates. It is never read by OCR — reading it would introduce a way to
      file the wrong card silently.
- [ ] The crop is released as soon as a row settles.
- [ ] A row can be named by hand ("Pick by set"), from the in-memory index, at
      **no network cost** — this is the repair path for when recognition failed.
- [ ] Manual choice sits beside the result, never overwriting it.
- [ ] Finish chips come from the printings oracle, one request per set across
      the batch, falling back to Normal/Reverse while loading.
- [ ] Batch review, then one write.
- [ ] Never un-mark a card already owned.
- [ ] The preview does not resize when a card is captured.

**Dropped on purpose:** nothing. Ask before dropping anything here.

## Data

`/api/recognize` (rate limit 300/min; a burst tops ~85/min per device), the
shipped card index, `/api/printings/:setId` per set in the batch.

## States

Camera denied · no camera · index loading · index failed (fall back, say so) ·
scanning · settled confidently · AMBIGUOUS (1,730 of 20,205 cards) · server
unreachable (device answered) · token rejected (do not fall back) · batch review
· committing.

## Layout

390: viewfinder over review strip. 1440: viewfinder left, decisions two across;
the number band must not become a slab (it once rendered 1055x230 and pushed the
candidates it exists to be read beside off screen).

## Acceptance

- [ ] With the server reachable, the server's verdict is used and recorded.
- [ ] With it unreachable, the device answers and the row says which.
- [ ] A rejected token does NOT silently fall back.
- [ ] An empty mat does not trigger a capture.
- [ ] A hand straightening a scanned card does not re-scan it.
- [ ] An ambiguous row shows the number band above the candidates.
- [ ] Ten rows from one set cost one printings request.
- [ ] Committing a batch writes each row once, and never clears an owned row.

## Out of scope

Anything under `src/scan/`. Report bugs there; do not fix them here.

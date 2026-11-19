# Scanner and recognition

Moved out of CLAUDE.md; read when touching `src/scan/`, `ScanScreen`, `/api/recognize`, the card index, or the accept gate.

- **The scanner is server-first, device-always** (changed 2026-08-10; it was
  device-only before). `src/web/scan/ScanScreen.tsx` POSTs each capture to
  `/api/recognize` and falls back to `src/scan/phash.ts` on any failure that is
  not a rejected token. Both sides run the same hash over the same index file —
  the Python one is a line-by-line port with a parity test — so the answers are
  identical today. The server exists on this path so it can be given a bigger
  index, better hashing, or card detection **without reshipping the Pages
  bundle**; 1,730 of 20,205 cards (8.6%) come back AMBIGUOUS and that is the gap.
  - **OCR is NOT in that list, and believing it is costs a wasted week.**
    `recogniseRemote` uploads the same **245x342** canvas the hash was taken
    from — deliberately, so the server hashes exactly what the device would.
    A collector number is ~2.5% of card height: **~8px** at that size, below
    every OCR engine's floor, against **~31px** in the 886x1237 the guide crop
    actually holds. The server can be given the OCR logic; it can never be given
    the pixels. Reading the number needs a second, native-resolution crop sent
    from the client — a Pages deploy, unavoidably. Measured 2026-08-28.
  - **Only 652 of the 1,730 are exact hash ties.** The other 1,078 sit 2-7 bits
    from their nearest neighbour, so "no better hash can touch them" is false
    for 62% of the gap. The hash is 64-bit and greyscale only (`phash.ts`
    Rec. 601 luma). Measure what a chroma channel or 128 bits does to those 1,078
    BEFORE scoping OCR — it needs no client change, no dependency, and adds no
    false-accept surface. If it works, OCR's target shrinks to 3.2%.
  - A perfect OCR would take auto-accept from 91.4% to **99.6%**: the collector
    number alone separates 1,639 of the 1,730 (94.7%). Of the 91 that survive,
    73 fall to the printed denominator and **18 are irreducible** — Gym Heroes
    vs Gym Challenge basic Energy share art, number and set total alike.
  - The fallback is not optional. SERVER-PC has been found powered off twice,
    and every capture records which recogniser answered so a silent failover
    cannot be mistaken for the server working.
  - Captures go as **PNG**, not JPEG: 245×342 is small either way, and lossless
    bytes are what make "server and device agree" testable rather than hopeful.
  - `/api/recognize` is rate-limited at **300/min**, not the usual 60 — a scan
    burst tops out near 85/min per device and 60 throttled ordinary use.

- **Auto-capture fires on a NEW subject, not on any change.** Three gates, in
  `src/scan/autoCapture.ts`: the frame must settle, hold enough detail to be a
  card at all (`MIN_DETAIL`), and differ from the last _captured_ hash
  (`NEW_SUBJECT_BITS`) — or the guide must have been visibly empty since.
  - `MIN_DETAIL = 16` is **measured**, not chosen: `node scripts/measure-detail.mjs`
    puts 160 real cards at min 22.4 / median 42.3 and every synthetic empty frame
    (mat, woodgrain, lit desk, a hand) under 11.4. Re-run it before touching the
    number. A perceptual hash **cannot** answer "is anything there" — it compares
    a region against its own median, so a bare desk hashes as confidently as a
    Charizard, which is why the old rule photographed the mat between every pair
    of cards.
  - Comparing against the last _frame_ is not enough. A hand reaching in to
    straighten an already-scanned card re-armed the shutter and scanned it twice.

- **The accept gate is ASYMMETRIC, and both recognisers carry it.**
  `margin >= (distance <= 2 ? 8 : 10)` — `MIN_MARGIN` / `MIN_MARGIN_DRIFTED` /
  `NEAR_EXACT` in `src/scan/phash.ts`, mirrored in `cardrec/judge.py` on
  SERVER-PC. Scanning is server-first and the client trusts the server's
  verdict, so **these must always move together**; a change to one alone is
  either inert or a silent parity break. The Python is not in this repo and not
  under git — see `docs/handoff.md`.
  - A blanket `MIN_MARGIN = 8` produced **2 false accepts** at 20,205 cards
    (`ex3-86` filed as `pop3-11`, `bw2-32` as `mcd12-6`), both at distance 4
    under crop error. It was clean at 1,709 cards: **a gate measured against a
    small index expires when the index grows.** `validate-recognition.mjs`
    builds its own index from the sets it is given and structurally cannot see
    crowding — re-run `scripts/measure-gate-safety.mjs` after every
    `build-card-index.mjs all`.
  - A blanket 10 was measured and **rejected**: same safety, but it refuses 312
    cards a perfect capture would have matched. The asymmetric rule costs none
    of them, because a flawless capture sits at distance 0.
  - **A measurement whose answer must be zero cannot be taken on a sample** —
    the second leak fell outside a stride sample and was missed entirely.
- **An unsettled row SHOWS the card's collector number, and never reads it.** 1,730 of 20,205 cards are reprints with identical artwork, and the printed
  number is usually the only thing separating them — but OCR to read it is
  blocked on pixels the server never receives (see above). So `numberBandRect`
  (`src/scan/frame.ts`) crops the band from the VIDEO at camera resolution —
  ~31px tall on a 1080p frame against ~8px in the 245x342 recognition canvas —
  and `ScanScreen` puts it directly under "Which one?" and above the candidates,
  so you read the number and then choose. **Reading it would introduce a way to
  file the wrong card silently; showing it cannot.** The band takes the full
  width of the bottom sixth rather than a per-era rectangle: the number is
  bottom-left on modern cards, bottom-right on most older ones, promos carry an
  alphanumeric with no denominator, and the card index stores no geometry to
  drive a tighter crop. It sits entirely below `ART_WINDOW`, so it can never
  perturb a hash. The crop is released as soon as a row settles confidently, so
  a batch of thirty does not hold thirty full-resolution images it will never
  show.
- **A row can be named by hand** (`src/web/scan/ScanCardPicker.tsx`, "Pick by set"). It reads the in-memory index — set list, collector numbers, names — so
  browsing 20,205 cards costs **no network**, which matters because this is the
  repair path for when recognition already failed. `Capture.manual` sits beside
  `result` rather than overwriting it, so correcting a row does not throw away
  the candidates you might want back.

- **Finish chips in review come from the printings oracle**, not a fixed
  Normal/Reverse pair (`src/web/scan/ScanFinishes.tsx`). One component per row
  because printings are per SET and a batch spans several; React Query keys on
  the set, so ten rows from one set cost one request. Falls back to
  Normal/Reverse while loading — a row with no finishes cannot be committed, so
  an absent server would make scanned cards silently unaddable.

- **A photo can be uploaded instead of captured** ("Upload photo" on the web
  scan screen; `src/scan/photoIdentify.ts`, `POST /api/cards/identify`,
  `server/mault.ts`). A gallery or phone-camera photo is framed however it was
  taken, which the phash index cannot match, so it goes to a second engine:
  **Mault**, self-hosted on SERVER-PC (docker, loopback :3001), which
  finds the card in the photo, straightens it and matches an image embedding. Each photo becomes an
  ordinary review row (candidates, finish chips, Pick by set) with
  `via: "mault"` and a `scan.via.mault` count. **There is no device fallback
  for a photo**: offline or unconfigured shows an inline note on the row with
  Retry, and Pick by set still works from the local index.
  - **Ids are translated, never trusted.** Mault speaks TCGdex ids
    (`sv03.5-006`), CardLens pokemontcg.io (`sv3pt5-6`). `server/tcgdexIds.ts`
    only GENERATES candidates (unpadding, `.5` → `pt5` or `5`, a tiny alias
    table); one counts only if it exists in `public/card-index/cards-*.json`.
    Anything that resolves nowhere is dropped, not guessed.
  - **The gate is conservative and server-side** (`judgeMault`): accept only
    when the top match resolved, its name agrees with ours, confidence
    `>= 0.95`, distance `<= 0.25`, and the raw runner-up is `>= 0.05` further
    away AND under `0.5` confidence. Mault's `confidence` is per candidate, not
    a softmax: **same-art reprints both score ~0.999** within ~0.003 distance,
    which is why the runner-up test exists. Measured 2026-11-18 on 34 renders:
    31/34 top-1 correct, 19 auto-accepted, **0 false accepts**; every miss
    (bw11-52 → bw4-51, mcd12-6 → bw2-32, xyp-XY39 → xy5-108) and every
    same-art pair lands as "Which one?" with both offered. Renders are not
    photos: re-measure with real phone photos before loosening any of it.
  - **Finding the card is Mault's job, through a local patch.** Upstream
    `POST /cards` embeds the WHOLE upload (its own apps detect and crop on the
    client), so a casually framed photo never matched. Our Mault carries
    `POST /cards/photo` (`D:\services\mault\patches-local\`, details in
    `docs/server-ops.md`): the Pi host's corner detector, a perspective dewarp,
    then the same match on both the straightened card and the whole image (a
    tight crop or scan is already the card); the nearer answer wins.
    `MaultClient` asks `/cards/photo` and falls back to `/cards` for the life of
    the process on a 404, so an un-patched Mault still answers (badly).
    Measured 2026-11-19 through CardLens's own gate, 34 cards each
    (`D:\services\mault-trial\eval-photo.mts`):

    | set                        | route          | top-1     | gate-accepted | false accepts | outline found |
    | -------------------------- | -------------- | --------- | ------------- | ------------- | ------------- |
    | photo-like                 | `/cards`       | 2/34      | 0             | 0             | —             |
    | photo-like                 | `/cards/photo` | **27/34** | **16**        | **0**         | 33/34         |
    | clean renders (full frame) | `/cards`       | 31/34     | 19            | 0             | —             |
    | clean renders (full frame) | `/cards/photo` | 31/34     | 19            | 0             | 31/34         |

    Photo-like = each render tilted ±15°, mild perspective, card 40–70% of the
    frame height, plain/gradient/textured backgrounds, uneven light and noise,
    1600px long edge, JPEG ~85 (`D:\services\mault-trial\make-photo-like.py`,
    seeded). Same-art pairs stayed "Which one?" on both sets. Photo-like
    misses: the three Mault always misses (above), plus bw4-51 → bwp-BW38,
    gym2-132 and dp1-120 (outline found, wrong card) and smp-SM60 (no outline).
    Still synthetic: re-measure on real photos before loosening the gate.

  - **No outline found → crop by hand** (`src/web/scan/PhotoCrop.tsx`,
    `src/scan/cropBox.ts`, web layout only). The reply carries `outlineFound`
    (absent from an un-patched Mault, meaning "cannot say", never "no") and
    the `outline` it used. `false` with nothing confident opens a crop box on
    the row by itself, once; every photo row also has a **Crop** chip. The box
    is dragged, or resized by 44px corner handles (arrows / Shift+arrows on a
    keyboard), seeded from the outline, the last crop, or a card-shaped box in
    the middle. The crop is cut from the ORIGINAL upload and identified again
    on the same row (candidates, finish chips, Pick by set reused; the note
    starts "Cropped"). Mault straightens the crop too, so a loose box around a
    tilted card is fine.
  - Mault's unsure answer (`data: null`, `diagnostics.candidates`) has no
    confidence at all: those candidates carry `confidence: null`, show as "best
    guess", and the reason reads "Mault isn't sure — pick the right card", not
    "only 0% sure".
  - An unsettled photo row shows the whole photo (720px) in place of the
    camera's number band — there is no guide, so no band to crop. Shown, never
    read, same rule as the band.

- **The camera asks Mault too — but only to CONFIRM, and never on a reprint**
  (2026-11-19; `src/scan/cameraMault.ts`, `ScanScreen` `secondOpinion`).
  phash stays first: a confident phash answer settles the row and Mault is
  never called, so the captures that settle on artwork pay no extra latency.
  Otherwise the row shows phash's "Which one?" at once ("· asking Mault…") and
  the client sends a native-resolution crop of the guide — taken from the
  video in the same frame as the hash, long edge capped at 1200, JPEG 0.9,
  only encoded if phash was unsure, dropped when the answer lands — to the
  ordinary `/api/cards/identify` (no server change; `/cards/photo` finds the
  card or matches the whole crop). Timeout is `RECOGNISE_TIMEOUT_MS` (6s).
  Offline, slow, 429 or refused → the row stays exactly as phash left it, no
  note, no toast. The row auto-accepts only when ALL hold:
  1. Mault's own gate (`judgeMault`) says MATCHED;
  2. Mault's card is one of phash's candidates;
  3. no other card on the row (phash's or Mault's) shares its name;
  4. the card has no same-name look-alike within `LOOKALIKE_BITS = 12` in the
     loaded index (no index → no confirmation).
     Anything else stays "Which one?" with a merged, de-duplicated list (max 5;
     Mault's order first when it is confident). Rows record `server+mault` /
     `device+mault` ("Server + Mault"); counts `scan.via.camera_mault` and
     `scan.camera_mault.confirmed` sit beside `scan.via.server/device`, and the
     outcome (`scan.accepted/ambiguous/unknown`) is counted once, after Mault. A
     choice made in review before Mault answers is never overwritten. Web only:
     the glasses route `scan` to Collection, and the v2 scan screen has its own
     capture code and is untouched.
  - **Why 3 and 4 exist: 1+2 alone filed the wrong card twice.**
    `cel25c-93_A` as `ex15-93` and `tk2a-5` as `ex8-40`: same-art reprints
    where Mault's collection lacks one twin, so its runner-up test sees no
    rival and it is "99% sure" of the twin it knows. Mault alone (its gate,
    up to conf >= 0.98 / dist <= 0.15) leaked on the same pairs. At
    conf >= 0.99 / dist <= 0.12 it happened not to leak on 444 captures,
    but the mechanism (a twin missing from Mault) is untouched by any
    threshold and a zero on a sample proves nothing, so "Mault alone with a
    stricter bar" was rejected.
  - **Measured on a simulated guide crop** (`D:\services\mault-trial\guide\`,
    not in git: `make-guide-crops.py` → `collect.mts` → `verify-shipped.mts`).
    222 cards — the 34 trial renders, plus a seeded sample of 142 of the
    1,842 cards a perfect capture leaves AMBIGUOUS at index 62723f91 (drawn
    with their nearest twin) and 46 random others, as pokemontcg.io hires
    art — each placed in a 1080x1920 frame on the guide (886x1237) in two
    variants: _aligned_ (scale ±3%, offset ±1.5%, ±1.5°,
    blur ≤0.6px) and _sloppy_ (scale −8/+6%, offset ±4%, ±4°, blur ≤1.5px),
    with backgrounds, uneven light and noise; phash on the 245x342 PNG via
    `:8200`, Mault on the native crop via `/cards/photo`.

    | captures              | n   | phash auto / false | Mault alone auto / false | combined auto / false |
    | --------------------- | --- | ------------------ | ------------------------ | --------------------- |
    | aligned               | 222 | 24 / 0             | 62 / **2**               | **55 / 0**            |
    | sloppy                | 222 | 1 / 0              | 53 / **1**               | **27 / 0**            |
    | the 34 renders (both) | 68  | 7 / 0              | 33 / 0                   | 22 / 0                |
    | same-art twins (both) | 304 | 0 / 0              | 16 / **3**               | 2 / 0                 |
    | other cards (both)    | 140 | 25 / 0             | 99 / 0                   | 80 / 0                |
    | all                   | 444 | 25 / 0             | 115 / 3                  | **82 / 0**            |

    So the gain is on captures phash is unsure of because of the CAPTURE
    (blur, tilt, misalignment): of the 115 such non-twin captures, 55 now
    settle, with zero false accepts. **It does not shrink the reprint gap**:
    2 of 304 twin captures settle (both different-name near neighbours), and
    that is deliberate — the collector number is still the only safe
    separator there. The simulation is harsher than real use (phash accepted
    only 25/444; on real cards it settles far more), so read the columns
    against each other, not as field rates. Mault on the 245x342 PNG instead
    of the native crop scored about the same here (top-1 335 vs 339 of 444)
    because the renders are only 734px; a real camera frame has more detail
    than either, and the crop is sent only for unsure captures.

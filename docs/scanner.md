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

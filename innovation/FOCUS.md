# Focus

<!--
Ve's steering for the loop's proposals (LOOP.md section 5). Edit freely; keep it short.
The loop reads this file and never writes it. Empty or missing = no steering.
It weights what the loop proposes; it does not change what the loop may build (LOOP.md rules 7 and 8 still apply).
-->

## Temporary override (set 2026-11-17; expires after 3 new proposals or on 2026-11-24, whichever is first)

For the next ~3 new proposals, **new user-facing features and UI improvements come first**, ahead of every
priority below (performance, reliability and robustness tests wait). Rules while this is active:

- Pick features that fit **PRODUCT.md** (its users, jobs to be done, principles and bets); single-user, no
  accounts or multi-tenant ideas. A "Bets" item is fine as a small first step or as Manual / needs Ve.
- Every UI change must respect **both interaction models** (CLAUDE.md "Two interaction models"):
  glasses = 600x600 additive display (black is transparent), focus ring, gestures only (arrows / Enter /
  Escape, keydown only, no hold); web = touch, focus ring off, 44px tap targets. Say in the proposal how
  it behaves on each, or why it is web-only / glasses-only.
- The Avoid list below still applies in full.
- To tell whether it has expired: count `loop:proposal` issues numbered above #51 (the newest when this
  was set). Once 3 exist, or after 2026-11-24, ignore this section and use the normal priorities below.

## Priorities (in order)

1. **The glasses experience**: legibility at 600×600, gesture flows (arrows / Enter / Escape only; no hold,
   no key-up), focus behaviour, fewer rows of chrome.
2. **Performance**: Home and collection load time; pricing coverage and reliability against flaky
   pokemontcg.io (server caching, partial success); bundle size and lazy chunks on Pages.
3. **Binder and trade-binder UX** on phone / web.
4. **Robustness tests** around sync, storage round-trips and parsing.

## Avoid

- Recognition, the card index, scanner gate constants (`phash.ts` / `judge.py` parity)
- `/api/target/*`
- Sync merge / validation rules
- Cache-version bumps
- Secrets, `.env`, NSSM
- New dependencies, unless clearly worth a manual step
- Anything that changes the shape of stored data

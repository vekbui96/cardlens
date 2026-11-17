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
- Target the **web / phone UI** (touch, focus ring off, 44px tap targets). No glasses work for now (see
  Avoid). A shared-screen change must still not break the glasses: say in the proposal that the glasses
  behaviour is unchanged.
- The Avoid list below still applies in full.
- To tell whether it has expired: count `loop:proposal` issues numbered above #51 (the newest when this
  was set). Once 3 exist, or after 2026-11-24, ignore this section and use the normal priorities below.

## Priorities (in order)

1. ~~The glasses experience~~ (paused, see Avoid).
2. **Performance**: Home and collection load time; pricing coverage and reliability against flaky
   pokemontcg.io (server caching, partial success); bundle size and lazy chunks on Pages.
3. **Binder and trade-binder UX** on phone / web.
4. **Robustness tests** around sync, storage round-trips and parsing.

## Avoid

- **Glasses-specific proposals** (set 2026-11-17 by Ve, until Ve removes this line): no new glasses
  features, glasses UI, gesture flows or glasses-only fixes. Web / phone work only; a shared change must
  leave the glasses behaviour as it is.
- Recognition, the card index, scanner gate constants (`phash.ts` / `judge.py` parity)
- `/api/target/*`
- Sync merge / validation rules
- Cache-version bumps
- Secrets, `.env`, NSSM
- New dependencies, unless clearly worth a manual step
- Anything that changes the shape of stored data

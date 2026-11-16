# Focus

<!--
Ve's steering for the loop's proposals (LOOP.md section 5). Edit freely; keep it short.
The loop reads this file and never writes it. Empty or missing = no steering.
It weights what the loop proposes; it does not change what the loop may build (LOOP.md rules 7 and 8 still apply).
-->

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

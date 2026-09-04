# Spec: Target watchlist & sealed prices

Two small screens, one stream. Both are thin clients over things that live
elsewhere.

## Purpose

- **Target** — "tell me when this restocks", plus whether the bot is alive.
- **Sealed** — current sealed product prices for the sets you collect.

## Parity checklist

From `src/web/target/WebTargetScreen.tsx`, `src/web/collection/WebSealedScreen.tsx`.

### Target

- [ ] Watchlist: add by URL or product id, list, remove.
- [ ] The bot's own health, shown plainly.
- [ ] Connect flow when there is no token, with its own message.
- [ ] **`TARGET_TOKEN` is a different token from `COLLECTION_TOKEN`** and they
      are not interchangeable — these routes can add items to a real cart.
- [ ] Says clearly when the bot is not running. It is a scheduled task in an
      interactive session, not a service, so "SERVER-PC signed out" is a normal
      and expected failure and must read as one rather than as an app error.

### Sealed

- [ ] Sealed products for collected sets, with prices.
- [ ] Says which are unpriced rather than showing zero.

## Data

`/api/target/*` (proxied to the bot's loopback API on :8788) and the sealed
price endpoint. Both can be down independently of the app.

## States

No token · token rejected · bot unreachable / not running · empty watchlist ·
watchlist with items · adding · add failed · unpriced products.

## Layout

390 and 1440: a form and a list. These do not need a bespoke layout; they are
`Panel` + `Stack` + `Card` and should prove the primitives are enough.

## Acceptance

- [ ] With no token, both screens say what to do, and neither looks broken.
- [ ] With the bot down, Target says the bot is down — not "failed to load".
- [ ] The Target token is never read from or written to the collection token's
      storage key.
- [ ] Adding an item is confirmed, and a failure says why.
- [ ] An unpriced sealed product shows "Unavailable", not `$0.00`.

## Out of scope

`server/targetBot.ts` and the bot itself.

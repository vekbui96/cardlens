# CardLens privacy

CardLens is designed to collect as little as possible.

## What is stored, and where

**On your device only** (`localStorage`, versioned under `cardlens:v1:*`):

- Favorite cards
- Recent searches
- Recently viewed cards
- Cached card details and prices (to load faster and reduce network use)
- Display preferences

This data never leaves your device. Clearing it (DevPanel → **Clear local storage**, or your
browser's site-data controls) removes it permanently.

## What is NOT used

- **No camera.** CardLens does not scan cards or use the glasses camera.
- **No microphone.**
- **No location.**
- **No accounts.** No sign-up, no login.
- **No analytics or tracking** by default.
- **No payment information** is ever collected or stored.
- **No advertising identifiers.**

## Network requests

CardLens fetches card data and prices from the public **pokemontcg.io** API (which sources prices
from TCGplayer/Cardmarket). These requests contain only the card search terms and IDs needed to show
results — no personal identifiers.

Card images are loaded through a public image-resizing CDN (**wsrv.nl**) so thumbnails download
quickly on a wearable connection. Only the (non-personal) image URL is sent. Set the image proxy to
empty in configuration to load images directly from pokemontcg.io instead.

## Companion-phone input (optional)

If you use the phone companion to type a search:

- A **short-lived session** (a few minutes) links your glasses to your phone via a one-time code.
- The only data exchanged is the **search text** you type.
- Sessions **expire automatically** and are **not stored permanently**. One session cannot read
  another's data.
- No account is required.

## Security posture

- Production is served over **HTTPS only**.
- The frontend contains **no API secrets**. Any API key lives server-side in the optional proxy.
- Companion sessions are short-lived, random, and rate-limited; inputs are sanitized and escaped.

## Your controls

- Remove all local data anytime via the DevPanel **Clear local storage** button or your browser
  settings.
- Because there are no accounts and no server-side profile, there is nothing else to delete.

_Last reviewed: 2026-07-11. CardLens is an independent project and is not affiliated with, endorsed
by, or sponsored by Nintendo, The Pokémon Company, TCGplayer, or Meta._

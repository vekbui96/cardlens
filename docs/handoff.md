# Session handoff — CardLens

Written at the end of a long session so the next one can start without re-deriving anything. If something is BROKEN or you are deploying, go to `docs/runbook.md` instead — this file is state, that one is procedure. Read `CLAUDE.md` first — it holds the repo's traps and measurements. This file is only "where things stand right now".

**Everything below is committed, pushed, deployed and verified unless it says otherwise.**

---

## Most recent work — the binders list is a shelf (2026-09-04)

**Shipped as `b5fe606`, Pages only, verified live.** No server or model change —
the diff is `src/web/binders/` plus one e2e expectation, so nothing in
`tsconfig.node.json` moved and `D:\services\cardlens` did not need touching.

The list drew each binder as a 56px row of words. Six binders read as six grey
bars, so it now draws a **real page from the binder** at pocket scale — the
first page holding anything, so a binder filled from page 3 does not show twelve
empty pockets.

- **The cover costs no fetch.** `CardSlot` already carries `imageSmall`
  denormalised (it exists so a page can paint offline), so the art is what the
  binder is already holding. Thumbnails are `loading="lazy"` — a 12-pocket cover
  is twelve of them and the screen can hold several binders.
- **The cover is decorative in full**: `alt=""` throughout and `aria-hidden` on
  the page around it. The tile's button carries the name, format and fill in
  words. A `getByRole("img")` passing on this screen means that regressed, and
  there is a test that says so.
- **One height, per-format width.** `.coverFrame` fixes the height and the page
  carries `aspect-ratio: cols*5 / rows*7`, so a 12-pocket page is visibly wider
  than a 9-pocket one. Sizing the pocket instead made a 4-pocket cover TALLER
  than a 12-pocket one, which is backwards on a shelf. Note 9-pocket and
  4-pocket share an outline — both are square grids of 5:7 cards — and that is
  correct: what differs is the pocket size, which is the whole point of the
  format.
- **Delete asks now.** It was a bare red word beside the name with no undo, and
  the tombstone is written precisely so the deletion survives a sync — a
  misclick propagated to every device. Accessible names are `Delete <name>` and
  `Confirm delete <name>`; `e2e/binders.spec.ts` and the unit tests use both.
- **The create form is the last tile**, not a banner above everything. It spans
  two columns at >= 1000px because three format chips measure 266px against a
  248px tile and wrapped two-and-one.
- **The list has its own stylesheet now.** It had been borrowing
  `WebBinderScreen.module.css` for eight class names, which is why it looked
  like a settings form; those eight were removed from the builder's sheet and
  nothing else referenced them.

**Trap worth keeping, for anyone verifying a screen visually:** Playwright's
`webServer` has `reuseExistingServer: !CI` and sets `VITE_USE_MOCKS=true`. A dev
server you started yourself with plain `npm run dev` gets reused WITHOUT that
env, and the set pickers come back empty — which reads as a broken selector, not
as a missing mock. Two binder specs failed this way before the stray server was
killed. Kill port 5173 before running e2e.

## Earlier — the trade binder and 4-pocket (2026-08-28)

**Shipped as `8f82cbe`, both targets, verified live.** Pages serves a bundle
containing `4-pocket` and the lazy `TradeShareScreen` chunk; the server answers
`POST /api/share/binder` with 401 rather than 404, so the route exists rather
than hitting a catch-all. No new npm dependency and no `.env` change.

Note the commit message names the trade binder and 4-pocket but the commit also
carries the **binder value on the list** feature and two extractions
(`marketPrice.ts`, `binderValue.ts`). History was left alone rather than
rewritten on a pushed `main`.

**The server step mattered more than usual here.** Until it updated, its
`parseBinder` rejected `format: "4"` — so a 4-pocket binder would have synced up
and been silently dropped. Frontend-newer-than-server is normally survivable in
this app; it is NOT survivable for a new enum value the server has to accept.
A binder can now be offered for trade: copies and condition per pocket, a total
priced per copy, and a public revocable link. `CLAUDE.md` holds the durable
rules; the state of play is:

- **`forTrade` on the binder, `quantity` + `condition` on a card slot.** Not a
  second kind of object — see CLAUDE.md for why, and for why none of the three
  is written when it holds its default.
- **`#/trade/:shareId`** is the recipient's page. No token, no collection, no
  account. Two views of one binder — the binder as laid out, and a list sorted
  by value — bound together by the **pocket address** (`2·5`), which is how the
  two collectors will actually name a card to each other. Tapping a list row
  scrolls to that pocket and lights it.
- **Validation now lives in `src/models/binderParse.ts`**, shared by the server
  and the trade page. This was a move, not a rewrite: `server/binderStore.ts`
  re-exports `parseSlot` / `parseBinder` / `MAX_BINDERS_PER_REQUEST`, and
  `IMAGE_ID_PATTERN` moved with it (re-exported from `binderImages.ts`). It is
  in `tsconfig.node.json`.
- **`Share` is a tagged union now.** Legacy untagged rows read as set shares —
  there is a live `shares.json` on the server full of them, and it is covered by
  a test rather than assumed.
- **Fixed on the way past: binder spreads were broken on phones.** Page 1 sat at
  half width against an empty half-screen, in the BUILDER as well, for as long
  as spreads have existed. Cause is in the traps list below. Regression test is
  `e2e/binders.spec.ts` "opens page 1 at full width once the spread stacks", and
  it was confirmed to fail without the fix.
- **Not built, deliberately: condition does not adjust a price.** The oracles
  publish one market price per printing and never say what condition it assumes,
  so a multiplier would be invented. It is displayed and left to the traders.
- **Nothing has been traded between two real people yet.** The link is exercised
  end to end against a real server in `e2e/trade.spec.ts` — push, mint, open
  with no token, revoke — but nobody has sent one to another collector.

## Web UI, reshaped (2026-08-29)

**Shipped through `6db47d3`; the desktop pass is committed as `e572886` and NOT
yet pushed.**

- **Sets and Collection are one screen on the web.** They were two menu entries
  answering nearly the same question, and Collection was a subset of Sets with a
  different row design. `#/sets` still resolves and lights the Collection entry,
  so pasted links keep working. The GLASSES keep their own `CollectionScreen` —
  600x600 has room for a progress list and nothing else.
- **The value panel folds to the five most valuable sets**, with the remainder
  named and priced on the expander rather than merely hidden. It printed a row
  per set before — nineteen of them, above the list the screen exists for.
- **A binder's own settings live behind a Settings disclosure** (pocket size,
  show-value-in-list, trading). Add page / Remove page stay on the toolbar: the
  row was mixing things pressed constantly with things decided once. What is
  switched on shows as a gold tag with the panel shut.
- **The web app now has a real desktop layout.** `@media (min-width: 1000px)`
  was already the convention and seven stylesheets used it; the rest read as a
  phone with the sides pulled out. Binder toolbar no longer stacks, pockets are
  capped near the 238px a 63x88mm card occupies at 96dpi, and a cover spread
  draws a leaf in the empty track instead of a void.
  - Two real defects surfaced that were not about width: the showcase drew
    **54px of card art inside a 380px pocket** (CardImage hard-codes a 54x76
    thumb, so a tile's `width: 100%` means 100% of that), and the scan screen's
    collector-number band rendered **1055x230**, pushing the candidate buttons
    it exists to be read beside off the bottom of the window.
  - Nothing below 1000px changed. The phone is the layout confirmed on hardware.

**`.claude/agents/` now holds `cardlens-frontend` and `cardlens-backend`**, so
work routes to a brief that already knows this repo's traps. Agent definitions
are read at session start — a newly added one is not available until the next
session.

## The scanner's accept gate leaked, and is now asymmetric (2026-08-29)

**Decided and shipped to BOTH recognisers.** The rule is
`margin >= (distance <= 2 ? 8 : 10)`.
Measured this session by `scripts/measure-gate-safety.mjs` (121,230 trials —
20,205 cards x 6 distortions, searched against the SHIPPED index, parity
confirmed 0/20,205 against `index-6defdc2b.bin`):

- **The shipped 16/8 gate produces 2 false accepts.** `ex3-86` files as
  `pop3-11`; `bw2-32` files as `mcd12-6`. Both at distance 4 — the most
  confident end of the accept region — under crop error.
- **They are not a knife-edge artefact.** Re-rendered across a band of crop
  error, margin 8 fires 11 times on these two cards and is WRONG 9 of those 11
  (2.5%-5% symmetric, plus off-centre). `phash.ts` itself notes the quad
  detector is never exact, and the failure band straddles the 3% the author
  called typical.
- **Margin 8 has zero headroom.** Wrong top-1 hits achieve margins of 8 and 9.
- **The leak is systematic, not specific to this index.** Uniform subsets: 0 of
  9 seeds leak below 5,000 cards; 9 of 10 leak at >= 8,000. The index crossed
  that band in one rebuild (1,709 -> 20,205).
- `MAX_DISTANCE` is NOT a lever — 10/16/20/24 leak identically at every margin.
- **A blanket `MIN_MARGIN = 10` was measured first and REJECTED.** It reaches 0
  fitted leaks but costs 312 cards that a PERFECT capture would have matched,
  because on a flawless capture the true hit sits at distance 0 and its margin
  is whatever the catalog gave it. And it is not immunity: on a HELD-OUT battery
  of five geometric distortions it was not fitted to, blanket 8 leaks 13 times
  and blanket 10 still leaks twice.
- **What shipped instead:** `margin >= (distance <= 2 ? 8 : 10)`. Measured on
  the same trials it is a strict improvement on blanket 10 in every direction —
  auto-accept 37.4% vs 36.7%, 0 fitted leaks either way, MATCHED **91.4% vs
  89.9%**, and **0 cards lost vs 312** — and it is identical to blanket 10 on
  the held-out battery (the same 2 leaks, the same 2 cards).
- **The boundary is measured, not tuned.** Wrong top-1 hits reach a margin of at
  most 2 at distance 0 and 6 at distance 2, but 9 at distance 4. Widening
  `NEAR_EXACT` to 4 re-admits both original leaks.
- **Still not immunity.** Only a margin of 11 reached zero on the held-out
  battery, and it costs 1,408 cards. Every count here is a FLOOR: the batteries
  are synthetic transforms of the same catalog images that built the index, and
  a real camera adds noise, wear and colour cast — all of which push a query
  away from its own entry, the direction that creates false accepts.
  **Both recognisers carry it, and they had to move together.** `cardrec/judge.py`
  on SERVER-PC (`D:\services\recognition\cardrec\`, **NOT in this repo and NOT
  under git at all**) mirrors the constants, and `remoteRecognize` trusts the
  server's verdict (`confident: reply.status === "MATCHED"`). Scanning is
  server-first, so a TypeScript-only change would have tightened the offline
  fallback, left the normal path leaking, and broken the parity test. Ported
  2026-08-29, its 18 tests re-run there, `recognition` restarted, and the live
  process verified to refuse both known leaks while still trusting a near-exact
  hit at margin 8. A backup of the original sits at `cardrec/judge.py.bak-gate`.

**That directory being outside version control is a real risk** — the only copy
of the recogniser lives on one machine that has been found powered off twice.
Worth putting under git.
**Two traps worth keeping:**

- **A gate measured against a small index expires when the index grows.**
  `validate-recognition.mjs` builds its own index from the sets it is given, so
  it structurally cannot see crowding. Re-run `measure-gate-safety.mjs` after
  every `build-card-index.mjs all`.
- **Sampling hid one of the two leaks.** `bw2-32` fell outside a stride sample.
  A measurement whose answer must be zero cannot be taken on a sample.

## Earlier — Home performance (2026-08-27)

Home was measured on the live site before anything was changed, and the measuring
is the part worth repeating: `.claude/skills/optimizing-cardlens/SKILL.md` has
the procedure.

What it found and what was done:

- Home priced the collection by asking `/api/catalog/cards` **once per set** —
  nineteen calls, 4.5–6.7s each, several failing and retrying at 9s and 18s,
  settling on "480 of 973 printings priced". Now one `/api/catalog/prices` call
  against a 12-hour disk cache: **213ms median, 4ms on a revisit inside the hour.**
- **No response this server sent was compressed.** `compression()` is mounted
  ahead of the routes now; 113KB of price index became 19KB on the wire.
- The collection graph drew a flat window along the bottom edge, so a steady
  973-printing collection read as "you have nothing". Flat series are centred.
- Smaller: the web Home chunk is warmed from `main.tsx` rather than waited for,
  and there is an inline favicon (every load was taking a 404 for one).

Still open, measured and deliberately not done: Home makes **19 `/api/printings`
calls**, one per set. They run in parallel and cost 760ms wall clock cold, which
did not justify a second batching endpoint yet. Batch them the way
`/api/catalog/prices` is batched if that number ever matters.

## What this app is now

It started as card search for Meta Ray-Ban Display glasses. It is now a **collection tracker** for master-set collectors, with:

- Per-**printing** tracking (`normal`, `reverse`, `holo`, `reverse:pokeball`, …), not per-card
- Per-**printing pricing** — the card sheet prices each printing separately, not once per card
- Sync to a self-hosted server (`server-pc.tail0e4194.ts.net`) with offline-first semantics
- Real printing data from TCGdex, since pokemontcg.io cannot supply it
- Two genuinely different UIs: glasses vs web/phone

## Live state

| Thing             | Where                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Frontend          | https://vekbui96.github.io/cardlens/                                           |
| Server (cardlens) | `https://server-pc.tail0e4194.ts.net:8443` via Tailscale Funnel                |
| Collection data   | `D:/services/data/collection.json` on SERVER-PC                                |
| Sync token        | `COLLECTION_TOKEN` in `D:\services\cardlens\.env` — NOT in the repo            |
| Real collection   | 973 printings across 19 sets (measured live 2026-08-27)                        |
| Printings cache   | `D:/services/data/printings/` (30-day TTL, cache version **4**)                |
| Catalog prices    | `D:/services/data/catalog-prices/` (12-hour TTL, cache version **1**)          |
| Target bot        | `D:\services\target-stock-checker`, scheduled task, watchlist in `products.db` |
| Target token      | `TARGET_TOKEN` in `D:\services\cardlens\.env` — separate from the sync token   |
| Binders           | `D:/services/data/binders.json` + `binder-images/`, synced, live               |
| Shares            | `D:/services/data/shares.json`, revocable, public GET by id                    |
| Recognition       | `recognition` service, loopback :8200, fronted at `/api/recognize`             |
| Deployed at       | Both on `c9e5272`, loaded in a browser and verified 2026-08-27                 |

Server endpoints: `/api/health`, `/api/collection`, `/api/collection/merge`,
`/api/binders`, `/api/binders/merge`, `/api/binders/images`,
`/api/printings/:setId`, `/api/catalog/cards`, `/api/catalog/sets`,
`/api/catalog/prices?sets=a,b,c` (batched, disk-cached — Home's pricing),
`/api/set-information/:setId`, `/api/sealed/:setId?name=`, `/api/target/*`,
plus the companion relay. All three `binders` routes are live.

**Pages publishes from Actions again.** Pushing to `main` updates the site;
verified on 2026-08-27 by pushing and watching the served `index-*.js` hash
change. Note that GitHub serves `index.html` cacheably, so a browser that has
the page open will keep loading the OLD bundle after a deploy — check the hash
in the served HTML, not what the tab happens to be running.

## Target restock tab (`#/target`)

Web-only screen over the Pokémon restock bot that already ran on SERVER-PC. It
shows what is watched and what the bot itself is doing — a watchlist where
nothing restocked and a bot that stopped checking look identical otherwise.

- The bot exposes a loopback aiohttp API (`api.py`); cardlens proxies it. It is
  **not** read from `products.db` directly: adding a watch needs the bot's
  warmed browser to resolve a title and first status, and paused/blocked state
  only exists in that process's memory.
- **The Target login is still outstanding.** `scripts/hard_login.py` has to be
  run once at the server's console. Monitoring and alerts work without it; only
  auto-cart does not. The auto-cart toggle is offerable regardless — the attempt
  fails visibly at checkout rather than silently doing nothing.
- The health-check product (Prismacolor, always in stock) is the canary and the
  API refuses to delete it, same guard `!unwatch` applies.

## Where things stand (August 2026)

A long session. Everything below is committed, pushed, deployed and verified
unless it says otherwise.

### Shipped

| Feature               | Where              | Notes                                                                                 |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| Target restock tab    | `#/target`         | Watchlist over the bot: status, health, add/remove, auto-cart toggle, test cart       |
| Per-printing set grid | `#/set/...`        | One tile per printing, not per card. Tap art to mark, tap caption for the sheet       |
| Exclusions            | card sheet         | A printing can be declared not part of the set. Hidden by default, revealed by a chip |
| Live shares           | `#/live/:id`       | A link that re-reads the collection instead of carrying it. Revocable                 |
| Collection graph      | home + shared sets | Printings owned over time, 30d/90d/1y/all                                             |
| Custom binders        | `#/binders`        | Vault X 9- and 12-pocket, laid out by hand, plus "fill with one of each"              |
| Binder sync           | `/api/binders`     | Per binder, last write wins, tombstoned deletes, own watermarks, `COLLECTION_TOKEN`   |
| Custom binder images  | binder pocket      | Resized on the device, stored server-side, referenced by a 20-byte id — never inline  |

### Tokens and services

Three distinct tokens, none interchangeable:

- `COLLECTION_TOKEN` — collection sync and binder/share management
- `TARGET_TOKEN` — the Target tab (device to cardlens). Separate on purpose: these
  routes reach a browser that can put things in a real Target cart
- `TARGET_BOT_TOKEN` — cardlens to the bot, loopback only

All in `D:\services\cardlens\.env`. Shares live in `D:/services/data/shares.json`.

### The Target bot

Moved off the laptop to `D:\services	arget-stock-checker`. Python 3.12 in `.venv`,
scheduled task `target-stock-checker`, **Interactive** logon — it drives a HEADED
Chromium because PerimeterX captchas headless, so it needs the console session.
`api.py` serves a loopback API on :8788 that cardlens proxies.

**It does not survive an unattended reboot.** The task is at-logon, so if the machine
restarts and nobody logs in, stock checking silently stops and every live share 404s.
This happened once mid-session. Autologon is the real fix.

## Binder sync — server deployed, Pages waiting on GitHub

Committed as `7654b3b` and pushed. CI passed. **The server is live on it**
(`/api/binders` answers 401 instead of 404, the image route returns the JSON
`not_found` shape). **GitHub Pages is not** — see the deployment note below.

Built as the plan that used to be item 1 described — per binder, last write wins, `binders.json`
beside the shares, on `COLLECTION_TOKEN` — plus the custom-image upload, which
was the reason to do them together. `CLAUDE.md` holds the durable rules; the
state-of-play is:

- **No `.env` change is needed.** `BINDERS_FILE` and `BINDER_IMAGES_DIR` default
  to `D:/services/data/binders.json` and `D:/services/data/binder-images/`.
  That is deliberate — NSSM bakes environment variables in at install, so a new
  variable would mean re-running `04-install-services.ps1`, not a restart.
- **`server/` changed, so both targets must be deployed**, not just Pages.
- Verified against a real server on scratch data: last-write-wins, a stale push
  losing, a tombstone refusing to resurrect, out-of-range pockets dropped,
  `holofoil` canonicalised on ingest, a traversal id 404ing, SVG refused, the
  501-binder payload 413ing. The upload path is covered end to end in
  `e2e/binders.spec.ts` — resize, POST, id, resolved URL, `naturalWidth > 0`.
- **Nothing has synced between two real devices yet.** One machine has exercised
  both sides of the protocol; two have not.
- Not built, deliberately: any way to delete an image on purpose. Orphans are
  swept after a merge once they are 7 days old.
- **"Add page" was broken from the day binders shipped** and is now fixed. The
  screen added a page by placing a null slot at a new index, then ran
  `trimPages` on the same commit, which dropped the empty page it had just
  made — the button did nothing and said nothing. `addPage` / `removeLastPage`
  name the two intents instead, and trimming is no longer automatic: a blank
  page kept on purpose and one left over are identical, so the app must not
  guess. `trimPages` is gone; `reformat` already compacts by re-flowing.

### Pages is back on Actions (resolved 2026-08-08)

Briefly published from a `gh-pages` branch while GitHub Actions was down. That
is over: the branch is deleted, `build_type` is `workflow` again, and a
workflow deploy is verified live. Pushing to `main` deploys the site again.

**The manual publish took the site down for two days** — see the Git Bash /
MSYS trap now in `CLAUDE.md`. The blank page returned HTTP 200, so every
status check reported healthy.

**And the "Actions outage" was only the first day.** After it cleared, a single
run stuck in `waiting` from 2026-08-06 held the `pages` concurrency group
(`cancel-in-progress: false`), so every later Pages run queued behind it
forever while CI passed normally. Cancelling that one run drained the queue and
the next deploy finished in 26 seconds. Check for stuck runs before concluding
Actions is broken.

### What the deploy state actually was

**GitHub had a partial system outage on 2026-08-06** — Actions and Pages both
reported `major_outage`. The Pages run for `7654b3b` sat `pending` and never
started; `workflow_dispatch` returned HTTP 500 while still creating a run. Pages
is therefore still serving `da2b975`. Re-run "Deploy to GitHub Pages" once
GitHub is healthy; nothing about the change needs redoing.

**The previous handoff's deploy claim was wrong.** It said Pages and server were
both on `ae63015` and verified live. Measured before deploying: the server was on
`5bead17` — two commits behind — and the Pages run for `ae63015` had FAILED, as
had CI for the two commits before this one. All three failures were the same
Actions infrastructure error (`Failed to resolve action download info: Service
Unavailable`), not code. Check `gh run list` rather than trusting a "deployed"
line in this file.

That ordering — server ahead of Pages — is the safe one, and is now safe in both
directions:

- A frontend newer than the server is now survivable. The binder routes 404 on
  an old server (confirmed against the live one), and a 404 is treated as "this
  server predates the endpoint" and skipped, rather than wedging sync on
  "offline" and saying the collection had failed when it had just succeeded.

## Open, in the order I would do them

1. ~~**Binder sync.**~~ **Done, but NOT yet deployed** — see the section above.
2. ~~**The silent snapshot fallback.**~~ **Done.** Share now names WHICH of four
   things went wrong — no token on this device, a rejected token, sync switched
   off at the server, or the server unreachable — and says the link it made is
   frozen and will never update. The notice stands until a live link actually
   succeeds (the 2.5s chip flash was the bug) and carries a "Try live link"
   button, so the fix is one tap from where the problem is stated. The snapshot
   fallback itself is unchanged: a link is still always produced.
   - `fetchJson` flattens every status into `ProviderError("Request failed
(401)", "network")`, so 401/503 are recovered by probing the message — the
     same thing `services/tradeShares.ts` does for its 409. The clean fix is a
     `status` field on `ProviderError`, or moving this call onto `syncRequest`,
     which already maps those statuses to named errors. Worth doing next time
     either file is open.3. **The IN_STOCK false positive.** redsky reports `['DISCONTINUED','IN_STOCK',
'OUT_OF_STOCK','UNAVAILABLE']` for TCIN 93565639 and `check_target` calls that
     IN_STOCK because one entry says so — while the product page has Pickup, Delivery
     and Shipping all unavailable. It has read "in stock" for weeks. Requiring a
     shipping-capable fulfilment would fix it.
3. **Auto-buy.** Fully specced in `docs/superpowers/plans/2026-06-30-autobuy.md`
   (target-stock-checker repo). Blocked by a permission guardrail mid-session, and
   deliberately not worked around. **Before anything places an order,
   `ORDER_TOTAL_SEL` must be verified against a real order-review page** —
   `_parse_price` takes the FIRST dollar amount, so a selector whose text starts
   with a subtotal means a $200 order passes a $100 cap.
4. **RDP on SERVER-PC.** Registry, service and firewall are set; the listener never
   came up because `TermService` cannot restart in place. A reboot should finish it.

## Traps found the hard way this session

- **`grid-column: N` does not fall back when the grid collapses to one column.**
  It creates an implicit Nth track and puts the element in it. The binder
  spread's cover rule (`.spread[data-cover] > * { grid-column: 2 }`) was never
  undone in the ≤560px media query, so on a phone page 1 rendered at half width
  jammed against the right edge, with pockets a third the size of every other
  page's — live for as long as spreads have existed and found only by
  screenshotting the page rather than asserting on it. Undo a column assignment
  in the same media query that removes the column.
- **`1fr` is `minmax(auto, 1fr)`.** A `white-space: nowrap` label sets a grid track's min-content width and squeezes its neighbours — the ellipsis never
  engages because the track grows instead. Use `minmax(0, 1fr)` plus
  `min-width: 0`. This is why the showcase looked right and the set grid did not.
- **A sticky header owns its own stacking context.** No z-index on a backdrop
  nested inside the screen can beat it. Portal modals to `<body>`.
- **Naive timestamps lie across timezones.** The server is on Pacific and the
  devices are Central, so `datetime.now().isoformat()` made every check read as
  "2 hr ago". All bot timestamps go through `now_iso()` and carry an offset.
- **Two whitelists silently drop unknown fields** — `toPrintings` on read and
  `parseRow` on the server. A new row field must be added to both or it vanishes
  on reload and on sync respectively.
- **Same-millisecond merge ties are the normal case, not a rare one.** Excluding
  a card you already own writes two rows back to back; without a tie-break rule
  the winner depended on map order. Ties go to the tombstone, then the exclusion.
- **NSSM bakes environment variables in at install.** `Restart-Service` does NOT
  pick up `.env` changes — re-run `04-install-services.ps1`. A restart alone left
  every Target route returning 503 with the code correctly deployed.
- **Prettier is enforced by CI and script-applied edits do not respect it.** Run
  `npm run format` after any python/sed edit; `format:check` caught one after a push.
- **NordVPN breaks Tailscale on the laptop.** `ts.net` names resolve to an
  unreachable tailnet IP. There is a hosts-file override pinning
  `server-pc.tail0e4194.ts.net` to `199.38.181.54`, the funnel's public address.
  **Measured 2026-08-06: that override is what is KEEPING the server reachable,
  not what is blocking it.** The funnel answers 200 through it, while the
  tailnet IP `100.75.251.52` times out and `tailscale status` reports every node
  offline with the coordination server unreachable. An earlier note in this file
  said the line was stale and should be deleted — that was wrong; deleting it
  today loses the only working route. Re-measure before touching it. Undo, if
  Tailscale is ever healthy again: delete that line, uncomment the
  `100.75.251.52` one below it. Backup at `hosts.bak-cardlens`.

## Earlier thread: the card scanner

Nothing is half-built. The card **scanner** is the current thread.

**What exists and is live**

- `src/scan/phash.ts` — artwork hashing. Thresholds (distance 16, margin 8) are
  MEASURED, not guessed; the table is in the file. Re-run
  `node scripts/validate-recognition.mjs me5 me3 me2` after any change to it.
- `public/card-index/` — **20,205 cards across all 174 English sets**, 158KB of
  hashes plus 2.3MB of metadata (405KB gzipped together, and the filenames are
  content-hashed so it is fetched once per rebuild, not per session). Built by
  `scripts/build-card-index.mjs all`, which checkpoints after every set and
  takes `--resume`. It was ten collected sets and 1,709 cards until 2026-08-10.
- `#/scan` — batch scanning with **auto-capture**, review-then-commit, thumbnails.
  Since 2026-08-10 it recognises **server-first** via `/api/recognize`, falling
  back to the on-device index whenever the server does not answer, and labels
  every reviewed row with which one did. The `Server` / `On device` chip beside
  the auto toggle forces either. Needs the collection token, same as sync — an
  unconnected device just scans locally.
  - Auto-capture fires only on a **new subject**: settled, detailed enough to be
    a card, and different from the last captured frame. It no longer photographs
    the mat between two cards or re-scans one a hand passed over.
  - Review offers the card's **real printings** from TCGdex, so pattern foils can
    be marked at scan time instead of hunted down in the set list afterwards.
- `#/showcase/...` — share a set as a link that carries its own data, one tile
  per printing, missing ones ghosted. Snapshot only; resharing is the update.

**Next, in the order I would do them**

1. **localStorage → IndexedDB.** The ceiling that silently ate marks is still
   there and the scanner fills it faster. Keep the OR-Set, tombstones, merge
   rule and watermark — only the backend behind `VersionedStore` changes. It
   touches every read path, so start it fresh rather than squeezing it in.
2. **Collector-number OCR — now the biggest single win available.** Growing the
   index to the full catalog took ambiguity from 4.8% to **8.6%**, and 652 cards
   share an exact hash with another. Every one is a genuine reprint with
   identical art — Base Set against Base Set 2 against Legendary Collection —
   so no improvement to the hash, the optics or the lighting can touch them.
   The margin rule already refuses to guess; a crop of the number corner would
   settle them. Measure with `node scripts/measure-index-crowding.mjs`.

**Unexplained: a crash on Collection.** Not reproducible with 973 seeded rows on
desktop. An ErrorBoundary now ships, so the next occurrence shows the message
with a Copy details button instead of a blank page. Ask for that output, and for
whether it is a white screen, a freeze, or a self-reload — the last means memory,
and Collection is the heaviest screen in the app.

**A pattern worth naming.** Four bugs this session, three of the same shape: a
**silent early return** that made an action do nothing. A storage write that
failed without saying so; a capture that returned early on a 0x0 frame; a set
that indexed zero cards because the API returned empty. Treat a guard clause
that returns quietly as a smell in this codebase — it has been the single most
reliable source of "it just doesn't work".

## What the pricing work actually changed

Prices were already arriving from TCGdex and were already valuing the collection total. They
were lost at exactly one place: `buildPrintingIndex` mapped `Printing[]` to `Finish[]`,
discarding everything but the key, so the set screen had no prices at all. `useCollectionValue`
only worked because it bypassed the index and re-read the raw map.

Now: `SetPrintingIndex.prices` carries them, `printingPrice()` is the one lookup (it tries the
collector number as given, unpadded, and `padStart(3,"0")`), and `SetView` exposes `priceFor`
and `headlinePriceFor`. `useCollectionValue` was refactored onto the same lookup, so the set
screen and the collection total cannot disagree about what a printing is worth.

**A card whose set pokemontcg.io cannot price now headlines with its dearest known printing**
instead of reading "Unavailable". That matters for whole sets: measured live, pokemontcg.io
prices 0/120 Pitch Black and 0/124 Perfect Order.

## Confirmed on hardware (do not re-litigate)

- Triple-pinch on one card = bulk mark. **Works.**
- Hold gesture. **Removed** — never fired; the platform gives `keydown` only.
- Tapping printing badges on the phone. **Works** (server saw the rows land).

## Unresolved, needs the user's device

- **"Blue bar" on the glasses Sets screen.** Diagnosed three times wrongly. It is _not_ a loading state — `LoadingState` renders a spinner and text. It is the focused Back control above an **empty list**. `SetsScreen` has an empty branch that says "No sets loaded · Select to try again", so the next report should distinguish loading / error / empty / list. Ask which text appears before theorising again.
- **The web shell on a REAL phone.** It is now proven at 412x839 in Playwright (`--project=phone`, `devices["Pixel 7"]`) — no horizontal overflow, 44px touch targets, the sheet bounded and its Done button reachable. That is emulation, not a device. Nobody has held this in a hand yet.
- **Per-printing prices on the glasses.** The prices are on `SetView` and the glasses could show them, but only the phone sheet does. Whether a 600x600 additive display has room is a judgement nobody has made on hardware.

## Things that bit hard this session

Full detail in `CLAUDE.md`; the shortlist:

- **TCGdex does not publish first-edition price keys.** A whole task was planned on the assumption it did. Measured across every card in me05, me03, sv08.5 and base1 — 526 cards — the only keys that exist are `normal`, `holofoil`, `reverse-holofoil`. TCGdex carries 1st Edition as a `stamp` on a `holo` variant with `pricing: null`. The three-key mapping was already complete. **Do not add a price key without measuring for it first.**
- **A Playwright project with no `testMatch` runs every spec.** Adding a `phone` project silently re-ran all eight glasses specs at 412x839, where the app resolves to the web shell — five failed and CI would have gone red. The project is now scoped to `phone-layout.spec.ts`.
- **The card sheet's Done button was inside the scrolling region.** With 12 printings it sat at 1098px against an 844px viewport. Fixed by pinning `.close` outside a new `.scroll` wrapper. It was invisible for months because the mock fixtures give each card one printing — **an assertion that cannot be stressed cannot catch anything.**
- **Prettier does not read `.gitignore`.** Git-ignored scratch directories still fail `format:check` until they are in `.prettierignore`.
- A cache-version bump is for **shape** changes, **or for a field callers already read starting to hold a materially different value** — that second case is why `PRINTINGS_CACHE_VERSION` is now 4. Without it, sets cached before a pricing fix keep serving the old numbers for 30 days and look correct doing it. The client's `cache:printings:v4` has to move in the same commit or only devices with no cache see the fix. Still do not bump when the output is byte-identical: that costs a full refetch of every set (120–295 requests each) and buys nothing.
- **A price key that disagrees with the variant type is not always wrong.** TCGdex marks invented variants `variantId: "generated"`, and whole older sets are invented — see `CLAUDE.md`. Strict key-to-type matching quietly dropped the prices of the most valuable cards in Hidden Fates and Team Up.

## Ideas discussed, not started

- Home screen refinements beyond the resume row and progress bars already shipped.
- **Rejected: proxying card images through the server.** Residential upload is slower than the CDN, the glasses reach it through a relay rather than the LAN, a single set is 10–25 MB of thumbnails, and an outage would blank every image. Cache on the device instead if offline art matters.

## Housekeeping still open

- ~~`collection.json` has no backup~~ — done. `D:\services\scripts\backup-collection.ps1` runs under scheduled task `cardlens-backup` (daily 03:00 and at startup), refuses to snapshot unparseable or empty JSON, skips identical snapshots, keeps 30.
- SERVER-PC BIOS: **AC Recovery → Power On** is not set, so it stays off after a power cut. It has been found powered off twice.
- `solid-website-api` deploy key not registered, so that server rebuilds sideloaded source rather than pulling. Does not affect CardLens.
- ~~`useCollectionValue` has no direct test~~ — **closed, and the note was partly wrong.** Its arithmetic was already pure and tested in `models/value.ts` (6 tests) and `models/movement.ts` (9). What genuinely was untested and duplicated is the ORACLE ORDER — TCGdex first, catalog second — written out once in `useCollectionValue` for Home's total and again in `useOwnedCards` for the list of the very printings behind that total, with only a comment asking them to agree. It is now `models/marketPrice.ts`, used by both and covered, including the smp-SM210 fallback and the refusal to price a patterned foil off the plain reverse key. `models/binderValue.ts` did the same for the binder totals.

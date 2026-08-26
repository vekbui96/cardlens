---
name: building-pokemon-binders
description: Use when asked to build, fill, or rebuild a CardLens binder for a Pokémon from a list of cards or printings — "make me a Riolu binder", "add every Lucario", "put these in a binder", or when a pasted list of set/number/printing lines needs to become binder pages on the server.
---

# Building Pokémon binders

Turn a hand-written list of printings into a laid-out binder on the home server, without a hundred taps in the picker.

**Core principle: a number that resolves is not a number that is right.** Every failure this skill guards against was silent — wrong cards that looked correct, missing cards that looked absent.

## The pipeline

```bash
cd <scratch dir>
node <skill dir>/resolve.mjs list.txt --out slots.json      # list -> catalog ids
COLLECTION_TOKEN=... node <skill dir>/push-binder.mjs slots.json --name "Riolu & Lucario" --id <existing-id> --dry
COLLECTION_TOKEN=... node <skill dir>/push-binder.mjs slots.json --name "Riolu & Lucario" --id <existing-id>
```

`--id` edits an existing binder; omit it to make a new one. `--dry` writes `binder.json` and sends nothing.

## List format

One printing per line, em-dash separated. Bare Pokémon names are treated as headings and skipped.

```
Riolu — Platinum 91/127 — Reverse Holo
Riolu — Platinum 91/127 — 2009 Comic-Con Stamp
Lucario ex — Scarlet & Violet Black Star Promo SVP 017 — Holo
```

**Order is the layout.** Nine to a page, in list order, so the list is how the binder reads.

## Before pushing

1. **Get the binder's id and current state** — `GET /api/binders?since=0` with the token. Save the response as a rollback; there is no undo.
2. **Have the user sync the device first.** Binders converge **last-write-wins per binder**, not per pocket, so this push replaces the whole arrangement. Any edit sitting unsynced on a phone is lost.
3. **Dry-run and read the counts.** Cards, pages, and every MISS line.

## Reading the resolver output

| Output                               | Meaning                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MISS ... catalog request failed`    | Transient. pokemontcg.io fails ~25% of the time in bursts. **Re-run** — the disk cache keeps the successes, so only the failures are retried. |
| `MISS ... no catalog set called "X"` | Add an alias to `ALIASES`, or the set genuinely is not in the catalog.                                                                        |
| `MISS ... is Gothita, not Riolu`     | The set id or the number is wrong. **Never override this check.**                                                                             |
| `MISS ... unknown printing "X"`      | Add a row to `FINISHES`.                                                                                                                      |
| `DUPLICATE cardId\|finish x2`        | The same printing twice. Usually a mistake in the list — ask.                                                                                 |

**Re-run until only genuine gaps remain.** A first run always loses a few lines to 500s.

## Unresolvable cards stay as gaps

Some cards are not in pokemontcg.io at all — DP-era Trainer Kits and the Mega Evolution Black Star Promos, for example. Those lines become **empty pockets in the right position**, never dropped, so nothing after them shifts. Report exactly which pockets are empty and why. Do not invent card ids to fill them.

## Printings: rarity vs stamp

The two look alike in a list and are handled oppositely.

- **A rarity** (Full Art, Illustration Rare, Rainbow Rare, Shiny Rare) already has **its own collector number**. The number identifies it; the finish is just `holo`.
- **A stamp or distribution** (Staff, Jumbo, Comic-Con, Burger King, League 1st) shares a number with the card it is stamped on, so it **must** live in the finish key: `holo:staff`, `normal:comic-con-2009`.

Unknown foils are accepted and humanised for display, so add new ones freely. **Never turn finishes into an enum** — three 2025-26 sets introduced nine foils between them.

## Traps

- **Never hand-type a set id.** Two were wrong on the first run (Plasma Storm is `bw8` not `bw7`; Supreme Victors is `pl3` not `pl4`) and both resolved to real cards — a Gothita and a Sceptile would have gone in wearing Riolu's and Lucario's places. `resolve.mjs` looks ids up by name; the name guard is what catches the rest.
- **Paginate.** 250 is the API's maximum page and several sets are bigger (SWSH Black Star Promos: 304). A truncated set looks exactly like "that card does not exist".
- **Token via `COLLECTION_TOKEN` in the environment**, never on the command line — it lands in shell history and in the session transcript. If one is pasted in chat, say so and suggest rotating it.

## Verify after pushing

`dropped=0` is not enough on its own. Re-fetch and check the binder holds the number of cards you sent, under the name and id you meant:

```bash
curl -s -H "Authorization: Bearer $COLLECTION_TOKEN" "$CARDLENS_API/api/binders?since=0"
```

Then tell the user to pull on their device — and to hard-reload, since a cached bundle looks identical to a failed deploy.

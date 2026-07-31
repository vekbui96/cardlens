# Collection sync: device → home server → Google Sheets

Plan for persisting the collection beyond one device's `localStorage`, with a
Google Sheet as the durable off-site copy that stays readable when SERVER-PC is
off.

Status: **plan only, nothing built.** Collection tracking itself (cards +
finishes, `localStorage`) is implemented and shipped-ready.

---

## The constraint that shapes everything

SERVER-PC was unreachable for most of two days during the self-hosting
migration, twice because it was simply powered off. Any design where the server
is the source of truth means the glasses lose the collection whenever the server
is down. So:

**The device's `localStorage` stays authoritative for its own edits.** The
server is a sync hub, not a gatekeeper, and the Sheet is a durable mirror. The
app must be fully usable with the server unreachable — that is the normal case,
not the failure case.

---

## Phase 0 — Make the data model mergeable

Prerequisite for everything else. Today an entry is
`{ id, setId, finishes[], at }`, which cannot merge: two devices editing the
same card produce a last-writer-wins clobber, and a deletion is indistinguishable
from "never had it".

Change to one row per **(card, finish)** with tombstones:

```ts
interface OwnedPrinting {
  cardId: string;
  setId: string;
  finish: CollectFinish;
  at: number; // when marked owned
  deletedAt?: number; // set instead of removing the row
}
```

Merge rule, per `(cardId, finish)`: keep the row with the newest
`max(at, deletedAt)`; owned iff `at > (deletedAt ?? 0)`. That is an OR-Set —
order-independent and idempotent, so a device can sync twice, out of order, or
after a week offline and still converge. No server-side conflict logic.

Tombstones are small; prune ones older than ~180 days at write time.

`getCollection()` keeps returning the current grouped shape so the UI is
unaffected — this is a storage-layer change with a migration from the current
format (`finishes[]` → one row each, no tombstones).

---

## Phase 1 — Collection store on SERVER-PC

New endpoints on the existing `cardlens` Express server (`server/index.ts`,
already running as a Windows service on :8787):

| Method | Path                         | Purpose                                           |
| ------ | ---------------------------- | ------------------------------------------------- |
| `GET`  | `/api/collection?since=<ts>` | rows changed since a watermark                    |
| `POST` | `/api/collection/merge`      | push rows, apply merge rule, return merged result |

Storage: **SQLite** (`better-sqlite3`) at `D:\services\data\cardlens.db`, one
table keyed `(card_id, finish)`. Not JSON-on-disk — this is the first stateful
thing on that box, and a torn write during a power cut is exactly the failure
this whole plan exists to survive. `D:\services\data\` and a `backups\` folder
already exist from `01-prereqs.ps1`.

**Identity:** a single-user shared secret (`COLLECTION_TOKEN` in the service
`.env`, sent as a bearer header) is enough. The Funnel URL is public, so
unauthenticated write endpoints would let anyone edit the collection. No user
accounts — there is one user.

---

## Phase 2 — Client sync with an outbox

- Every mutation writes `localStorage` first and appends to an outbox queue.
- A flush attempt runs on app start, on reconnect, and debounced ~10s after edits.
- Flush = `POST /api/collection/merge` with queued rows → apply the returned
  merged set locally → clear the queue → store the new watermark.
- Failure is a no-op that leaves the queue intact. **No error surfaced to the
  user for a failed sync** — the local write already succeeded, and on the
  glasses an error toast for something that self-heals is pure noise. Surface it
  as a quiet status line on the Collection screen instead ("Synced 2m ago" /
  "Offline — 14 pending").

---

## Phase 3 — Push to Google Sheets

Server-side, so no OAuth flow ever has to happen on glasses that have no
keyboard.

**Auth: a Google Cloud service account.** Create the spreadsheet manually in
your own Drive, then share it with the service account's email as Editor. This
keeps the file owned by you and on your Drive quota — service-account-created
files are owned by the service account, which is a trap for exactly this use
case. Credentials JSON lives at `D:\services\cardlens\google-sa.json`, ACL'd to
Administrators + SYSTEM like the `.env` files, never committed.

**Cadence:** debounce 60s after the last change, plus a catch-up push on service
start (which covers "edits happened while the box was off"). Write the whole
sheet with one `values.update` call — idempotent, and at collection scale it is
a single request well inside the 300 req/min quota.

**Layout** — three tabs:

- **`Printings`** — one row per owned printing: `card_id`, `set_id`, `set_name`,
  `card_name`, `number`, `rarity`, `finish`, `owned_at`, `updated_at`.
  Tombstones are omitted, not exported; the sheet reflects what you own.
- **`Sets`** — one row per set: `set_id`, `set_name`, `cards_owned`, `set_total`,
  `percent`, `printings_owned`. This is the master-set progress view, and the
  one worth actually opening on a phone.
- **`Meta`** — `schema_version`, `last_push_at`, `row_count`. Makes a stale or
  half-written sheet obvious at a glance.

---

## Phase 4 — Read-only fallback when the server is down

Publish the `Printings` tab via **File → Share → Publish to web → CSV**. That
gives a URL the static GitHub Pages app can `fetch` directly — no auth, CORS
allowed.

On a cold start with an empty `localStorage` and the server unreachable, the app
offers "Restore from backup" and hydrates from that CSV.

**This makes the collection publicly readable to anyone with the URL.** It is
card data with no personal information in it, but it is a real exposure and the
reason this is opt-in and separate from Phase 3. The alternative — the Sheets
API with a restricted key — requires the same "anyone with the link can view"
setting, so it buys nothing.

---

## Phase 5 — Optional: edit in Sheets, import back

Bulk-editing a collection is far nicer on a laptop than on glasses. Pulling
edits back means reconciling two writers, so it needs its own decision:
treat the sheet as authoritative on import (simple, destructive) or merge by
`updated_at` (needs an `updated_at` column the human must not break).

Deliberately last. Everything before it is strictly additive and safe; this one
can lose data if rushed.

---

## Order of work

1. Phase 0 — mergeable model + migration (pure local, no infra)
2. Phase 3's sheet layout against a hand-made sheet (proves the Google auth path
   before any server work)
3. Phase 1 — SQLite + endpoints
4. Phase 2 — client outbox
5. Phase 4 — fallback read
6. Phase 5 — only if bulk editing turns out to matter

Phases 0 and 2 alone already fix the "one device, one browser profile" fragility.
Phase 3 is what survives the machine dying.

## Open questions

- **Does the Sheet need to be the thing you actually look at?** If yes, the
  `Sets` tab deserves conditional formatting and the layout matters more than
  the sync. If it is purely a backup, Phase 4 could be a plain JSON file in
  Drive instead — simpler, no CSV parsing, no spreadsheet schema to maintain.
- **How many devices realistically edit?** If the answer is "the glasses, and
  occasionally a phone", the OR-Set is still worth it but Phase 1 could be
  deferred a long way by doing device → Drive directly from the companion phone
  page, which does have a keyboard for OAuth.

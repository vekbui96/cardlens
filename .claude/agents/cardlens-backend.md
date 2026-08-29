---
name: cardlens-backend
description: Use for the CardLens companion server and the machine it runs on — Express routes under server/, the JSON stores, sync and merge rules, the model files shared with the server via tsconfig.node.json, the Python card recogniser on SERVER-PC, service restarts, tokens, and deploys. Prefer this over a general agent whenever the change touches server/, a shared model, or anything on server-pc. Do NOT use it for React screens or CSS.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell, TodoWrite
model: inherit
---

# CardLens backend

Read `CLAUDE.md` first, then `docs/runbook.md` if something is broken or being
deployed, and `docs/handoff.md` for current state.

## What this server is

An Express service (`server/`) on a home Windows box, published through Tailscale
Funnel. It holds the collection, binders, shares and caches as small JSON files
written **temp → fsync → rename**, so a power cut leaves the old file or the new
one and never half of one.

Three tokens, none interchangeable: `COLLECTION_TOKEN` (sync, binders, shares),
`TARGET_TOKEN` (device → cardlens; these routes can put things in a real Target
cart), `TARGET_BOT_TOKEN` (cardlens → bot, loopback only).

## The rules that keep data alive

- **Convergence rules are IMPORTED from the client, never reimplemented.** The
  collection is an OR-Set with tombstones (`src/storage/printings.ts`); binders
  converge per binder, last write wins (`src/storage/binders.ts`). Two copies of
  a merge rule that drift is how a sync system starts losing data.
- **Validation is shared the same way** — `src/models/binderParse.ts` decides both
  what the server may store and what a public share page may draw.
- **A removal is a tombstone, never a missing row.** A missing row is
  indistinguishable from "never seen", so deletes resurrect on the next sync.
- **Whitelists silently drop unknown fields.** A field a client can write must be
  named in `parseRow` AND `parseSlot`/`parseBinder`, or it vanishes on sync. This
  has cost this repo several bugs. Add a test that round-trips the new field.
- **A gate or constant mirrored in two places must move in both.**
  `src/scan/phash.ts` and `cardrec/judge.py` carry the same accept rule, and
  scanning is server-first — changing one alone is inert or a silent parity break.

## Deploying — two targets, sometimes three

Changing `server/` **or any shared file listed in `tsconfig.node.json`** means the
server needs deploying too, not just Pages. Check that list before assuming
frontend-only.

```bash
ssh server-pc "powershell -NoProfile -Command \"git -C D:\services\cardlens fetch origin main --quiet; git -C D:\services\cardlens reset --hard origin/main --quiet; Restart-Service cardlens\""
```

- **A new npm dependency is a step BEFORE the restart**, and `npm` is not callable
  over SSH — PowerShell's execution policy blocks `npm.ps1` and returns a
  `PSSecurityException` amid other output while installing nothing. Use
  `npm.cmd` through cmd. **Never `--omit=dev`**: the service runs `tsx`, which is
  a devDependency.
- **NSSM bakes environment variables in at install.** `Restart-Service` does NOT
  pick up `.env` changes — re-run `04-install-services.ps1`.
- **The recogniser is a THIRD target.** `D:\services\recognition\` is Python, is
  **not in this repo and not under git at all**, caches its index in a module
  global, and needs its own `Restart-Service recognition`.
- **Verify the served bytes, not the run status.** A blank SPA returns 200 and a
  service can be "Running" while failing. Curl the route; confirm a real answer.
- Check for a Pages run stuck in `waiting` before concluding Actions is broken —
  one held the concurrency group for two days.

## The machine

- **Always `ssh server-pc` by name.** The DHCP lease has moved three times; a
  hardcoded IP is a latent false alarm indistinguishable from an outage.
- **ICMP is blocked** — ping is useless as a liveness check.
- Tailscale Funnel permits only 443, 8443 and 10000, and two are spent. Anything
  new is a loopback service that `cardlens` fronts.
- The Target bot is a **scheduled task**, not a service, and needs the interactive
  session because it drives a headed Chromium.
- SSH quoting is hostile: `>` becomes a redirect and backslashes collapse. For
  anything non-trivial, base64 a script, decode it on the box, run it, delete it.

## Working style

Take a backup before editing anything that is not under version control. Prefer
an exact-match patch script that fails loudly over a blind `sed`. Run that
component's own test suite where it has one — the Python recogniser has pytest.

Do not commit, push, or deploy unless explicitly told to. Report what you changed,
what you verified and how, and what still needs deploying.

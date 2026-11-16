# CardLens innovation loop

A daily, unattended job on server-pc that suggests small improvements to CardLens and, once you approve
one, builds, tests, merges, deploys and verifies it on its own. It mirrors the portfolio site's loop
(`D:\projects\solid-website\innovation`), with one structural difference: **the loop runs NON-elevated,
and only the server deploy/rollback runs elevated**, through a separate pre-registered task.

## This is only for the loop's own ideas

The issue/label/approval flow below exists **only for ideas the loop comes up with itself**. Your direct
requests ("change X in CardLens") do not go through it: ask as usual, and the cardlens agents
(`cardlens-frontend`, `cardlens-backend`) handle them end to end, as they always have. No issue or label
is needed, and nobody should route manual work through the loop. The loop never touches issues that are
not labelled `loop:proposal` (e.g. your #2-#4).

## How it works

Once a day the `innovation-loop-cardlens` task runs `run-loop.ps1`, which starts a headless `claude -p`
session (`--permission-mode dontAsk`, explicit allowlist, `guard.mjs` PreToolUse hook) that follows
[`LOOP.md`](LOOP.md). Each run:

1. **Phase A (build), at most one issue.** Takes the oldest open `loop:proposal` + `approved` issue whose
   approval really came from you (`check-approval.ps1`, against the issue's event history). Posts a plan,
   builds on `loop/<issue>-<slug>` in its own clone, runs the local gates (`test-gate.ps1`: `npm ci`,
   `npm run verify`, a Pages-style build; e2e on alternate ports; Linux visual baselines via Docker when UI
   changed), opens a PR, and merges it with `merge-pr.ps1` only when CI is green on the PR's exact head
   commit. Merging deploys Pages; `deploy.ps1` then deploys the server if needed and verifies both, rolling
   everything back on failure. Success: `loop:deployed`, closed. Failure: `loop:failed`, comment, left open.
2. **Phase B (propose).** If fewer than 5 proposals are open, it reads the docs (`handoff.md`, the plans),
   the code and the live site and opens up to 3 new `loop:proposal` issues.

## Approving

- Read the proposal. Add **`approved`** to green-light it. Only you can: the loop checks that the last
  `labeled approved` event was by `vekbui96`, and it can never add the label itself (blocked in the guard
  and the allowlist).
- To adjust scope, comment (before or after approving). Your comments (not the loop's, which carry a
  hidden `<!-- innovation-loop -->` marker) are adjustments. Comments from anyone else are ignored as
  instructions.
- If you **edit the issue body after approving**, the loop will not build it until you remove and re-add
  `approved`, so what gets built is what you approved.
- A proposal marked **Manual / needs Ve** is never built or deployed by the loop: card index / recognition,
  scanner gate constants (`phash.ts` + `judge.py`), `/api/target/*`, sync merge/validation rules, cache
  version bumps, secrets / `.env` / NSSM env, Funnel, CORS. `merge-pr.ps1` refuses PRs touching them.
- To reject: close the issue. The loop will not propose it again.

## Labels

| Label              | Meaning                                  |
| ------------------ | ---------------------------------------- |
| `loop:proposal`    | an idea from the loop                    |
| `approved`         | you said go (you set this)               |
| `loop:in-progress` | being built right now                    |
| `loop:deployed`    | shipped, verified live, closed           |
| `loop:failed`      | failed or rolled back; read the comments |

## Install, enable, run

```powershell
# once, from an ELEVATED PowerShell (asks for your password; both tasks run while logged off)
D:\projects\cardlens\innovation\install-task.ps1                 # add -ExtraArgs '-ProposeOnly' for a first supervised week

# then from a NORMAL PowerShell: prove the non-elevated loop can start the elevated task (touches nothing)
powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\run-loop.ps1 -SelfTest

Enable-ScheduledTask  -TaskName innovation-loop-cardlens
Disable-ScheduledTask -TaskName innovation-loop-cardlens
Start-ScheduledTask   -TaskName innovation-loop-cardlens        # run once now

# by hand, from a NORMAL PowerShell:
powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\run-loop.ps1 -ProposeOnly   # first supervised run
powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\run-loop.ps1 -DryRun        # everything except the claude call
```

| Task                              | Runs as                       | Trigger                          | Does                                                            |
| --------------------------------- | ----------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `innovation-loop-cardlens`        | VeBui, **not elevated**       | daily 14:23 (installed disabled) | `run-loop.ps1` from this checkout                               |
| `innovation-loop-cardlens-deploy` | VeBui, **highest privileges** | none (started on demand)         | `C:\ProgramData\innovation-loop-cardlens\bin\elevated-task.ps1` |

The loop task reads the scripts and `LOOP.md` from **this checkout**, so keep it on `main` and `git pull`
to update the loop. The elevated task runs an **admin-only copy** of `lib.ps1`, `elevated-task.ps1`,
`deploy-server.ps1` and `rollback-server.ps1`: after pulling changes to any of those, re-run
`install-task.ps1 -ElevatedOnly` (elevated). Until you do, `run-loop.ps1` sees the copy differs and builds
only front-end-only issues.

## The elevation split

**The task's RunLevel is not what keeps the session unprivileged.** On server-pc, Windows gives this admin
account a full token for non-interactive logons (scheduled tasks) whatever the RunLevel says: no UAC split
token is created. So `run-loop.ps1` (which may itself hold an admin token) starts `claude` through
`LowRights.cs`: a SAFER normal-user token (Administrators deny-only, privileges reduced to
SeChangeNotifyPrivilege) at Medium integrity, stdio redirected to files. It reads the child's real token
back, logs it (`reduced child pid ... token: ...` in the run log) and kills the child and fails the run if
Administrators is enabled, the integrity is above Medium or any non-standard privilege is present. Every
process the session starts (its PowerShell tool, the scripts, git, npm) inherits that token.
The claude session and the daily task have no admin rights. Restarting the `cardlens` service needs them,
so the server deploy runs in the separate elevated task, which takes no arguments:

1. `deploy.ps1` / `rollback.ps1` (non-elevated) write `~\.innovation-loop-cardlens\elevated\request.json`
   `{ mode: deploy|rollback|selftest, issue, sha, requestedAt, nonce }`, run
   `schtasks /run /tn innovation-loop-cardlens-deploy` (the only task they can start: the task's DACL grants
   VeBui's non-elevated token start/read on that one task; the session itself cannot run `schtasks` at all),
   then poll `C:\ProgramData\innovation-loop-cardlens\results\<nonce>.json`.
2. `elevated-task.ps1` treats the request as untrusted: consumes it, requires exactly those five keys,
   a known mode, a 40-hex sha, an integer issue, a timestamp under 15 minutes old and an unused nonce
   (nonce log in ProgramData, admin-writable only), takes a lock, then:
   - `deploy`: the sha must be on a freshly fetched `origin/main` and ahead of the live HEAD;
     runs `deploy-server.ps1 -TargetSha <sha> -Issue <n>` (fixed path, arguments built by the wrapper)
   - `rollback`: sha and issue must match the last deploy it recorded itself; `rollback-server.ps1` takes
     PREV from that record, never from the request
   - `selftest`: does nothing but prove the round trip
   - `revert-only` is refused: reverting main needs no elevation (`rollback.ps1 -RevertOnly`)
3. The protected copy ignores user-controlled environment (machine PATH and PSModulePath only, no path
   overrides), because a task's environment partly comes from `HKCU\Environment`.

## What a deploy does

- **Front end** = merging to main (`deploy-pages.yml`). `deploy.ps1` waits for the Pages run of THIS sha
  (and cancels an older run stuck in `waiting` for 30+ min, which otherwise blocks the `pages` group), then
  checks the served `index.html` -> `/cardlens/assets/index-*.js` -> every chunk for a change-specific
  string, and renders the page in headless Edge (a blank SPA returns 200). Rollback: `git revert` of the
  merge on main + push, then the same checks for the string being gone.
- **Server**, only when `server/`, a `tsconfig.node.json` shared file, `package.json` or the lockfile
  changed between the live HEAD and the merge: snapshot all of `D:\services\data` to
  `D:\services\backups\predeploy-<stamp>.zip` (newest 10 kept), record PREV, `git reset --hard <merge>` in
  `D:\services\cardlens`; if dependencies changed, stop the service, `node_modules` -> `node_modules.prev`,
  `npm.cmd ci` (never `--omit=dev`); restart; verify health on repeated checks with a stable node pid (NSSM's
  auto-restart can hide a crash loop), catalog + printings GETs with retries (pokemontcg.io fails ~25%),
  Funnel. Rollback: reset to PREV, restore `node_modules.prev`, restart, re-verify, then revert main.
  **Data is never restored automatically**; the snapshot zip is named in the logs.
- The loop refuses to deploy the server if main already holds server changes that are not live (yours,
  not deployed yet): deploy those first. It never restarts `recognition`.

## Where things are

| Path                                                                    | What                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `C:\Users\Ve Bui\.innovation-loop-cardlens\logs\run-<time>.log`         | runner log (start here)                                                           |
| `...\logs\run-<time>.summary.txt`                                       | the session's final summary, ending in `LOOP-RESULT: ...`                         |
| `...\logs\run-<time>.jsonl`                                             | full transcript (every tool call)                                                 |
| `...\logs\{test-gate,merge-pr,deploy,rollback,snapshots}-*.log`         | non-elevated script logs                                                          |
| `...\clones\cardlens`                                                   | the loop's own clone (never `D:\projects\cardlens`, never `D:\services\cardlens`) |
| `...\artifacts\<issue>\`                                                | live / rolled-back screenshots                                                    |
| `...\state\`                                                            | merge and deploy records                                                          |
| `C:\ProgramData\innovation-loop-cardlens\logs\`                         | elevated logs (`elevated-task`, `deploy-server`, `rollback-server`)               |
| `C:\ProgramData\innovation-loop-cardlens\state\server-last-deploy.json` | PREV / target of the last server deploy                                           |
| `D:\services\backups\predeploy-*.zip`                                   | data snapshots taken before each server deploy                                    |

## Rolling back by hand

```powershell
# front end and (if the loop deployed it) server, from a NORMAL PowerShell:
D:\projects\cardlens\innovation\rollback.ps1 -Issue <n> -MergeSha <merge sha> -AbsentString "<new UI string>"
# only revert main (Pages follows):
D:\projects\cardlens\innovation\rollback.ps1 -Issue <n> -MergeSha <merge sha> -RevertOnly
# only the server, from an ELEVATED PowerShell (uses the recorded PREV):
C:\ProgramData\innovation-loop-cardlens\bin\rollback-server.ps1
```

Exit codes for deploy/rollback scripts: `0` ok, `1` precondition failed (nothing changed), `2` failed and
rolled back, `3` rollback failed (look now), `4` install failed (server rolled back).

## Troubleshooting

- **`detected dubious ownership` in a run log**: something created the loop's clone or state from an
  ELEVATED shell, so Administrators own it and the non-elevated loop's git refuses it. From an elevated
  PowerShell: `icacls "C:\Users\Ve Bui\.innovation-loop-cardlens" /setowner "SERVER-PC\VeBui" /T /C /Q`.
  Run the loop (and `-DryRun`) from a normal PowerShell.
- **`SERVER_DEPLOY=unavailable`** in the run header: the deploy task is missing, its admin-only copy is
  out of date (`install-task.ps1 -ElevatedOnly`), or the selftest failed (see
  `C:\ProgramData\innovation-loop-cardlens\logs\elevated-task-*.log`). Front-end-only issues still build.

## Safety, in short

- `dontAsk` + explicit allowlist: no npm/node/cmd/docker/schtasks/services for the session; installs,
  builds and tests go through `test-gate.ps1`, merges through `merge-pr.ps1`, deploys through `deploy.ps1`.
- `guard.mjs` checks every tool call: only `vekbui96/cardlens`; no secrets, `.env`, env dumps, SSH keys,
  gh token, NSSM registry; nothing under `D:\services` (except reading `D:\services\logs\cardlens*`);
  GET-only HTTP to known hosts and never the write routes; one command per call; edits only in the loop's
  clone and never to protected paths; no `D:\services` paths or `VITE_*TOKEN` in new code; pushes only to
  `loop/<n>-<slug>`; never `approved`. `node innovation\test-guard.mjs` runs its allow/deny cases.
- e2e never touches the live service: `test-gate.ps1` sets `CI=1` (no server reuse), ports 5273/8887,
  scratch data for every `*_FILE` / `*_DIR` (including `CATALOG_PRICES_DIR`, which `playwright.config.ts`
  does not set), dead `RECOGNITION_URL` / `TARGET_BOT_URL`, and refuses if a port is busy.
- The guard is a guardrail, not a sandbox, and UAC is not a security boundary: anything running as VeBui
  could already do a lot. The split keeps the claude session itself away from admin rights and makes the
  one elevated action narrow, validated and logged. See the PR that added this directory for residual risk.

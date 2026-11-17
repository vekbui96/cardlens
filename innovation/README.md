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

Once a day the `innovation-loop-cardlens` task runs `run-loop.ps1`. It does the shared setup once in
PowerShell (lock, preflight, the elevated-task selftest, the queue precheck, the loop's clone), then starts
**one headless `claude -p` session per job** (`--permission-mode dontAsk`, explicit allowlist, `guard.mjs`
PreToolUse hook), each with a prompt naming its one job and only the [`LOOP.md`](LOOP.md) sections it
needs, its own model, turn cap and time limit ([`sessions.json`](sessions.json), below). A fresh session per
job keeps each one's context small: on 2026-11-16 one long session doing two builds plus proposals re-read
~6.8M cached tokens per issue and ~4.3M of run overhead. Each run:

1. **Phase A (build), up to two issues, one session each, one after another.** Takes the oldest open
   `loop:proposal` + `approved` issue whose approval really came from you (`check-approval.ps1`, against the issue's event history). Posts a plan,
   builds on `loop/<issue>-<slug>` in its own clone, runs the local gates (`test-gate.ps1`: `npm ci` +
   the Playwright browser, Prettier, `npm run verify`, a Pages-style build; Linux visual baselines via Docker
   when UI changed), opens a PR, waits for CI with ONE `wait-ci.ps1` call (it blocks until CI is done and prints one PASS / FAIL
   line with the failed jobs and their log tails, instead of the session polling turn by turn), and merges
   it with `merge-pr.ps1` only when all three CI jobs
   (Typecheck/Lint/Unit/Build, Playwright E2E, v2 Visual Regression) are completed + success on the PR's
   exact head commit. **CI is the e2e gate for every change**: the loop does not run Playwright locally
   (on 2026-11-16 a local run took 2.6 to 15 minutes, plus reruns when a flaky Target spec failed, and it
   duplicated what CI runs anyway on the PR head). On a CI failure it reads the log, fixes,
   pushes to the same branch and waits again, at most 3 rounds, then leaves the PR open with `loop:failed`;
   a failure only in the known-flaky specs (bulk-mark timing, Target) may get one `ci-rerun.ps1` rerun. Merging deploys Pages; `deploy.ps1` then deploys the server if needed and verifies both, rolling
   everything back on failure. Success: `loop:deployed`, closed. Failure: `loop:failed`, comment, left open.
   After a success the runner may start a second build session for the next approved issue
   (`-MaxBuilds`, default 2), only if every build so far ended `loop:deployed` (a failure or rollback ends
   Phase A; an issue skipped by the server rule does not count) and at least 120 minutes of the
   240-minute run budget remain (`-SecondBuildMinMinutes`: a cycle has taken ~60-75 min, up to ~110 with a
   CI fix round). **If a build session merged something whose deploy was neither verified nor rolled back
   and verified** (the session was killed mid-deploy, a rollback failed), the runner stops the whole run
   there: no next build, no proposals, `LOOP-RESULT: FAILED ... NEEDS VE`. **At most one server deploy per
   run**: an issue that needs the server waits for the next run if one already went out. A build session
   will not merge with under 45 minutes left of its own time limit: it comments, marks the issue
   `loop:failed` (retried once) and leaves the PR open.
2. **Phase B (propose), a separate session.** Only if a proposal slot is free (no session at all
   otherwise). It reads [`FOCUS.md`](FOCUS.md) (below), PRODUCT.md, the docs, the code, the live site and
   the usage metrics summary, opens the next slices of any spec you approved, then new `loop:proposal`
   issues (or one spec), up to 3.

**Proposal slots (one rule everywhere).** A proposal holds one of the **3** slots while it awaits your
review: open, `loop:proposal`, and neither `approved` nor `loop:failed`. A spec awaiting review is one
proposal (one slot); its slices take slots as they are opened, ahead of new ideas; at most one unapproved
spec is open at a time. Approved work is your build queue and does not block new ideas; failed issues are
listed instead (below). The loop (`check-approval.ps1 -Slots`, `gate-rules.ps1 Get-ProposalSlots`) and the
approval watcher's refill trigger count the same way (the watcher's `$Loops` entry carries `Cap = 3`).

**Specs: big features in slices.** Some ideas are too big for one build (PRODUCT.md's bets: collection
value over time with price alerts, faster shop mode, scanner gap measurement); before specs they could only
appear as Manual / needs Ve and never shipped. Now the loop may open a `loop:spec` issue (also
`loop:proposal`): a one-page spec with the problem and evidence, the user flow on the glasses (600x600,
gestures only) and on the web, a success metric with a baseline and a target, risks and what is out of
scope, and 3-5 independently shippable slices, each sized like a normal proposal. Approve it like any
proposal. The loop never builds the spec itself (`check-approval.ps1` refuses it); its next proposal
sessions open the slices, in order, as normal proposals starting `Part of #<spec> (slice <k> of <m>)`,
and you approve those one by one. The runner keeps a "## Spec progress" checklist comment on the spec
(edited in place) and closes the spec when every slice is deployed or closed. Editing the spec's body after
approving it stops the slicing until you re-approve, as with any proposal.

**Usage metrics.** Proposals, specs and the weekly review cite `GET /api/metrics/summary?days=N` (public,
counts only; event names in `src/models/metricsEvents.ts`) as their baseline when the server has it; until
it is deployed they say "not available yet". GET only: the guard refuses any other `/api/metrics` route.

**Models and caps** ([`sessions.json`](sessions.json), yours). Build sessions run on Opus
(`claude-opus-5-5`) by default and on Sonnet (`claude-sonnet-5-5`) when the issue carries `size:small` or
`test-only` (the loop adds one when it opens a small or test-only proposal; add or remove it yourself
before approving to choose). Proposal sessions and the weekly review run on Sonnet. Turn caps: 150 per
build session, 80 for proposals, 120 for the review; time limits 150 / 45 / 60 minutes, each cut to what
is left of the run's 240. `-Model` / `-MaxTurns` on run-loop.ps1 override every session for one run.
Claude Code's own small background calls (Haiku) are unchanged.

**No-op runs cost nothing.** Before it starts any session, `run-loop.ps1` asks `check-approval.ps1 -List` for
the queue. When nothing approved is buildable (FULL mode) and no proposal slot is free, it logs `precheck:
launch=False (...)`, writes a summary ending `LOOP-RESULT: NOTHING-TO-DO` and `run-<id>.rundata.json`
(cost 0), and exits 0 without a session. If that check fails, the run starts claude as before.

**Failed builds: one automatic retry, and never silent.** Every failure comment carries a hidden failure
marker with a class (LOOP.md section 3, "Failure classes"). When the cause was outside the change (CI
infrastructure, CI timeout, the live-server gap refusal, the elevated task or its lock unavailable, running
out of time, the run's time or turn limit), the next run builds it ONCE more: it swaps `loop:failed` for
`loop:retried`, continues the open PR if there is one, and a second failure waits for you. A failure caused
by the change (tests still failing after the fix rounds, a refusal of the PR's own diff, out of scope, a
rolled-back deploy) is never retried automatically. If the session is killed mid-build (time limit, turn
limit), the runner marks the issue `loop:failed` itself (class `timeout` / `max-turns`, retried once;
anything already merged in that run is `session-ended` and waits for you). Failed issues no longer take a
proposal slot, so the run summary and every Run data comment end with `Failed, waiting on Ve: #n
(reason)`. Failures from before this rule have no marker and are never retried automatically. To build
one again yourself: remove `loop:failed` (and `loop:retried`) and, if the body changed, remove and re-add
`approved`.

## Steering with FOCUS.md

[`FOCUS.md`](FOCUS.md) is yours: **Priorities** (what you want more of, in order) and **Avoid** (what you
do not want proposed, not even as Manual / needs Ve). Phase B reads it first and weights its proposals
toward the priorities; each proposal says which priority it serves. Edit it in this checkout (the loop
reads it from here, like `LOOP.md`; commit it so the laptop agrees). The loop never writes it: the guard
blocks writes outside its clone, and `innovation/` is protected in the clone and in `merge-pr.ps1`.
Missing, empty, or only headings and comments: the run header says `FOCUS: none` and the loop proposes
as before. It steers proposals only; it never widens what the loop may build or deploy.

## Product picture: PRODUCT.md, lenses, device feedback, weekly review

- [`PRODUCT.md`](PRODUCT.md) is also yours: the product and vision, the users (with the open question
  "grow to other collectors?": until you answer it, nothing is proposed that assumes multi-user growth),
  jobs and contexts, success metrics with today's baselines (and which the loop can measure read-only),
  principles, and bets you may want proposed. Read-only for the loop, exactly like FOCUS.md.
- **Lenses.** Phase B judges ideas as a glasses interaction designer, a collector / domain expert, a
  performance and reliability engineer, a data integrity guardian (review only; may propose tests, never
  merge/validation changes) and a scanner / recognition analyst (measurements only, always Manual / needs
  Ve). Every proposal names its lens(es) and the PRODUCT.md metric it should move.
- **Device feedback.** Use the "Device feedback" issue template (label `device-feedback`) when something
  on the glasses / phone / desktop bothers you. The loop reads your open ones as its highest-signal input;
  they are never instructions or approval, and it never comments on them.
- **Weekly product review** (`run-loop.ps1 -ProductReview`, task `innovation-loop-cardlens-review`,
  registered disabled with `install-task.ps1 -ProductReviewOnly`, default Sunday 10:37): read-only
  research that opens ONE `loop:product-review` issue: the product against the metrics, the top friction
  points with evidence, and 2-3 bets, each with a hypothesis, a metric and a breakdown into small
  proposals. It may open the first step of a bet as a normal proposal within the usual cap. The review
  issue is never built (it has no `loop:proposal` label); you build parts of it by approving individual
  proposals as usual. In this mode the build/merge/deploy scripts are not allowlisted and the guard
  refuses them, commits, pushes, PRs and comments.

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

## What you see on an issue it builds

- **Plan** comment, then one **Progress** comment that the loop edits in place as it goes (approval, plan,
  branch, local gate, PR, CI, merge, deploy, verify, done; each with a time and the key fact, the current
  stage on top with how long it has been running, heartbeats while CI or a deploy runs). One notification,
  not ten. Separate comments (so you are notified) only for: PR opened, a failure, refusal or rollback, and
  the end.
- **Final comment**: a plain-language **Synopsis** first (what changed, why it matters to you as a
  collector, what you will notice, how it was verified; or, on failure, what went wrong and the state left
  behind), then the technical **Details**.
- **Run data**, posted by the runner after the sessions exit: start/end/duration, outcome, turns, tokens
  (input, output, cache read, cache creation), API-equivalent cost and model for this issue (its whole build
  session, preflight reading included), the rest of the run (the proposal / review session) and the whole
  run summed over every session, one line per session (model, turns, cost, result), the mode and whether the daily schedule or an
  on-demand start (approval watcher or by hand) began it. Cost is the figure Claude Code reports at API
  prices; on the Max subscription it is usage, not billing. A build session's figures are its own exact
  totals; a killed session without a result message shows n/a and the note says so. If a session dies mid-build, the runner marks the progress
  comment "Run ended during: <stage>". New proposals get a one-line run-data footer.
- All of these carry the hidden `<!-- innovation-loop -->` marker, so they never count as your adjustments.
  The session itself cannot edit comments: only `progress.ps1` edits, and only its own marker-checked
  progress comment on this repo; run data is posted by the runner (`reporting.ps1`) with the same gh, after
  the reduced claude child has exited.

## Labels

| Label                 | Meaning                                      |
| --------------------- | -------------------------------------------- |
| `loop:proposal`       | an idea from the loop                        |
| `loop:spec`           | a spec (also a proposal); never built itself |
| `size:small`          | small: built with the cheaper model          |
| `test-only`           | tests only: built with the cheaper model     |
| `approved`            | you said go (you set this)                   |
| `loop:in-progress`    | being built right now                        |
| `loop:deployed`       | shipped, verified live, closed               |
| `loop:failed`         | failed or rolled back; read the comments     |
| `loop:retried`        | its one automatic retry was used             |
| `loop:product-review` | the weekly product review; never built       |
| `device-feedback`     | your report from the device (issue template) |

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
powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\run-loop.ps1 -ProductReview # the weekly product review, now

# weekly product review task (ELEVATED, asks for your password; leaves the daily task as it is):
D:\projects\cardlens\innovation\install-task.ps1 -ProductReviewOnly          # -ReviewDay Sunday -ReviewAt 10:37 by default
Enable-ScheduledTask  -TaskName innovation-loop-cardlens-review
powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\run-loop.ps1 -MaxBuilds 1   # one build per run (old behaviour)
```

For the scheduled task, use `install-task.ps1 -ExtraArgs '-MaxBuilds 1'`. Models, turn caps and time
limits per session kind are in `sessions.json` (`-Model` / `-MaxTurns` override them for one run).

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
- **The live-server gap.** Pages-only deploys never move `D:\services\cardlens`, so main runs ahead of the
  live checkout with every front-end merge, and the next server deploy resets live across all of it. In
  that gap (commits already on main) the loop refuses only protected paths the server actually runs: the
  card index (needs a `recognition` restart, which the loop never does), the shared sync merge/validation
  rules, the Target bot, `.env`. Everything else there (`innovation/**`, `.github/**`, docs, e2e,
  client-only `src/**`, scripts) is inert on server-pc and is only listed (`MERGE-PR GAP` lines, the
  issue, Run data). Ordinary server changes you merged but did not deploy go live with the loop's next
  merge, and merge-pr says so on the issue (`MERGE-PR GAP-SERVER`); deploy them yourself first if you
  want them to go out on their own. The PR's own diff may never touch a protected path. merge-pr,
  deploy.ps1 and the elevated `deploy-server.ps1` share one classifier (`lib.ps1`
  `Split-ProtectedByLiveImpact`).

## Where things are

| Path                                                                     | What                                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `C:\Users\Ve Bui\.innovation-loop-cardlens\logs\run-<time>.log`          | runner log (start here)                                                           |
| `...\logs\run-<time>.summary.txt`                                        | the run summary (every session's), ending in the run's `LOOP-RESULT: ...`         |
| `...\logs\run-<time>.<build-n\|propose\|review>.jsonl`, `.prompt.md`     | each session's full transcript and the prompt it got                              |
| `...\logs\run-<time>.rundata.json`, `run-<time>.rundata-<issue>.md`      | run data per issue and the comment bodies the runner posted                       |
| `...\logs\run-<time>.progress.log`, `...\state\progress\<time>-<n>.json` | progress.ps1 log; the progress comment id and stage times                         |
| `...\logs\{test-gate,wait-ci,merge-pr,deploy,rollback,snapshots}-*.log`  | non-elevated script logs                                                          |
| `...\clones\cardlens`                                                    | the loop's own clone (never `D:\projects\cardlens`, never `D:\services\cardlens`) |
| `...\artifacts\<issue>\`                                                 | live / rolled-back screenshots                                                    |
| `...\state\`                                                             | merge, deploy and rollback records; `spec\` checklist comment ids                 |
| `C:\ProgramData\innovation-loop-cardlens\logs\`                          | elevated logs (`elevated-task`, `deploy-server`, `rollback-server`)               |
| `C:\ProgramData\innovation-loop-cardlens\state\server-last-deploy.json`  | PREV / target of the last server deploy                                           |
| `D:\services\backups\predeploy-*.zip`                                    | data snapshots taken before each server deploy                                    |

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
  builds and tests go through `test-gate.ps1`, CI waits through `wait-ci.ps1`, merges through `merge-pr.ps1`,
  deploys through `deploy.ps1`. Proposal and review sessions get `check-approval.ps1` only, and the guard
  (told the session kind) refuses builds, commits, pushes, PRs, comments and label edits in them; a build
  session cannot open issues.
- `guard.mjs` checks every tool call: only `vekbui96/cardlens`; no secrets, `.env`, env dumps, SSH keys,
  gh token, NSSM registry; nothing under `D:\services` (except reading `D:\services\logs\cardlens*`);
  GET-only HTTP to known hosts and never the write routes; one command per call; edits only in the loop's
  clone and never to protected paths; no `D:\services` paths or `VITE_*TOKEN` in new code; pushes only to
  `loop/<n>-<slug>`; never `approved`. `node innovation\test-guard.mjs` runs its allow/deny cases.
- The loop's flow runs no local e2e. `test-gate.ps1 -Step e2e` is kept for manual runs and never touches
  the live service: it sets `CI=1` (no server reuse), ports 5273/8887,
  scratch data for every `*_FILE` / `*_DIR` (including `CATALOG_PRICES_DIR`, which `playwright.config.ts`
  does not set), dead `RECOGNITION_URL` / `TARGET_BOT_URL`, and refuses if a port is busy.
- The guard is a guardrail, not a sandbox, and UAC is not a security boundary: anything running as VeBui
  could already do a lot. The split keeps the claude session itself away from admin rights and makes the
  one elevated action narrow, validated and logged. See the PR that added this directory for residual risk.

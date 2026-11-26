# CardLens innovation loop

A daily, unattended job on server-pc that suggests small improvements to CardLens and, once you approve
one, builds, tests, merges, deploys and verifies it on its own. It mirrors the portfolio site's loop
(`D:\projects\solid-website\innovation`), with one structural difference: **the loop runs NON-elevated,
and only the server deploy/rollback runs elevated**, through a separate pre-registered task.

## The loop's own ideas, and your requests

The issue/label/approval flow below exists for ideas the loop comes up with itself, plus the requests you
file on purpose as `loop:request` issues (see "Your requests"). Requests you make in chat ("change X in
CardLens") still go to the cardlens agents (`cardlens-frontend`, `cardlens-backend`), end to end, as they
always have; no issue or label is needed for those. The loop never touches your other issues (e.g. your
#2-#4).

## Your requests

When you want something built hands-off, file it with the **Request** issue template (New issue ->
Request). It gets `loop:request` and asks for: What I want; What I should notice (optional: the thing the
deploy check should see on the live site); Constraints (optional); Mode (**Build it** | **Plan first, wait
for my OK**); Urgency (Normal | Now).

1. The approval watcher sees it within 10 minutes and starts a run at once (like an approval, not on the
   hourly refill cooldown).
2. The run's **intake session** (Sonnet, 40 turns, 20 min, $0.75, at most 6 a day; `sessions.json` `intake`)
   reads it with FOCUS.md, PRODUCT.md and the code, and does ONE of: opens one proposal (small; `size:small`
   when it is), opens a spec with slices (big), splits out parts the loop must not build as **Manual / needs
   Ve**, asks you ONE question (`loop:needs-info`: answer with a comment and it plans again), or declines
   it because it conflicts with FOCUS.md "Avoid" (`loop:declined`, the comment says why). Every issue it opens
   starts with `From request #<n>`.
3. The runner posts a **Plan** comment on your request listing those issues ("Comment `/hold` to stop") and
   adds `loop:planned`. In **Build it** mode they are approved through the request (`approval: via-request
#<n>`) and built next, ahead of the loop's own ideas, with no daily session cap (the plan budget and the
   per-session USD caps still apply). In **Plan first** mode nothing is built until you add `approved` to an
   issue. Issues from a request take no proposal slot.
4. The plan comment is edited in place as a checklist (failures listed, with the usual failure classes on
   each issue). When every issue is deployed or closed, the runner posts a plain-language **Synopsis** and
   closes the request.

To stop: comment `/hold` on the request (all of its issues) or on one issue; or close it. Editing the
request after its plan voids the via-request approval (approve issues by hand, or file a new request).
The loop can never file a request, add or remove `loop:request`, edit a request, add `approved`, or mark a
preference confirmed (guard.mjs; test-guard.mjs cases).

The switches live in `sessions.json` `options`: `requestIntake` (requests), `productStore` (the decision
collector) and `memoryAgent` (preferences); each is off unless set to `true`.

## What the loop learns: the product store

`D:\hub\state\product\cardlens\` (outside every repo) is where agents' learning lives; GitHub stays the source
for proposals and approvals, and FOCUS.md / PRODUCT.md stay yours.

- `decisions.jsonl`: append-only, written by a deterministic PowerShell collector (no AI) on every run (GitHub
  is asked at most every `productCollectMinutes`, 10): your approvals, unapprovals, closes without deploy
  (rejections), `/hold`s, comments without the loop marker, edits after approval, and requests. Each record:
  id, ts, kind, issue, labels, one-line gist, link.
- `preferences.json`: what the **memory agent** (Haiku, tool-less, 5 turns, $0.10) infers from new decisions,
  when 5 or more piled up or weekly. The runner validates its JSON and writes it; anything invalid is logged
  and dropped. It can only mark a preference **confirmed** when the evidence is something you wrote (a
  FOCUS.md / PRODUCT.md line, or your own comment); everything else stays **inferred**, and inferred
  preferences are never permissions or approvals.
- The hub's daily digest lists **new inferred preferences**. Reply on the digest issue with one line per item:
  `confirm p-xxxxxx` (it becomes confirmed) or `no p-xxxxxx` (removed and never re-added). The next run records
  your reply as a decision and applies it, with no AI.
- `cursors.json`: where the collector and the memory agent left off (schema-versioned).

### Phase 2: the Observer and the PM (`options.observerPm`)

With `observerPm` on (it needs `productStore`), Phase B is two sessions instead of one `propose` session, and
neither runs unless there is a reason. A deterministic coordinator in `run-loop.ps1` (`product-intel.ps1`
`Get-CoordinatorDecision`, no AI) decides before any session starts, and logs why:

- **Observer** (`observe` in sessions.json: Sonnet, 30 turns, 15 min, $0.60, 2 a day) runs only when a file of a
  workflow in `workflows.json` (Home, Collection, Set, Want list, Search, Scan, Binders, Sealed, Target,
  Settings/Sync, onboarding/empty states, shell) changed on main since `cursors.lastObservedCommit`, or a 7-day
  metrics rate moved by `observeMetricPoints` (10) percentage points since the last observation. It gets the
  changed files and workflows, diff stats, metric deltas, the open findings (for dedup) and the PRODUCT.md lines
  that mention those workflows. Read-only: no GitHub writes, no innovation script, files only in WORK (the guard's
  OBSERVE mode). It answers with findings as JSON; the runner validates them (workflow, 15-280 character summary,
  1-6 pieces of evidence that are `file:line` in the repo, an allowed URL or `metric:...`, confidence, severity),
  drops duplicates and anything invalid, and appends the rest to `findings.jsonl`. A range with no workflow file
  only moves the cursor.
- **PM** (`pm`: Sonnet, $0.75, 4 a day; same GitHub rights as `propose`) runs only when there are new open
  findings, new decisions, new research or approved slices to open since its last run, AND a proposal slot is
  free. It reads FOCUS.md, PRODUCT.md, your confirmed preferences in full (inferred ones marked as guesses), the
  top 20 open findings, recent decisions, `opportunities.json`, KNOWN_ISSUES and METRICS, ranks the opportunities
  (value, confidence, effort, risk; the runner scores them and keeps 15) and opens slices / proposals / one spec
  as before. **Every issue it opens ends with `<!-- loop-refs: f-... d-... -->`** citing at least one open finding
  or decision (a slice cites `spec-<n>`); the guard refuses `gh issue create` otherwise. The runner then marks the
  cited findings `addressed`. It may add one FOCUS.md suggestion (shown in the hub digest, never applied) and one
  research question (stored for Phase 4).
- An idle day (no workflow change, no metric move, nothing new for the PM) starts no session: $0.
- New store files: `findings.jsonl` (append-only; a status change is a new record; `open` -> `addressed` |
  `dismissed`, both final), `opportunities.json`, `focus-suggestions.jsonl`, `research.jsonl`; `cursors.json`
  gains `observe` (last run, metrics snapshot) and `pm` (last run).
- Proof without side effects: `run-loop.ps1 -DryRun -AgentsDryRun` really runs both sessions against a copy of the
  store (`logs\run-<id>.store`) with every GitHub write refused; the PM lists what it would open.
- With `observerPm` off, the single `propose` session runs exactly as before.

### Phase 3: QA and UX review (`options.qaUx`)

With `qaUx` on (it needs `productStore`), every deployed UI change gets a QA verdict and a UX review, and a
regression on the live site reaches the PM within one run. Order in a run: builds, QA, UX, then the Observer and
the PM. The coordinator (`product-qa.ps1` `Get-QaUxPlan`, no AI) never QAs or reviews the same commit twice
(`cursors.qa.done` / `ux.done`), respects the daily caps, the plan budget (`hold` stops everything) and the run's
time; what does not fit waits in `cursors.qa.pending` for the next run (and makes the next run's precheck launch).

- **Acceptance criteria.** A build's Plan comment ends with 1-6 user-visible, checkable criteria in a
  `<!-- loop-criteria -->` block, one per line: `- <workflow> | <path> | <criterion>` (LOOP.md section 3 step 5).
  The runner reads them from the loop's own comments only (Ve's account, first line the loop marker; anyone
  else's text is ignored). A build without them falls back to the proposal's "How it would be tested".
- **QA** (`qa`: Sonnet, 25 turns, 15 min, $0.50, 8 a day) starts after each `loop:deployed` build and each shipped
  request child, once the deploy is verified. A deterministic precheck skips it with no session when the merge
  touched only tests, docs or `innovation/` (qa.jsonl records `skipped (no user-facing change)`). It gets the
  criteria with their live URLs, a diff summary and the touched workflows, and checks the LIVE site read-only:
  WebFetch, and impeccable `shot` (390px first) / `detect`. There is no browser automation: Playwright is not
  allowlisted and the guard refuses it, so a criterion that needs a click, a signed-in collection or a device is
  `unverified` with the reason. No gh at all, no innovation script, no POST/PUT/DELETE, no token, files only in
  WORK and ARTIFACTS (guard mode QA). Its JSON (pass / fail / unverified per criterion with evidence, screenshots
  as `artifact:qa/...png`, up to 3 regressions, an optional lesson) is validated by the runner, which appends the
  verdict to `qa.jsonl`, adds a QA line to the issue's Run data comment (or a short comment of its own when the
  build was in an earlier run), writes failed criteria and regressions to `findings.jsonl` (agent qa, tag qa,
  severity high: the PM sees them first) and hands the lesson to the memory agent as input only (never evidence
  for a preference). **QA never rolls back**; rollback stays with the deploy scripts.
- **UX review** (`ux`: Sonnet, 25 turns, $0.50, 3 a day) starts after a deploy that changed the UI (the deploy
  verified an ExpectString, or visual baselines changed; never a NoVisibleString deploy), and once a week
  (`uxSampleDays`) for the workflow nobody reviewed for `uxStaleDays` (30). It gets the diff summary, the before /
  after CI baselines (extracted by the runner), Ve's confirmed UI preferences, FOCUS.md, the v2 design system and
  the workflow's spec, and may use impeccable's critique / audit guidance and a few ui-ux-pro-max lookups. The
  Observer's guard posture (mode UX). Every finding (tag ux) carries a measurable recommendation ("tap target 32
  -> 44px"); vague ones are refused.
- The hub digest shows the QA verdicts of the last day (fails first) and the new UX findings; run data and the
  ledger record the agents `qa` / `ux`.
- Proof without side effects: `run-loop.ps1 -DryRun -AgentsDryRun -QaIssues 174,177` queues those deployed issues
  and really runs QA / UX against a copy of the store; `-DryRun -QaIssues ...` alone only plans and writes the
  prompts.
- With `qaUx` off, nothing of this runs.

### PR previews: QA before the merge (`options.previewQa`)

With `previewQa` on (it needs `qaUx`) QA moves in front of the merge and gets a real browser, on a copy of the PR
that cannot touch anything live:

- **Flow.** A build session that reaches `WAIT-CI PASS` on a PR with any user-facing file prints
  `LOOP-PR-READY <issue> <pr> <sha>` and ends (LOOP.md section 3 step 9a). The runner builds that head in a fresh
  git worktree under `<LOOP_HOME>\preview\work` (`preview.ps1`; node_modules linked from the loop clone when the
  lockfile matches, else `npm ci`) by `preview-build.ps1` under the REDUCED token, with `VITE_USE_MOCKS=true`, no
  companion or catalog URL, base `/`, and every other `VITE_` value and token stripped from the environment. It
  deletes the source maps, scans the bundle for the tailnet name, 8443 / 8787 / 8200 / 8788 / 8446, `D:\services`
  and the e2e token (one hit refuses the preview), copies it into a slot folder, removes the worktree and checks
  the served `preview.json` names the head. It posts **`Preview: https://server-pc.tail0e4194.ts.net:<8460-8462>/`**
  on the PR, in the issue's progress comment (stage "Preview + QA") and, for a via-policy build, in
  `state\via-policy.json` as `issues[].preview` (`url`, `status` up | down, `pr`, `headSha`, `qa`, `upAt`,
  `expiresAt`): the hub shows `issues[].preview.url` while `issues[].preview.status` is `up`.
- **QA** (a `qa` session in guard mode `QA_PREVIEW`, LOOP.md section 14) drives the preview with
  `preview-browse.ps1` (Playwright from the loop clone; goto / click / fill / press / waitFor / expectText / shot,
  screenshots at 390x844 and 1440x900, sample data via `?seed=collection|numbered|binders|scan|trade|empty`). The
  guard allows that script, WebFetch and impeccable only for THIS session's preview port; the live site's API,
  the hub, other slots and local services are refused, and inside the browser every request but GET to the
  preview origin and public image hosts is aborted. The runner validates the JSON, records the gate in
  `state\preview-qa-<issue>.json` and posts the verdict on the PR.
- **Gate.** pass / partial -> a new build session merges (merge-pr.ps1 refuses a user-facing merge of this run
  until the gate allows it for the PR's exact head). A failed criterion or a regression -> ONE fix round (a new
  session fixes, pushes, waits for CI, prints `LOOP-PR-READY` again), then a second failure is `loop:failed`
  class `qa` with the PR left open. A `/hold` (or approval withdrawn) after the preview -> not merged, class
  `held`. QA that cannot judge (no preview, no session, bad JSON) never blocks: the gate is `unverified`, the merge
  goes on and the post-deploy QA on the live site runs as before. After a preview pass the live QA session is
  skipped for that merge (the deploy's own live checks always run; UX still reviews the live site).
- **Serving and cleanup.** No server process: Tailscale Serve maps `https://server-pc.tail0e4194.ts.net:8460-8462`
  (tailnet only, never Funnel) to `<LOOP_HOME>\preview\slots\0..2` permanently, set once with
  `preview-serve-setup.ps1 -Apply` (it never resets the serve config and checks that 443 / 8443 / 8444 are
  unchanged; `-Remove` takes the three entries out). At most three previews; a PR reuses its slot. A preview is
  torn down when its build ends (merged, failed or left open), and at every run start and end anything expired
  (24 h), whose PR is closed or merged, or whose build crashed. `preview.ps1 -ShowSlots` lists the slots;
  `preview.ps1 -CleanupSlots` tears down what is due (refused while a run holds the lock). This box resolves its
  own tailnet name to the public Funnel addresses, so the loop reaches the slots on the tailnet IP (curl
  `--resolve`, Chromium host rules); other tailnet devices just open the URL.
- **Veto window.** Ve's via-policy veto window stays on the proposal (before any build is spent): a preview only
  exists once the change is built, and building before the approval would change what the policy approves. A
  `/hold` still stops the merge at any point up to it (check-approval runs again before the merge session and in
  merge-pr).
- **Look window** (Ve, 2026-11-24, "veto option A"; `AUTONOMY.json` `mergeLookHours`, 1 h). A via-policy build whose
  preview is up and whose preview QA allows the merge is parked before its merge session: the runner writes
  `state\merge-parked.json` (issue, pr, sha, mergeAt, the parked run's model and round), puts `mergeAt` into
  `state\preview-qa-<n>.json` (merge-pr.ps1 refuses before it), posts "Merges at <local time> unless you comment
  `/hold`. Preview: <url>" on the issue and the PR, records `issues[].mergeAt`, status `parked` and the preview
  URL in `state\via-policy.json` (and `nextMergeAt`), keeps the preview up (its slot is the last to be evicted) and
  goes on with the next build: nothing waits holding the lock. The next run (the drain starts one at `mergeDueAt` in
  `drain.json`) handles parked PRs first: a `/hold` on the issue or the PR (also the ops center's "/hold (from the
  ops center)"), a closed PR or an approval that no longer verifies -> class `held`, PR left open, preview until
  its TTL; a new head -> preview QA again and a new window; window over -> the merge session (on the parked run's
  progress comment). If main moved and the PR conflicts, the merge session takes main in and prints
  `LOOP-PR-READY` again: previewed, QA'd and parked once more. Builds Ve approved with the label, slices and request
  issues skip it, as does a change with no preview (nothing user-facing, or the preview failed). The idea veto
  (`vetoHours`) is unchanged, so a via-policy item has two windows: on the proposal and on the working preview.
- Proof run: `run-loop.ps1 -DryRun -PreviewProof -PreviewPr <pr> -PreviewIssue <issue> [-PreviewPostTo <pr>]` runs
  one preview + QA round for an existing loop PR and posts only to `-PreviewPostTo` (as an agent comment).

### Resource limits: one test browser at a time (Ve, 2026-11-24)

server-pc also runs the CardLens API, recognition, the contact API, the hub and the Target stock checker, so every
loop on the box (cardlens, portfolio, ops-hub) shares ONE test-browser slot: the lock file
`%USERPROFILE%\.innovation-loop-shared\browser.lock` (`browser-lock.mjs`; owner pid + hold-until, stale locks are taken
over). `smoke.mjs` (deploy render check, waits up to 5 min), `preview-browse.mjs` (preview QA, waits 60 s) and
`update-snapshots.ps1` (docker baselines, waits 10 min, then runs anyway) take it. Busy or under 2 GB free RAM means
"unverified (busy)", fail-open as before: the render check is skipped (served-bytes checks still decide), a preview QA
step reports BUSY, and the runner does not start the preview QA session at all under 2 GB (`resource-rules.ps1`). The
gate (`test-gate.ps1`), the preview build and every loop browser run at BelowNormal priority (children inherit it).
Caps: one browser and one worker per call, 150 s per preview-browse call, 5 min per smoke render. The Target bot is not gated: its
only state endpoint needs its token, which the loop never reads. Tests: `node innovation\test-browser-lock.mjs`,
`powershell -ExecutionPolicy Bypass -File innovation\test-resource-rules.ps1`.

### Token savers (Ve, 2026-11-24)

- **Feasibility before proposing and before building.** Proposal, PM and intake sessions check before opening an
  issue that it is not already on main, that every file, screen, route and component it names exists, and that it
  does not duplicate an open or recently closed issue (LOOP.md section 5 step 6). A build session's first step
  (section 3 step 3, "Feasibility first") refuses within a few tool calls (class `scope`, outcome `skipped`) when the
  issue is already done or names something that is not there. Before any session the runner reads the files the
  issue names (`gate-rules.ps1 Get-ProposalPathCheck` against `git ls-tree origin/main`): none of them on main ->
  refused with the same failure comment and no session (it does not count against MaxBuilds); some missing -> the
  build header's `PRECHECK` line lists them. Back-tested on all 135 proposals: 64 name files, none would be refused.
- **Small polish is bundled when proposed, not when built.** The PM opens 2-3 Size S, Pages-only polish ideas
  for the same workflow or screen as ONE proposal (one slot, one build, one PR). Bundling at build time (several
  approved issues in one session) was not built: one CI failure would block the others' merge, and approval,
  preview QA, the look window, merge-pr and the deploy records are all per issue.
- **Small-build caps.** A non-Opus build of a `size:small` issue runs every session of that build with
  `build.sizeSmallMaxTurns` 100 and `build.sizeSmallMaxBudgetUsd` 2.50 (`Get-BuildCaps`). Ve asked for 80 / 2.00.
  Over the past 84 small builds, 80 / 2.00 would have stopped 9 (10.7%) and 100 / 2.50 would have stopped 5 (6%),
  so the slightly higher pair is set. Opus builds (the automatic retry, `model:opus`, a server deploy) keep the
  full caps.
- **Trimmed build prompts.** Build prompts leave out sections 1 (labels) and 4 (gates summary). Build sessions
  read CLAUDE.md, the top of handoff, the frontend or backend agent file for the side they change, and only the
  `docs/` files CLAUDE.md's index names for that area; runbook, ship and advance are not read up front.
  Continuation sessions (`buildmerge`: the merge after the preview or the look window; `buildfix`: the QA fix
  round) get section 3 without the steps they skip. Sizes of LOOP.md in the prompt:
  - first build session: 52.2 KB -> 45.6 KB
  - merge continuation: 52.2 KB -> 33.3 KB
  - QA fix round: 52.2 KB -> 37.0 KB
  - required reads at session start: about 45 KB -> about 16-20 KB

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
   a failure only in the known-flaky specs (bulk-mark timing, Target) may get one `ci-rerun.ps1` rerun. A v2 Visual
   Regression failure is read from CI's own images: `ci-diffs.ps1 -Pr -Issue -RunId` downloads only that run's
   `visual-diffs` artifact into WORK (PNGs kept, everything else deleted; the guard still refuses `gh run download`),
   and the guard lets the session Read / Grep its own saved tool results under `~\.claude\projects\<loop work
dir>\<session>\tool-results\` (exact shape only). Before that, #356 spent three fix rounds blind. Merging deploys Pages; `deploy.ps1` then deploys the server if needed and verifies both, rolling
   everything back on failure. Success: `loop:deployed`, closed. Failure: `loop:failed`, comment, left open.
   After a success the runner may start the next build session for the next approved issue, up to four per
   run (`-MaxBuilds`, default 4), only if every build so far ended `loop:deployed` (a failure or rollback ends
   Phase A; an issue skipped by the server rule does not count) and at least 100 minutes of the
   360-minute run budget remain (`-SecondBuildMinMinutes`, alias `-NextBuildMinMinutes`: a cycle has taken
   ~60-75 min, up to ~110 with a CI fix round; the session's own limit is cut to what is left and it will not
   merge without enough time). Four builds of up to ~85 min fit. The run budget is cut to end 30 minutes inside
   the scheduled task's ExecutionTimeLimit (7 h from install-task.ps1; the log's `time: run budget ...` line). **If a build session merged something whose deploy was neither verified nor rolled back
   and verified** (the session was killed mid-deploy, a rollback failed), the runner stops the whole run
   there: no next build, no proposals, `LOOP-RESULT: FAILED ... NEEDS VE`. **At most one server deploy per
   run**: an issue that needs the server waits for the next run if one already went out. A build session
   will not merge with under 45 minutes left of its own time limit: it comments, marks the issue
   `loop:failed` (retried once) and leaves the PR open.
2. **Phase B (propose), a separate session.** Only if a proposal slot is free (no session at all
   otherwise). It reads [`FOCUS.md`](FOCUS.md) (below), PRODUCT.md, the docs, the code, the live site and
   the usage metrics summary, opens the next slices of any spec you approved, then new `loop:proposal`
   issues (or one spec), up to 3.

**Proposal slots (one rule everywhere).** A proposal holds one of the **5** slots while it awaits your
review: open, `loop:proposal`, and neither `approved` nor `loop:failed`. A spec awaiting review is one
proposal (one slot); its slices take slots as they are opened, ahead of new ideas (an auto-approved slice
takes none; the watcher's literal copy of the rule still counts it, so its refill is only more cautious); at most one unapproved
spec is open at a time. Approved work is your build queue and does not block new ideas; failed issues are
listed instead (below). The loop (`check-approval.ps1 -Slots`, `gate-rules.ps1 Get-ProposalSlots`) and the
approval watcher's refill trigger count the same way (the watcher's `$Loops` entry carries `Cap = 5`).

**Specs: big features in slices.** Some ideas are too big for one build (PRODUCT.md's bets: collection
value over time with price alerts, faster shop mode, scanner gap measurement); before specs they could only
appear as Manual / needs Ve and never shipped. Now the loop may open a `loop:spec` issue (also
`loop:proposal`): a one-page spec with the problem and evidence, the user flow on the glasses (600x600,
gestures only) and on the web, a success metric with a baseline and a target, risks and what is out of
scope, and 3-5 independently shippable slices, each sized like a normal proposal. Approve it like any
proposal. The loop never builds the spec itself (`check-approval.ps1` refuses it); its next proposal
sessions open the slices, in order, as normal proposals starting `Part of #<spec> (slice <k> of <m>)`.
**Approving the spec approves its slices** (since 2026-11-21): the loop builds each slice it opens without
its own `approved`, in order, unless the slice is marked Manual / needs Ve, failed, was edited, or you held
it (see "Approving"). `check-approval.ps1` reports such a slice as `approval: via-spec #<spec>`
(`gate-rules.ps1 Get-ViaSpecDecision` has the full rule and `test-queue-rules.ps1` its cases); the runner
posts one "Auto-approved via spec #N (approved by Ve on <date>). Comment `/hold` to stop." comment on it,
builds newly opened slices in the same run when MaxBuilds, time and the plan budget allow (otherwise the
next daily or refill run), and the run summary and Run data say `approval: via-spec #N`. The approval
watcher needs no change: approving the spec starts a run like any approval. The runner keeps a "## Spec progress" checklist comment on the spec
(edited in place) and closes the spec when every slice is deployed or closed. Editing the spec's body after
approving it stops the slicing until you re-approve, as with any proposal.

**Usage metrics.** Proposals, specs and the weekly review cite `GET /api/metrics/summary?days=N` (public,
counts only; event names in `src/models/metricsEvents.ts`) as their baseline when the server has it; until
it is deployed they say "not available yet". GET only: the guard refuses any other `/api/metrics` route.

**Models and caps** ([`sessions.json`](sessions.json), yours). Build sessions run on Sonnet
(`claude-sonnet-5-5`, your decision of 2026-11-23) and on Opus (`build.opusModel`, `claude-opus-5-5`) only when:
the issue carries `model:opus` (add it before approving to choose Opus), the proposal's "What deploys" says
"Pages + server", or it is the one automatic retry of a Sonnet build that failed on the change (class `tests`,
`other`, `max-turns` or `max-budget`; the failure marker records the model). `size:small` / `test-only` stay on
Sonnet. The log says which and why (`Phase A: #n model ... (...)`; `gate-rules.ps1 Get-BuildModelChoice`).
Proposal sessions and the weekly review run on Sonnet. Turn caps: 150 per
build session, 80 for proposals, 120 for the review; time limits 150 / 45 / 60 minutes, each cut to what
is left of the run's 360. `-Model` / `-MaxTurns` on run-loop.ps1 override every session for one run.
Claude Code's own small background calls (Haiku) are unchanged.

**Spend caps** (`sessions.json`, yours; rules in `gate-rules.ps1`, tested in `test-queue-rules.ps1`):

- **Per session, in USD:** `maxBudgetUsd` is passed to claude as `--max-budget-usd` (API-equivalent dollars,
  as `claude -p` reports them). Defaults: build on Opus 8, build on any other model 4
  (`build.smallMaxBudgetUsd`), proposals 0.75, the review 4; 0 = no cap. A build stopped by its cap is failure
  class `max-budget`, retried once like `max-turns`.
- **Per day, in sessions:** `maxPerDay` caps how many sessions of each kind start per local day across all
  runs (every approval starts a run). Defaults: builds 8, proposals 4, review 1; 0 = no cap. Counts live in
  `<LOOP_HOME>\state\daily-sessions.json`. Over the cap that kind is skipped with a logged reason (`daily
caps: ...`), approved issues stay approved for a later day, and a run with nothing else to do ends in the
  $0 precheck (`LOOP-RESULT: NOTHING-TO-DO ... daily session cap reached`). Your `loop:request`
  issues bypass it (`Get-DailyCapDecision -Request`): their intake and builds are not counted; the intake kind has its own cap of 6.
- **Options** (`"options"` in `sessions.json`): `proposeIssueDigest` (the runner lists the issues once and
  puts a compact `KNOWN_ISSUES` block in the proposal header, so the session does not list them itself),
  `proposeMetricsDigest` (the runner GETs `/api/metrics/summary` for 7 and 30 days and puts it in the
  proposal / review header as `METRICS`, so the session needs no HTTP call for it),
  `compactPrompts` (LOOP.md blocks marked `<!-- only:build -->` stay out of proposal and review prompts),
  `logKeepDays` (30: older prompts, transcripts and summaries are deleted at the start of a run;
  `*.rundata.json` and `run-<id>.log` are kept for the ops hub; a dry run only lists them; 0 = never),
  `digestMaxIssues` and `digestDeployedDays` (deployed issues listed only from the last N days).
  **No-op runs cost nothing.** Before it starts any session, `run-loop.ps1` asks `check-approval.ps1 -List` for
  the queue. When nothing approved is buildable (FULL mode) and no proposal slot is free, it logs `precheck:
launch=False (...)`, writes a summary ending `LOOP-RESULT: NOTHING-TO-DO` and `run-<id>.rundata.json`
  (cost 0), and exits 0 without a session. If that check fails, the run starts claude as before.

**Plan budget (the ops hub).** The loop shares your Max plan's 5-hour and weekly limits with your own use, so
before every session the runner (never claude) reads `D:\hub\state\plan-budget.json` (written by the ops hub
every 15 min) and logs `budget: ...`:

- `normal`: as always.
- `no-opus`: no session on an Opus model (only the Opus builds above: `model:opus`, server deploys, Opus retries).
  Those builds are deferred, not failed: they stay approved with no label or comment change and are built
  by the first run whose verdict allows it (the daily run, a refill run, or a new approval). Sonnet builds,
  proposals and the review still run.
- `hold`: no session at all; the run exits 0 like the precheck, with `LOOP-RESULT: NOTHING-TO-DO plan budget
hold (no claude session)`.
- Missing, unreadable, schema not 1, unknown verdict, or older than its `staleAfterMinutes`: treated as
  `normal` with a WARN (fail open: the hub is optional, the plan's own limits are the backstop).
- `run-loop.ps1 -IgnoreBudget` skips it for a supervised run (`-BudgetFile <path>` reads another file, for
  dry runs). The rules are `Get-PlanBudgetVerdict` / `Split-BuildableByBudget` in `gate-rules.ps1`, tested in
  `test-gate-rules.ps1`. The approval watcher reads the verdict only for its queue drain (below): no drain run
  under `hold`, nor under `no-opus` when every buildable issue needs Opus.

**Queue drain (the approval watcher).** A run ends with approved work left over when it reached MaxBuilds, ran
out of time or deferred a build. At the end of every FULL run the runner writes
`<LOOP_HOME>\state\drain.json` (what `check-approval.ps1 -List` still calls buildable, which of those need Opus,
and the last runs' queue head and progress; log line `drain state: ...`). Every 10 minutes the watcher reads it
as data and starts the task again (log `started innovation-loop-cardlens to drain the queue (...)`) when at
least one approved issue (or an auto-approved slice / request issue) is buildable, no run holds the lock and the
last run ended 15+ minutes ago. Never under `hold`, nor `no-opus` when every buildable issue needs Opus, nor after
a run that stopped on an uncertain deploy (nor while the needs-Ve flag is set, see "Needs Ve: an uncertain deploy"); after a rollback, or when the last 2 runs had the same queue head and
deployed nothing, it backs off 2 hours. At most one drain run per finished run. Rule: `Get-DrainDecision` in
`gate-rules.ps1` (the watcher keeps a literal copy, checked by `test-queue-rules.ps1`).

**Failed builds: one automatic retry, and never silent.** Every failure comment carries a hidden failure
marker with a class (LOOP.md section 3, "Failure classes"). When the cause was outside the change (CI
infrastructure, CI timeout, the live-server gap refusal, the elevated task or its lock unavailable, running
out of time, the run's time or turn limit), the next run builds it ONCE more: it swaps `loop:failed` for
`loop:retried`, continues the open PR if there is one, and a second failure waits for you. A failure caused
by the change (tests still failing after the fix rounds, a refusal of the PR's own diff, out of scope, a
rolled-back deploy) is never retried automatically, with one exception: a build on Sonnet (or any non-Opus model)
whose failure is `tests` or `other` (or `max-turns` / `max-budget`) gets its one retry on Opus. The marker names the
build's model (`model=...`); markers without it never get that retry. If the session is killed mid-build (time limit, turn
limit, USD cap), the runner marks the issue `loop:failed` itself (class `timeout` / `max-turns` / `max-budget`, retried once;
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
  instructions. Comments your interactive Claude agents post as `vekbui96` carry `<!-- claude-agent -->`:
  they are never adjustments, never product decisions (`decisions.jsonl`) and never loop output. A past
  agent comment without it is retracted in the store with an `ignore` record (`New-DecisionIgnore`).
- If you **edit the issue body after approving**, the loop will not build it until you remove and re-add
  `approved`, so what gets built is what you approved.
- A proposal marked **Manual / needs Ve** is never built or deployed by the loop: card index / recognition,
  scanner gate constants (`phash.ts` + `judge.py`), `/api/target/*`, sync merge/validation rules, cache
  version bumps, secrets / `.env` / NSSM env, Funnel, CORS. `merge-pr.ps1` refuses PRs touching them.
- To reject: close the issue. The loop will not propose it again.
- **Slices of a spec you approved** need no `approved` of their own (see "Specs"). To **veto** one, comment
  `/hold` on it (any comment of yours starting with `/hold` or `hold`); a `/hold` on the spec (after you
  approved it) holds every slice. Closing the slice or the spec also stops it. Adding then removing
  `approved` on a slice, or editing its body, also takes it out of auto-approval. To build a held or edited
  slice after all, add `approved` to it by hand. An earlier slice that is still open and failed or Manual
  holds the later ones until you close it. An auto-approved slice that fails is not retried automatically:
  remove `loop:failed` to rebuild it, or close it.

### Your standing policy: approval via-policy (`AUTONOMY.json`)

On 2026-11-23 you decided that the loop should stop waiting for you on most of its own ideas: **"Everything but
server/data"**, for CardLens and the Ops hub (not the portfolio). That decision is written down in
`innovation/AUTONOMY.json`, your file (read from this checkout like FOCUS.md; the loop's sessions can never write it:
the guard denies it and `merge-pr.ps1` refuses `innovation/**`):

```json
{ "enabled": true, "vetoHours": 6, "includeSpecs": true,
  "exclude": ["server-deploy", "stored-data", "manual", "protected"], "setBy": "vekbui96", "setOn": "2026-11-23", ... }
```

- **What qualifies** (gate-rules.ps1 `Get-ViaPolicyDecision`, deterministic, fails closed): the loop's own open
  proposal (loop marker, opened by your account; not a slice, not a request's issue, no `approved`), or a spec when
  `includeSpecs` is true (its slices then follow the via-spec rule, and each slice must itself qualify); not Manual,
  not `loop:failed`; "What deploys" says **Pages only** (a spec: every slice); Scope "In scope for the loop"; and it
  names no stored data shape, sync / merge rule, scanner gate or card index, secret, CORS / CSP, `innovation/` / CI,
  Target bot, metrics event or protected path (outside a clause that negates it, like "no stored shape changes").
- **The notice and your veto.** When an issue first qualifies, the runner (never a session) posts ONE comment:
  "Auto-approves via Ve's policy at <time> unless you comment `/hold`. Policy: innovation/AUTONOMY.json", and records
  it in `<LOOP_HOME>\state\via-policy.json`. Six hours later it is built without an `approved` label (the watcher
  starts a run when the window ends). To stop it for good: comment `/hold` (or `hold`), close it, or edit its body
  (an edit after the notice cancels the auto-approval). Adding `approved` yourself builds it at once. Removing
  `approved` after adding it is a decision too: no auto-approval.
- **Backstops.** `check-approval.ps1` reports `approval: via-policy (vetoes at <time>)` while the window runs and
  `approval: via-policy` once due; `merge-pr.ps1` re-checks it, refuses any protected path, and refuses a via-policy
  merge that needs a server deploy. The plan budget `hold` holds approvals too. The loop never adds `approved`.
- **What auto-shipped.** Every notice, status change and build outcome is appended to
  `<LOOP_HOME>\state\via-policy-log.jsonl`; `state\via-policy.json` has the current status of each noticed issue
  (waiting, due, deployed, failed, held, voided, gone, ...) and `nextDueAt`. The run summary, the Run data comment and
  the progress comment say "approved via Ve's standing policy". Last 7 days:
  `Get-Content "$env:USERPROFILE\.innovation-loop-cardlens\state\via-policy-log.jsonl" | ConvertFrom-Json | Where-Object { [datetime]$_.ts -gt (Get-Date).AddDays(-7) }`
- **Off switch.** Set `"enabled": false` in `innovation/AUTONOMY.json`, commit and push from `D:\projects\cardlens`:
  from the next check on everything waits for your `approved` again (waiting issues show `off`). A missing, unreadable
  or malformed file means manual approval too.
- Dry run (read-only, posts nothing): `innovation\check-approval.ps1 -List -PolicyPreview` lists what the policy
  would decide for every open proposal, approved ones included.

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
powershell -ExecutionPolicy Bypass -File D:\projects\cardlens\innovation\run-loop.ps1 -MaxBuilds 1   # one build per run (default 4)
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
  checks the served `index.html` -> `/cardlens/assets/index-*.js` -> every chunk reachable from it at any
  depth (`live-check.ps1` Find-InChunkGraph: Vite nests lazy chunks, e.g. entry -> V2App -> the v2 Home
  chunk; capped at 400 files, every one must load) for a change-specific string, and renders the page in headless Edge (a blank SPA returns 200). Rollback: `git revert` of the
  merge on main + push, then the same checks for the string being gone.
  A change with no visible string (it only ADDS `src/` modules nothing imports yet, e.g. a model for a later
  slice; #145) passes `-NoVisibleString "<reason>"` instead: `live-check.ps1` Get-NoVisibleStringDecision must
  prove from git that every front-end file in the merge is new under `src/` and no shipped file uses
  `import.meta.glob` (else the deploy refuses and reverts), `test-gate.ps1` also checks the new modules are
  absent from the built source maps, and the live check is the same Pages-run / every-chunk / render check
  without a string. Any modified shipped front-end file keeps the string mandatory.
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

## Needs Ve: an uncertain deploy

When a build merges a change but the deploy is neither verified nor rolled back and verified (a deploy killed half
way, a failed rollback, a session that ended between merge and deploy), the runner stops the run with
`DEPLOY STATE UNCERTAIN, NEEDS VE` and writes the **needs-Ve flag**, `C:\Users\Ve Bui\.innovation-loop-cardlens\state\needs-ve.json` (run id, issue,
reason, time). It is a file of its own: no later run, `drain.json` or label can overwrite or lift it. While it
exists:

- every run of the loop (the daily task, `Start-ScheduledTask`, `-ProposeOnly`) stops before any claude session:
  summary `Needs-Ve stop`, `LOOP-RESULT: FAILED NEEDS VE: ...`, cost 0, exit 1. Nothing is built, merged, deployed or
  proposed, and `drain.json` is not rewritten;
- the approval watcher starts the loop for nothing (approvals, requests, refill, queue drain) and logs each skipped
  trigger once: `... approval skipped: NEEDS VE since ...`. Approvals made in the meantime are not used up: they start
  the loop once the flag is cleared;
- the run that set it says so in its summary (`NEEDS VE: the needs-Ve flag is set ...`), its run data
  (`needsVe`) and a `## Needs Ve: the loop is stopped` comment on the issue, plus a loud `NEEDS VE: the loop is stopped` line at the top of its Run data comment.

What to check, then clear it (normal PowerShell):

```powershell
# 1. what happened: the flag, the run's summary and log, and the deploy / rollback records
D:\projects\cardlens\innovation\clear-needs-ve.ps1                 # shows the flag, changes nothing
Get-Content C:\Users\Ve Bui\.innovation-loop-cardlens\logs\run-<runId>.summary.txt
Get-Content C:\Users\Ve Bui\.innovation-loop-cardlens\state\deploy-<n>*.json, C:\Users\Ve Bui\.innovation-loop-cardlens\state\rollback-<n>*.json
# 2. production: load the live site and the health check; fix by hand (deploy, roll back, revert) as needed
# 3. clear it, saying what you checked (kept with the record in state\needs-ve-cleared-<time>.json and logs\needs-ve.log)
D:\projects\cardlens\innovation\clear-needs-ve.ps1 -Clear -Note "live site OK; #39 reverted by hand"
```

The next daily run or watcher poll (within about 10 minutes) starts the loop again. Only you can clear it: the loop's
sessions cannot run `clear-needs-ve.ps1` or write `state\` (guard.mjs), and the script refuses to run inside a
loop run. A flag file that cannot be read still blocks (fail closed). Rules: `Get-NeedsVeBlock` in `gate-rules.ps1`
(literal copy in the watcher, checked by `test-queue-rules.ps1`).

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

# Testing traps

Moved out of CLAUDE.md; read before writing or debugging tests.

- **The e2e API server writes to a scratch dir**, not `D:/services` — see the
  `webServer` env in `playwright.config.ts`. It also runs with a real
  `COLLECTION_TOKEN`, which is what lets `binders.spec.ts` exercise the actual
  image upload instead of asserting against a 401. Without those paths a test
  run on SERVER-PC would write into the live collection.
- **On SERVER-PC itself, run e2e on other ports**: `CL_E2E_PORT=5273
CL_E2E_API_PORT=8887`. The default API port is 8787 — the LIVE `cardlens`
  service's port — and `reuseExistingServer` is on locally, so a plain run there
  reuses the live server and none of the scratch paths apply.
- **e2e runs on in-memory mocks** (`VITE_USE_MOCKS: "true"` in `playwright.config.ts`). `page.route` interception does nothing for catalog data, so network-failure behaviour cannot be tested there — use a component test with a provider you control.
- **A hanging request is not an aborted one.** An abort settles the query and lets error/empty states through; a hang pins `isLoading` forever. The Collection screen bug (permanent "Loading sets…" on the glasses) only reproduces with a promise that never resolves.
- **Verify a regression test actually fails without the fix.** Two attempts at the above passed against the bug before one reproduced it.
- **`e2e/bulk-mark.spec.ts` races a real 1200ms window, and local parallelism starves it.** The triple-pinch is three `press()` calls, each a CDP round-trip, that must all land inside the burst window the product genuinely enforces. Measured 2026-08-28: **4/4 pass at `--workers=1`, roughly 3 failures in 5 full-suite runs at the default worker count.** The product is correct in both cases — the harness simply loses the race. CI was always covered (`workers: 1`, `retries: 2`); the block now carries `test.describe.configure({ retries: 2 })` so a local full run stops crying wolf. **Do not "fix" it by dispatching synthetic `KeyboardEvent`s in the page** — they never reach `KeyboardBackedInputAdapter`, so the test passes having exercised nothing. Tried, measured as consistently failing, reverted.
- **Throwaway browser scripts on SERVER-PC:** Playwright is only installed in
  this repo, so run them from `D:\projects\cardlens` or
  `require('D:/projects/cardlens/node_modules/playwright')`. SERVER-PC resolves
  `server-pc.tail0e4194.ts.net` to the public Funnel relay, so tailnet-only ports
  (the hub dashboard on :8444) need Chromium's
  `--host-resolver-rules="MAP server-pc.tail0e4194.ts.net 100.75.251.52"`.
- **Running checks: use the `cardlens-test-runner` agent** (Haiku). It runs
  `npm run verify` and, only when screens changed, e2e on the isolated ports, then
  returns a summary that labels failures KNOWN (on the list below) or NEW.
- **A full-page screenshot resizes the window to 1x1 for a moment.** That read as the glasses (small and square) and remounted the whole app mid-test, cancelling in-flight queries; the v2 Home rate-limited snapshot flipped between two states because of it (2026-11-24). `nextLayoutMode` now ignores sizes under 200px. If a visual case shows a state its own assertion contradicts, suspect a remount during the shot.
- Tombstone tests need plausible epoch timestamps — `deletedAt: 300` is 1970 and gets pruned as ancient before any assertion sees it.

## Known failures on SERVER-PC

Failures that happen on this box for reasons unrelated to the change being
tested. The `cardlens-test-runner` agent labels a failure KNOWN only if it
matches an entry here (spec file and test title). Remove an entry once it's fixed.

- `e2e/scan.spec.ts` "routes to the server when connected, and falls back when it cannot"
  (phone and desktop): the test expects no recogniser behind the e2e server, but
  the live `recognition` service on :8200 answers. Passes in CI.
- `npm run e2e:visual` (v2 `@visual` screenshot tests): the baselines are Linux
  (CI), so they don't match on Windows. Not part of `npm run e2e`. A local run
  writes `*-win32.png` snapshots: never commit them.

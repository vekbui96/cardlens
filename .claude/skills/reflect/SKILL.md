---
name: reflect
description: End-of-session retrospective for CardLens. Use when Ve says "reflect", "/reflect", "what did we learn", "wrap up", or at the end of a long session. Lists what went wrong or took more than one try, proposes the smallest edit to CLAUDE.md, a doc, an agent or a skill that would have prevented each, and applies only what Ve approves.
---

# Reflect

Turn this session's friction into the smallest durable fix, so the next session
(or the next agent) does not pay for it again. Runs in the main session because
it needs what actually happened, not a summary.

## 1. Collect evidence (no proposals yet)

From this session, list each place where something:

- failed and had to be retried (a command, a test, a deploy, a commit);
- needed a workaround, or a rule had to be rediscovered;
- was rediscovered by more than one agent (strong signal: write it down once);
- contradicted a doc, agent or skill (the doc was wrong or stale);
- cost a lot of tokens or time for little result (e.g. reading a huge file).

Each item needs concrete evidence: the command, the error line, the file and line.
Skip one-off typos and anything already fixed in code with a test.

Also run `git log --oneline -15` and `git status -s` to see what the session
changed. Note any rule the session added to code that a doc should now mention.

## 2. Propose (at most 5, best first)

For each item, propose **one** edit:

```
N. <problem in one line> — evidence: <command/error/file:line>
   File: <path>   Kind: add | replace | delete
   <the exact text, as a diff or before/after>
```

Where a fix belongs:

| Kind of lesson                                  | Goes in                                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| A durable rule that every session must know     | `CLAUDE.md` (one line, link to the doc)                      |
| Detail, measurement, incident story             | the matching `docs/*.md` (index in `CLAUDE.md`)              |
| A step in a procedure                           | that skill (`ship`, `advance`, ...)                          |
| How an agent should work                        | `.claude/agents/<agent>.md`                                  |
| Current state (live, waiting on Ve, half-built) | `docs/handoff.md`: replace stale lines, never append a diary |
| Known test failure on SERVER-PC                 | `docs/testing.md`, "Known failures on SERVER-PC"             |

Rules for proposals:

- **Smallest edit that would have prevented it.** Prefer tightening or replacing
  an existing line over adding one. `CLAUDE.md` stays near 90 lines; if a proposal
  grows it, say which line it could replace or move to `docs/`.
- **Check it isn't already there.** `Grep` for the rule first. If it exists but
  was missed, the fix is to make it findable (better placement, sharper wording),
  not a duplicate.
- **Never edit** `innovation/`, `innovation/FOCUS.md` or `innovation/PRODUCT.md`.
  Those belong to Ve and the loop. You may _propose_ text for them, marked "Ve to
  apply".
- **No speculative rules.** Every proposal cites something that happened in this
  session.
- If nothing is worth fixing, say so in one line and stop. An empty reflect is fine.

## 3. Wait for approval

Show the list and stop. Ve answers per item (e.g. "1, 3, 4", "all", "none", or an
edit). Do not apply anything before that.

## 4. Apply and commit

- Make exactly the approved edits. Run `npm run format:check` if any file Prettier
  covers changed (Markdown under `docs/` is covered).
- Commit only those files. Write the message to a file and use
  `git commit -F <file>`. In Windows PowerShell 5.1, an inline `-m` with double
  quotes splits into pathspecs, and `Set-Content -Encoding utf8` adds a BOM, so
  write the file with `[IO.File]::WriteAllText(path, text)`.
  - Subject: `reflect: <short summary>`.
  - End the message with the session's attribution line.
- Push to `main`. These are docs/agent/skill files, so nothing needs deploying.
- Report: which proposals were applied, which were skipped, and any "Ve to apply"
  text.

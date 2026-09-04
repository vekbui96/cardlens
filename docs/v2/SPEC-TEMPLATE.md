# Spec: <screen>

> Copy this file to `specs/NN-<name>.md`. Every heading is required. A spec that
> cannot fill in **Acceptance** is not ready to be built from.

## Purpose

One paragraph. What question does a person open this screen to answer? Not what
it contains — what it is FOR. If two screens have the same answer here, they are
one screen.

## Parity checklist

Every behaviour v1 has that v2 must keep, as a tickable list. Derived from the
v1 source, not from memory — link the file. Anything deliberately **dropped**
goes in its own list with a reason; "we forgot" is not a reason, and a silent
omission is how a rebuild loses features.

- [ ] …
- [ ] …

**Dropped on purpose:** …

## Data

Which hooks and stores it reads, and **what each costs**. A request per set, a
request per card, a disk cache, nothing. This is where a screen accidentally
becomes expensive, so it is stated before it is built (see Home in `CLAUDE.md`:
nineteen calls at 4.5–6.7s each).

## States

Every one, including the ones nobody demos:

| State                                | What shows |
| ------------------------------------ | ---------- |
| Loading                              |            |
| Empty (nothing yet)                  |            |
| Empty (filtered to nothing)          |            |
| Error / offline                      |            |
| Partial (some data priced, some not) |            |
| Full                                 |            |

"Partial" is not optional here. This app's oracles routinely answer for some
sets and not others, and a screen that can only render all-or-nothing lies.

## Layout

At **390px** and at **1440px** — both, explicitly. Say which primitives from
`src/v2/primitives/` it composes. If it needs one that does not exist, that is a
foundation request, not a local component.

## Interactions

Pointer and keyboard. Touch targets ≥44px. What is destructive and therefore
confirms. What is undoable and therefore does not.

## Acceptance

Testable statements, each one an assertion someone could write:

- [ ] …

## Out of scope

What this stream must NOT touch, so two streams do not both build it.

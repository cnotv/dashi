---
name: start
description: >-
  Use first, at the start of every new request in a repository, before reading code or
  writing anything — a question, a bug, a feature, "let's try X", "look into Y", a linked
  issue, or a session opened from Dashi, the agent dashboard, with a workflow already named.
  Picks the workflow that fits the request and lists the skills to run, in order.
---

# Picking the workflow

Classify the request, name the workflow out loud in one line, then follow its steps. If the
session was opened with a workflow already named (`/workflow:start fix`), use that one and skip
the classification.

Read the repository's `AGENTS.md` first: its **Project facts** section holds the commands,
ports and paths every skill below relies on.

## Workflows

| Workflow   | Use when                                                         | Steps                                                                                           |
| ---------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `research` | A question, a comparison, "how does X work", nothing to change   | Answer in chat. No issue, no branch. Offer a journey doc only if the finding is non-obvious.    |
| `feature`  | New behaviour or a new capability                                | `start-issue` -> tests -> implement -> `verify` -> `finish-change` -> `open-pr`                 |
| `fix`      | Something is broken                                              | `start-issue` -> reproduce -> failing test -> fix -> `verify` -> `finish-change` -> `open-pr`   |
| `refactor` | Same behaviour, better structure                                 | `start-issue` -> confirm tests cover it -> refactor -> `finish-change` -> `open-pr`             |
| `docs`     | Only documentation changes                                       | `start-issue` -> write -> docs build -> `open-pr`                                               |
| `design`   | A UI, layout or visual change, with or without a Figma file      | `start-issue` -> read the design source -> implement -> `verify` (screenshot) -> `finish-change` -> `open-pr` |
| `3d`       | A scene, model, material, camera, animation or physics change    | `start-issue` -> implement -> `verify` (two angles) -> the repository's perf skill if it has one -> `finish-change` -> `open-pr` |
| `security` | A security review, a vulnerability, a dependency alert, hardening | `start-issue` -> `security-audit` (mode `full`, `change` or `advisory`) -> fix with a test -> `finish-change` -> `open-pr` |
| `tests`    | Adding or repairing tests only                                   | `start-issue` -> write tests against the issue, not the implementation -> `finish-change` -> `open-pr` |
| `chore`    | Tooling, dependencies, CI                                        | `start-issue` -> change -> checks -> `open-pr`                                                  |
| `conflicts` | A pull request's branch conflicts with the default branch       | No new issue or branch: check out the pull request's branch -> bring in the default branch the way the repository's rules say -> resolve each conflict, keeping what both sides meant -> the repository's checks -> push -> update the pull request's body if the resolution changed what it describes |

A conflict where both sides changed the same logic and keeping either loses behaviour is not
resolved by guessing: stop and ask which behaviour wins.

When a request fits two workflows, pick the one whose verification is stricter: `3d` over
`feature`, `security` over `fix`.

## Rules that hold in every workflow

- If intent, scope or expected behaviour is unclear, ask one focused question covering
  everything missing, and wait. The answer is what the issue is written from.
- Local skills listed under Project facts extend these workflows; run them where their own
  descriptions say they apply.
- The pull request carries one screenshot and one video when anything visible changed (see
  `open-pr`).

## Definition of done

The workflow was named in one line before any other work, and every step in its row was run
or explicitly marked not applicable.

---
name: start-issue
description: >-
  Use before any code is written, at the start of every request that will change the repo,
  whether or not an issue exists yet — a github.com/.../issues/N URL, "start issue 42", "work
  on #42", "add an option for Y", "let's try X", "fix this bug". Covers reading or writing the
  issue, syncing main, and creating the branch with the right name, before any code is
  written. The draft pull request that follows at the first commit is `open-pr`.
---

# Starting work

This sequence runs in order, before a single line of code or documentation is written.
Every request that changes the repository goes through it, including the smallest fix and
the roughest prototype.

## 1. Read or write the issue

An issue that already exists is read properly, comments included:

```sh
gh issue view <number> --comments
```

Otherwise it is written from the request itself, before anything else:

```sh
gh issue create --title "<summary>" --body "..."
```

Keep the body to what and why: what should be true once this lands, and what makes it worth
doing. It is not a plan, and nothing waits on it being approved. Use the repository's issue
templates when it has them.

If the intent, scope or acceptance criteria are unclear, ask one focused question covering
everything that is missing, and wait. Do not start implementing against an assumption.

## 2. Sync main

```sh
git checkout main
git fetch origin main
git rebase origin/main
```

Rebase, never `git pull` — `pull` merges by default.

## 3. Create the branch

```sh
git checkout -b <type>/<number>-<slug>
```

- `type` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- `slug` is a two or three word kebab-case summary of the issue title

Always a fresh branch from main. Never commit to the current branch, and never reuse an
existing feature branch. Dashi, the agent dashboard, links sessions, issues and pull requests through
this name, so a branch that breaks the pattern disappears from the board.

If the session runs in an environment that assigns its own branch, say so in one line and
ask which name to use before committing.

## 4. Implement, and open the draft pull request at the first commit

Tests first: write the specifications, then the implementation that satisfies them. An
exploratory prototype may go straight to something running, but still owes its tests before
the pull request is marked ready. The first commit is followed straight away by the draft
pull request (`open-pr`).

## Keep the issue current while you work

Comment on the issue when a discovery changes how the work is done, when the work departs
from what was asked (with the reason), when a question blocks progress, or when scope is
added or dropped. If the change invalidates the description rather than adding to it, edit
the body with `gh issue edit <number>` so it reads as one clean, current description — do
not append a changelog of the edit.

## Breaking a large issue into subtasks

Create each subtask as its own issue, then attach it with GitHub's native sub-issue
relationship so progress is tracked:

```sh
gh api --method POST repos/<owner>/<repo>/issues/<parent-number>/sub_issues \
  -F sub_issue_id="$(gh api repos/<owner>/<repo>/issues/<child-number> --jq .id)"
```

## Definition of done

`git branch --show-current` reports `<type>/<number>-<slug>`, the branch is based on an
up-to-date main, and the issue it is named after is open and describes what and why. Commit
subjects never reference the issue number.

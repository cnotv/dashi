---
name: finish-change
description: >-
  Use before claiming work is complete, done, finished, ready or working, and before
  committing or opening a pull request — "is this done", "wrap it up", "finish this off",
  "ready to commit". Runs the repository's checks, makes sure every exported function has a
  JSDoc comment and the linter enforces it, and walks the done-checklist: the registrations,
  docs and follow-up procedures that are easy to omit and hard to notice missing.
---

# Finishing a change

The point of this sweep is the things nobody notices are missing. A forgotten lint fix
surfaces in seconds; a forgotten registration surfaces in months, if ever.

## Run the checks

Run every command listed under **Checks** in the repository's Project facts. Read the output.
"It should pass" is not evidence — if you did not see it pass, it did not pass. If any fail,
the work is not finished, and reporting it as finished with a note about the failure is still
reporting it wrong.

## Doc comments, and the linter that keeps them

Every exported function has a JSDoc comment that describes what it is for and, where it is not
obvious from the code, why it works the way it does: a constraint, a trade-off, what a caller
must know. Write as many lines as that takes; a single line is right only when it truly says it
all. Then `@param` for each argument and `@returns`, with no blank lines inside the block. A
component gets the description without the tags. Types stay in TypeScript, not in the comment.
A why-comment that sat above the function belongs in this block.

The rule holds only because the linter runs it. Check that the repository's lint config turns on
`eslint-plugin-jsdoc` with:

- `jsdoc/require-jsdoc`, with `publicOnly` and arrow functions included;
- `jsdoc/require-param` and `jsdoc/require-returns`.

Tests may be left out. If the config lacks it, adding it, and the comments it then asks for, is
part of this change or its own issue opened now; it is never left unsaid.

## Walk the done-checklist

Walk every line of the **Done checklist** under Project facts. Each is there because it is
invisible when missing.

Then the lines that hold everywhere:

- **Changed a public API** — the reference docs match the new exports.
- **Changed a file a guide documents** — the guide's snippets, option names and paths still
  match.
- **Non-obvious finding along the way** — run `journey-doc`.
- **Visible change** — `verify` was run and the result looked at.
- **Security-sensitive change** — the diff touches authentication, sessions, input handling,
  file or network access, secrets, dependencies, CI workflows or containers: `security-audit`
  was run in `change` mode and its report is in the pull request.
- **Local skills** — any repository skill whose description covers what you touched (a
  performance check, a docs sync) was run.

## Definition of done

Every check was run and its output seen, and every applicable checklist line is done or
explicitly not applicable. State what was verified and how; if something was skipped, say
which and why.

---
name: journey-doc
description: >-
  Use when a fix took more than one attempt, the root cause turned out to be in a library or
  framework rather than our own code, a constraint is invisible from reading the codebase, or
  a design decision came with hard-won context — and use when asked to "write it up",
  "document the why", "add a journey doc", or record a finding, lesson, quirk or gotcha.
  Covers deciding whether a doc is warranted, where it goes, and the prose-and-diagram style.
  Not for API reference.
---

# Writing a journey doc

A journey doc captures the _why_. The code is already in the repository; this is the
reasoning the code cannot show. The test of a good one: it answers "what would have saved me
an hour if I had read it first?"

## Is one warranted?

Write one when any of these is true:

- The fix required more than one attempt
- The root cause was in a library or framework, not in our own code
- A constraint is invisible in the codebase — something that must be done, where nothing in
  the code says so
- The same mistake is plausible for anyone who touches this area later

If none hold, do not write one. A doc recording something obvious costs more to read than it
saves.

## Where it goes

The journey folder named under **Docs home** in Project facts. Extend an existing page if the
topic fits; otherwise create `<topic>.md` with a title, one sentence of scope, and one section
per finding.

## Style

Abstract prose, tables and Mermaid diagrams. **No code snippets** beyond the minimal formula
or fragment that makes the theory concrete — the code lives in the repository and will change;
the reasoning is what needs to survive. Write it in the same change that solved the problem.

## Definition of done

The doc explains the problem, what made it non-obvious, and the correct mental model, without
reproducing the implementation, and the docs build listed under Project facts passes.

---
name: security-audit
description: >-
  Use for anything security-shaped — "is this secure", "audit the dependencies", "check for
  vulnerabilities", "security review", "pentest", "harden this", a Dependabot or npm audit
  alert, a CVE, a leaked key, XSS, injection, CSRF, SSRF, auth or session bugs — and from
  `finish-change` when a diff touches authentication, sessions, input handling, file or
  network access, dependencies, CI workflows or containers. Audits libraries, scans for
  secrets, reviews client, server, CI, container, agent and IoT code against the exploits
  that fit each, and fixes findings with a test that proves the exploit is closed.
---

# Security audit

Find what an attacker could actually do, prove it, close it, and prove it is closed. A list
of scanner output is not an audit; a finding without an attack scenario is a guess.

## Rules for the auditor

- **Only attack what you are allowed to.** Run exploits against a local or development
  instance you started. Never against production, a shared environment or a third-party
  service, even to "confirm", unless the user named it and said so.
- **Never print a secret you find**, in chat, a commit, an issue or a pull request. Report the
  file, line and kind of secret, never the value.
- **No destructive payloads.** Prove injection with a harmless marker (`SELECT 1`, `id`, an
  `alert` that never runs), not by deleting or exfiltrating anything.
- **Install nothing globally without asking.** Run tools through `npx`, `uvx` or `docker run`
  so nothing stays behind. If a tool is not available and cannot be run that way, say which
  check was skipped rather than implying it passed.

## 1. Pick the mode

| Mode       | When                                           | Scope                                                                  |
| ---------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| `full`     | "audit this repo", a new project, a milestone  | Everything below                                                       |
| `change`   | a branch or pull request; from `finish-change` | The diff and whatever it calls or is called by; dependencies it added  |
| `advisory` | one alert, CVE or Dependabot pull request      | Step 3 for that package, then whether the vulnerable code is reachable |

Say the mode in one line before starting.

## 2. Map the attack surface

Before reading code line by line, write down, briefly:

- **Assets**: what is worth stealing or breaking — credentials and tokens, user data, the
  ability to run commands, money, availability.
- **Entry points**: every place outside data arrives — HTTP routes, forms, URL and query
  parameters, headers and cookies, WebSocket and `postMessage` messages, file uploads, webhook
  bodies, environment variables, CLI arguments, and in CI, issue and pull request titles,
  bodies and branch names.
- **Trust boundaries**: where data crosses from someone you do not trust to something that
  acts on it.
- **Surfaces present**, each with its own checklist in `checklists/`:

  | Surface                    | Checklist                      |
  | -------------------------- | ------------------------------ |
  | Browser client             | `checklists/client.md`         |
  | HTTP server or API         | `checklists/server.md`         |
  | CI, containers, deployment | `checklists/ci-and-infra.md`   |
  | AI agents and LLM features | `checklists/agents-and-llm.md` |
  | Devices, MQTT, firmware    | `checklists/iot.md`            |

If the repository's Project facts has a **Security** line pointing at a threat model, start
from it and update it when the map changes.

## 3. Audit the dependencies

1. **Known vulnerabilities**, with the package manager's own audit, production dependencies
   first:
   - pnpm: `pnpm audit --prod`, then `pnpm audit` for the dev tree
   - npm: `npm audit --omit=dev`, then `npm audit`
   - Python: `uvx pip-audit`; other ecosystems: their native audit
2. **Cross-check against OSV**, which covers more advisories and ecosystems:
   `docker run --rm -v "$PWD:/src" ghcr.io/google/osv-scanner scan source -r /src`
   (or `osv-scanner scan source -r .` if installed).
3. **Triage every finding** — severity alone decides nothing:
   - Does it ship? A dev-only tool with a vulnerable parser is rarely urgent; the same package
     in the server bundle is.
   - Is the vulnerable function reachable with attacker-controlled input from an entry point
     in the map? Search for the call.
   - Is there a fixed version? Upgrade the direct dependency. For a transitive one, upgrade
     its parent first; only if that is impossible, pin with `pnpm.overrides` / `overrides` /
     `resolutions`, with a comment naming the advisory and when to remove it.
   - Not fixable and reachable: mitigate at the call site (validate, disable the feature) and
     say so. Not reachable: record why, in the pull request, rather than silencing the tool.
4. **Supply chain**, for every dependency the change adds:
   - Actively maintained (a release in the last year, issues answered), widely used, and the
     name is not a near-miss of a popular package.
   - Install scripts: pnpm runs none unless listed in `onlyBuiltDependencies`; keep that list
     short and justified.
   - The lockfile is committed and CI installs with `--frozen-lockfile` / `npm ci`.
   - Nothing installs with `curl | sh` or from an unpinned URL.

## 4. Scan for secrets

- **Working tree and history**:
  `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks git /repo` (history) and
  `... gitleaks dir /repo` (files, including untracked ones).
- **The client bundle**: build it, then search the output for key-shaped strings
  (`sk-`, `ghp_`, `github_pat_`, `AKIA`, `-----BEGIN`, `eyJ`). Anything a bundler inlines from
  `VITE_*`, `NEXT_PUBLIC_*` or `PUBLIC_*` variables is public by design; a secret there is
  leaked.
- **Logs and errors**: secrets must not appear in log lines, error messages returned to
  clients, or CI output.
- **A real secret found**: tell the user immediately to **revoke or rotate it first**; removing
  it from the code does not un-leak it. Rewriting history is the user's call, never yours.

## 5. Static analysis

Run what fits the surfaces; each finding still goes through the checklist and triage below.

- **Code**: `uvx semgrep scan --config p/default --error` (add `p/owasp-top-ten`, and the
  language packs such as `p/typescript`, `p/react`, `p/nodejsscan`, `p/python`).
- **GitHub Actions**: `uvx zizmor --offline .github/workflows` ([zizmor](https://docs.zizmor.sh),
  [GitHub](https://github.com/zizmorcore/zizmor)). Its online audits call the
  GitHub API with whatever `GH_TOKEN` is in the environment; run them only when the user has
  said that token is meant for it. It flags every action not pinned to a commit; apply the
  pinning rule in `checklists/ci-and-infra.md` rather than pinning everything.
- **Dockerfiles**: `docker run --rm -i hadolint/hadolint < Dockerfile`.
- **Filesystem and images**: `docker run --rm -v "$PWD:/src" aquasec/trivy fs --scanners vuln,secret,misconfig /src`,
  and `aquasec/trivy image <image>` for a built image.
- **The repository's own linters** from Project facts, and GitHub code scanning results if
  the repository has them.

## 6. Review against the checklists

Walk the checklist of every surface in the map. For `change` mode, walk only the items the
diff can affect, but follow data from the changed entry points to wherever it ends up. Read
the code; scanners miss logic flaws — a route with no ownership check, a guard that runs after
the side effect, a redirect that trusts a query parameter.

## 7. Prove it, then fix it

For each finding worth fixing:

1. **Write the exploit as a test first** and watch it fail for the right reason: the payload
   is rendered as markup, the `../` path is served, the unsigned request is accepted, the
   route answers without a session.
2. **Fix it the boring way**: the framework's safe API over a hand-written sanitiser —
   parameterised queries, `execFile` with an argument array, text instead of HTML, an
   established sanitiser (DOMPurify) when HTML is really needed, a schema validator on every
   body, an allowlist over a denylist.
3. **Watch the test pass**, and keep it: it is the regression guard.
4. Never "fix" by disabling a check, a rule or a test, or by catching and ignoring the error.

A finding you cannot reproduce stays in the report marked **unverified**, with what would
confirm it.

## 8. Report

One entry per finding, most severe first:

| Field    | Content                                                                  |
| -------- | ------------------------------------------------------------------------ |
| Severity | critical, high, medium, low or info: exploitability times impact         |
| Where    | `path:line`, or the package and version                                  |
| Attack   | what an attacker sends and what they get, in one or two sentences        |
| Status   | fixed (with the test's name), mitigated, accepted (with why), unverified |

- `change` mode: the report goes in the pull request under **Security**, and each fix ships in
  that pull request.
- `full` mode: fix critical and high findings on the audit's branch; open one issue per
  remaining finding, grouped by surface, unless the user says otherwise.
- A pattern that could recur (a sink, a missing guard) becomes a rule in the repository's
  scoped rules or `AGENTS.md`; a surprising root cause becomes a journey doc (`journey-doc`).

## Definition of done

The mode was named, the surface map written, every step that applies was run or explicitly
skipped with the reason, every finding has a severity, a location and an attack scenario, and
every fixed finding has a test that failed before the fix and passes after it.

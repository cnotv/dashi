# CI, containers and deployment

Each line is a question to answer with a location in the code, not a yes from memory.

## GitHub Actions

- **Script injection**: no `${{ github.event.* }}`, `${{ github.head_ref }}` or other
  attacker-editable value (titles, bodies, branch names, commit messages) inside `run:`.
  Pass them through `env:` and quote the variable.
- **`pull_request_target` and `workflow_run`** never check out or run code from the pull
  request's head with secrets or a write token in scope.
- **`permissions:`** is declared at the top of every workflow, read-only by default, widened
  per job only where needed.
- **Third-party actions** come from maintained publishers, pinned to a release; for anything
  outside `actions/*` and well-known vendors, pin the commit SHA.
- **Secrets** are not echoed, not passed on the command line, and not available to workflows
  triggered from forks.
- **Artifacts and caches** from untrusted runs are not trusted by privileged ones.
- **Self-hosted runners** are never used for public repositories' pull requests.

## Containers

- The image runs as a **non-root user**, from a small, maintained base image on a supported
  major version.
- **No secrets in layers**: nothing sensitive in `ARG`, `ENV`, or a `COPY` that a later layer
  deletes; `.dockerignore` excludes `.env`, `.git` and local data.
- **Published ports** are only the ones needed, bound to `127.0.0.1` when only a local proxy
  should reach them.
- Build tools and dev dependencies are not in the runtime image.

## Deployment and hosts

- **Only a proxy is public**: databases, admin panels, debug ports and internal services
  listen on private interfaces or a container network.
- **TLS** everywhere a browser or client connects, with HSTS once it works.
- **Settings files** written on a server (`.env`) are readable by the service user only.
- **SSH** deploy keys are specific to the deploy, not a personal key, and the deploy user can
  do nothing beyond deploying.
- **Backups** of data that holds secrets are encrypted.

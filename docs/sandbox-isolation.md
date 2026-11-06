# Choosing the isolation layer for sandboxed starts

Decision record for issue #119, part of the sandboxed execution epic (#118). It picks what the
laptop runner (`apps/runner/src/runner.ts`) and a future Linux runner host use to isolate one
agent start, so that #120 (sandboxed start target), #121 (egress allowlist), #122 (credentials)
and #123 (resource limits) build on one thing.

## Decision

Use **rootless OCI containers**, driven through one small runtime adapter (the `docker` or
`podman` CLI, arguments only, never a shell). On macOS the containers run inside the Linux VM
that Docker Desktop, Colima, OrbStack or Apple's `container` tool already provides; on a Linux
server they run directly under rootless Podman or Docker. gVisor (`runsc`) is an optional
hardening switch on Linux hosts, set per runner and not required. Firecracker is deferred to
the multi-tenant runner (#124), where mutually untrusted people share a host.

Why: it is the only option that runs on the runner's main host today (a 16 GB Apple silicon
Mac), starts in about a second, needs no kernel or image pipeline work, and gives the three
controls the next issues need (an egress choke point, cgroup limits, a short mount list) with
tools the team already knows. The cost is a shared kernel on Linux hosts; the trade-offs below
say what that buys and when to move up.

## What a start needs inside

From `runner.ts` and the README: `git`, Node 22.18 or later (the runner and hooks rely on type
stripping), Claude Code, opencode, and `tmux` 3.2 or later for sessions steered from the phone
(`claude --remote-control`). One image, `dashi-sandbox`, built from a `node:22` Debian base with
those installed, covers every agent. The image carries no credentials and no host paths. The
worktree is the only bind mount (read-write). The clone stays on the host, and a worktree's
`.git` file points at the clone's object store, so #120 must either mount the clone's `.git`
directory read-only beside the worktree or clone inside the sandbox. That choice belongs to #120.

## Comparison

| | Rootless container (Docker or Podman) | gVisor (`runsc`) | Firecracker microVM |
| --- | --- | --- | --- |
| Isolation boundary | Shared host kernel; user namespaces, seccomp, capabilities dropped | User-space kernel (Sentry) intercepts syscalls; much smaller host kernel surface | Hardware virtualization (KVM); own guest kernel |
| Fresh start with a worktree mounted | Roughly 0.3 to 1 s with the image present on Linux; about 1 to 3 s on macOS if the VM is already up (the spike records a measured figure when run) | Container start plus a small extra for the Sentry; slower file I/O on bind mounts | About 125 ms boot to init by Firecracker's own claim, plus building a root filesystem and getting a worktree in (no virtiofs, so a disk image or a network share) |
| macOS (Apple silicon) | Yes, through a Linux VM: Docker Desktop, [Colima](https://github.com/abiosoft/colima), [OrbStack](https://orbstack.dev/), or Apple's [`container`](https://github.com/apple/container) (macOS 26, one lightweight VM per container) | No. Linux only; it could run inside the Linux VM of the tools above, which stacks two layers | No. It needs KVM, which macOS lacks; it would run in a Linux VM with nested virtualization (M3 or later, macOS 15 or later), which is fragile |
| Linux server | Yes; rootless Podman is first class | Yes; registers as a Docker or Podman runtime on x86_64 or arm64 | Yes, with `/dev/kvm` on bare metal or a nested-virtualization instance; many cheap VPS tiers do not expose it |
| Egress allowlist | Internal network with no route out and one proxy as its only neighbour (allowlist by host name); or nftables rules in the container's network namespace on Linux | Same network model; gVisor has its own network stack, so a proxy is the clean choice | Tap device per VM; host nftables filter by IP; a proxy again does host names |
| CPU, memory, pids | cgroup v2 flags `--cpus`, `--memory`, `--pids-limit` (rootless Linux needs cgroup delegation; on macOS the VM's size is the outer cap) | Same flags | vCPU count and memory fixed at boot, a hard cap |
| Disk | `--storage-opt size=` only on some storage drivers; reliable route is a size-capped `tmpfs` for scratch and a quota or size-limited volume for the worktree | Same | A fixed-size block device, a hard cap |
| Wall-clock limit | Runner timer, then `stop` by container name | Same | Runner timer, then VM shutdown |
| Operational weight | Lowest; Docker is already known | Low on Linux; one more runtime to patch | Highest: kernel and rootfs images, jailer, networking, snapshots |
| Main weakness | A kernel escape reaches the host | Syscall coverage gaps (some tools fail), slower I/O | Needs KVM; does not fit the laptop |

Start times come from vendor documentation and independent write-ups, not from this machine. A
[published comparison](https://dev.to/aairom/inside-apple-containers-architectural-deep-dive-cli-parity-and-benchmarking-against-podman-48ja)
puts Apple's `container` at about 1 to 3 s for a first container against about 0.3 to 1 s for
Podman on macOS, while vendor posts claim sub-second. Treat both as unverified.

### macOS runtime options

| Runtime | Notes |
| --- | --- |
| Docker Desktop | Common; licence terms apply to larger companies; one shared VM |
| Colima | Open source, Lima VM with Docker or containerd inside; one shared VM sized by profile (CPUs, memory, disk) |
| OrbStack | Fast and light; commercial licence; one shared VM |
| Apple `container` | macOS 26 and Apple silicon; a VM per container, so the hypervisor is the boundary and a kernel escape does not reach macOS; newer and less proven |

On macOS the boundary is the Linux VM plus the container, and the agent cannot see the Mac home
directory unless it is mounted, so mount only the worktree. Apple's `container` is the strongest
macOS option on isolation and a good later default; the adapter must not hard-code one CLI.

## Trade-offs of the decision

- **Shared kernel on Linux hosts.** A rootless container with dropped capabilities, the default
  seccomp profile and no host mounts beyond the worktree holds up against an agent that makes
  mistakes or a hostile `npm install` script. It is weaker against a determined kernel exploit.
  That is acceptable for one person's laptop or one team's runner. For the multi-tenant runner
  (#124) switch the runtime to gVisor, or to Firecracker if tenants are mutually hostile; the
  adapter makes that a runner setting.
- **The macOS VM is shared** on Docker Desktop, Colima and OrbStack, so two sandboxes share a
  kernel inside it. The VM still shields the Mac itself.
- **Worktrees on bind mounts** are slower on macOS than on Linux, and installing dependencies is
  the heavy path. #120 can put `node_modules` on a named volume.
- **Not chosen, Firecracker now.** No macOS path, KVM needed on servers, and an image and
  network pipeline that costs more than the threat on a single-user laptop justifies.
- **Not chosen, gVisor now.** It adds nothing on macOS and can break tools that use unusual
  syscalls; it stays an opt-in on Linux.

## What the next issues build on

- **#120, sandboxed start target.** Add the target beside `laptop-remote-control`,
  `laptop-headless` and `laptop-cloud`. `LaunchPlan` in `runner.ts` already holds command,
  arguments, cwd and environment; the sandbox target wraps it in
  `<runtime> run --rm --name dashi-<startId> ...` with the worktree as the only `--volume`,
  `--cap-drop=ALL`, `--security-opt no-new-privileges`, a read-only root filesystem with a
  `tmpfs` for `/tmp`, and a non-root `--user`. tmux runs inside the container for remote
  control. Stop and clean up by container name, never by pattern.
- **#121, egress allowlist.** Create an `--internal` network per start and attach one proxy that
  allows the model provider, GitHub, npm and PyPI host names and refuses private ranges and
  `169.254.0.0/16`; set `HTTPS_PROXY` in the sandbox. Log denied requests from the proxy and show
  them on the session. This works the same on every runtime in the table, which is why it is the
  common choke point.
- **#122, credentials.** Pass only the needed variables with `--env NAME` read from the runner's
  environment (never `--env NAME=value`, which shows in `ps`). The container is `--rm`, so they
  go with it. Inject the narrowest GitHub token; keep the rule that values never go in arguments
  or files.
- **#123, resource limits.** Map the four caps to `--cpus`, `--memory` (with an equal
  `--memory-swap`), `--pids-limit`, a size-limited `tmpfs` or volume for disk, and a runner timer
  that stops the container by name. Read the exit reason (`OOMKilled` from `inspect`, the timer,
  a disk-full error) and report it to the board. On macOS document the VM size as the outer limit.

## Spike

Goal: show `claude --version` and `git --version` inside a container with a worktree
bind-mounted read-write and nothing else from the home directory, and time it.

Result: **not run on the machine that wrote this document.** `command -v docker podman colima
orbstack container` found only `colima` (version 0.10.3, one profile named `offee`, stopped, 8
GiB memory). There is no `docker` or `podman` client on the path, and starting that stopped VM
would take half of this 16 GB Mac and use a profile that is not part of this task, so nothing was
installed or started.

Commands to run on a host with a runtime (use `podman` in place of `docker` if needed). No real
credentials are passed and the home directory is not mounted:

```sh
# 1. a throwaway worktree of this repository
git worktree add /tmp/dashi-spike-worktree -b spike/sandbox HEAD

# 2. a minimal image with git, Node 22, Claude Code and tmux
cat > /tmp/Dockerfile.spike <<'DOCKERFILE'
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git tmux ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --global @anthropic-ai/claude-code
USER node
WORKDIR /work
DOCKERFILE
docker build --file /tmp/Dockerfile.spike --tag dashi-sandbox-spike /tmp

# 3. run it: only the worktree is mounted, nothing from $HOME
time docker run --rm --name dashi-spike \
  --cap-drop=ALL --security-opt no-new-privileges --read-only --tmpfs /tmp \
  --cpus 2 --memory 2g --pids-limit 256 \
  --volume /tmp/dashi-spike-worktree:/work:rw \
  dashi-sandbox-spike sh -c 'claude --version && git --version && ls -a ~'

# 4. clean up
git worktree remove --force /tmp/dashi-spike-worktree
```

Expected: both versions print and the container home is empty. Record the `time` figure here once
measured on a runner host. Inside the container `git status` fails until #120 decides how the
object store is mounted (see above); `git --version` does not need it.

## Not verified

- The start times above are secondary sources; none was measured on this hardware.
- Nested virtualization for Firecracker on M3 or later Macs was not tried.
- Apple's `container` tool needs macOS 26 and was not installed or run here.

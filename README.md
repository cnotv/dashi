# Dashi

Dashi is a dashboard for coding-agent work across
repositories: the Claude Code and Codex sessions running now and the tokens they spend, the
issues and their pull requests with check gates, screenshots and videos, and buttons to merge,
close, and start a session from the phone, on your laptop or in Claude's cloud. Credentials are
saved from the UI and stored encrypted, and the shared agent instructions come from
[agent-base](https://github.com/cnotv/agent-base).

## Run it

```sh
pnpm install
pnpm build
pnpm start            # http://localhost:4317
```

Or with Docker, published on 127.0.0.1 only:

```sh
docker compose up --build
```

Repositories shown on the board come from `config/repos.json`.

### Static UI only (Netlify)

`netlify.toml` builds just the UI. With `VITE_DEMO_MODE=1` (the Netlify default here) it runs
on bundled sample data with a banner, and nothing typed into it leaves the page: that is the
per-pull-request preview. To use a static UI with a real server instead, build it with
`VITE_API_BASE_URL=https://your-dashboard-server` and without demo mode; the server does not
accept another origin yet, so the UI it serves itself is the one to use.

## Sign in with GitHub

Signing in does two things: it is the lock on a cloud deployment, and it is how the dashboard
reads GitHub, with your own token, so no GitHub token has to be saved under Credentials. It
uses a GitHub App rather than an OAuth App, because an App's user token can only read what the
App is allowed to on the repositories it is installed on, and it expires after eight hours, which
the dashboard renews with the App's refresh token while you use it (keep "Expire user authorization
tokens" on); an
OAuth App would need the `repo` scope, which can write to every private repository you have.

Create the App once at <https://github.com/settings/apps/new>:

1. **Homepage URL**: your dashboard's address.
2. **Callback URL**: `https://<your domain>/api/auth/github/callback`. Add
   `http://localhost:4317/api/auth/github/callback` as a second one to sign in locally too.
3. Keep **Expire user authorization tokens** on. Leave **Request user authorization during
   installation** off, and untick **Webhook: Active**.
4. **Repository permissions**: read-only for Actions, Checks and Commit statuses; **read and
   write** for Contents and Pull requests, which the Merge and Close buttons need, and for
   Issues, which **New issue** needs (Metadata is added on its own). Leave those three
   read-only to keep the dashboard unable to change anything; the buttons then show GitHub's
   refusal.
5. **Only on this account**, then create it. Copy the **Client ID** and generate a **client
   secret**.
6. **Install App** on your account, for the repositories in `config/repos.json`. The board can
   only read repositories the App is installed on.

Then set `DASHI_GITHUB_APP_CLIENT_ID`, `DASHI_GITHUB_APP_CLIENT_SECRET`
(or `_FILE`) and `DASHI_ALLOWED_USERS`, the comma-separated GitHub logins that may
sign in. The names carry the `DASHI_` prefix because GitHub refuses repository
variables and secrets that start with `GITHUB_`. Locally, sign-in is optional and a **Sign in
with GitHub** button appears in the sidebar.

Sessions are kept in the server's memory only, so no GitHub token is ever written to disk. A
restart or a deploy signs everyone out, and signing in again is one click, which GitHub
completes without asking twice.

## Deploy to the cloud

`docker-compose.cloud.yml` runs the dashboard and publishes it on one port, `4317` by
default, on a private address. HTTPS comes from the reverse proxy already on the server,
which forwards the domain to that port; the deployment itself takes no other port, and never
80 or 443. In cloud mode every `/api` route except health and sign-in answers 401 without a
session, only requests for the domain's host name are answered at all, and the app sets its
own security headers (HSTS, `nosniff`, `X-Frame-Options: DENY`) whatever proxy is in front.

The `Deploy` workflow copies the sources to a server over SSH and builds the image there, as
generative-art's deploy does, on every push to `main` once the checks pass. It stays idle
until `DASHI_DOMAIN` is set. What it needs:

- **The server**: Docker with the compose plugin, a DNS `A` record for the domain pointing at
  it, and a reverse proxy with a certificate for the domain, forwarding to the published port
  and passing the `Host` header through unchanged (the default in Nginx Proxy Manager, Caddy
  and Traefik).
- **Where the proxy reaches the dashboard**: a proxy running on the host itself uses
  `http://127.0.0.1:4317`, the default. A proxy running in Docker (Nginx Proxy Manager, for
  one) cannot see the host's `127.0.0.1`; set `DASHI_PUBLISH_ADDRESS` to the Docker
  bridge address, usually `172.17.0.1` (`ip -4 addr show docker0`), and forward to
  `http://172.17.0.1:4317`. Either way the port is not reachable from the internet.
- **A port that is free**: `4317` unless `DASHI_PUBLISH_PORT` says otherwise; check
  with `ss -tlnp` on the server before the first deploy.
- **Repository variables** (Settings, Secrets and variables, Actions, Variables):

  | Variable                     | Value                                                                      |
  | ---------------------------- | -------------------------------------------------------------------------- |
  | `DASHI_DOMAIN`               | the host name only, for example `dash.example.com`                         |
  | `DASHI_GITHUB_APP_CLIENT_ID` | from the GitHub App                                                        |
  | `DASHI_ALLOWED_USERS`        | for example `cnotv`                                                        |
  | `DASHI_PUBLISH_ADDRESS`      | optional, defaults to `127.0.0.1`; `172.17.0.1` for a proxy in Docker      |
  | `DASHI_PUBLISH_PORT`         | optional, defaults to `4317`                                               |
  | `DEPLOY_DIRECTORY`           | optional, defaults to `agent-dashboard` in the SSH user's home (see below) |

- **Repository secrets**:

  | Secret                           | Value                                                        |
  | -------------------------------- | ------------------------------------------------------------ |
  | `HETZNER_HOST`                   | the server's address                                         |
  | `HETZNER_USERNAME`               | the SSH user, who can run `docker`                           |
  | `HETZNER_SSH_KEY`                | a private key that user accepts                              |
  | `HETZNER_PORT`                   | optional, defaults to 22                                     |
  | `DASHI_GITHUB_APP_CLIENT_SECRET` | from the GitHub App                                          |
  | `DASHI_MASTER_KEY`               | optional; leave it out to unlock the vault with a passphrase |

Every `DASHI_*` variable and secret is also read under its `AGENT_DASHBOARD_*` name from before
the rename to Dashi, the new name winning, so a repository set up earlier keeps deploying; the
same holds for the server's own settings below and the laptop runner's. Both compose files pin
the project name to `agent-dashboard`, the data volume's name from before the rename, so the
volume stays the same whatever the folder is called.

The workflow writes these into `.env` in the deploy directory, readable by the SSH user only.
Without a master key the vault asks for its passphrase after every deploy; that only holds up
features that use a stored API key, since GitHub access comes from the sign-in.

## Credentials

Signed in with GitHub, the board reads GitHub as you. Without sign-in, open **Credentials**
and add a GitHub token: fine-grained, on the repositories in `config/repos.json`. It needs:
- read and write access to issues, for New issue
- read and write access to pull requests, for Merge, Close and back to draft
- write access to contents, for Merge
- read access to actions, checks and commit statuses

A Netlify personal access token for the board's Netlify button is stored the same way. So are API
keys for Anthropic, OpenAI and OpenRouter, kept for sessions that are not on a subscription,
though no session uses them yet. A start on an OpenRouter model uses the laptop's own key, never this
one (see [Run on an OpenRouter model](#run-on-an-openrouter-model)).

Each credential's dialog links to the page where that token or key is created. The question mark beside each credential opens **How
Dashi uses it**, which lists what Dashi does with it, every API call it makes, the permissions the token
needs, and links to that API's documentation. The Anthropic, OpenAI and OpenRouter keys are marked
**Not used yet**: Dashi keeps them but no session reads them, and only Test calls their API.

The machine panels below the credentials, **Set up a machine**, **Connect Claude Code** and
**Laptop runner**, have the same question mark beside their titles, for the tokens they issue: the ingest token
a machine reports with, the runner token the laptop runner polls with, and the pairing that hands
both to the dashi CLI.

A credential can hold several tokens, each with a name, such as a personal and a work GitHub
token. A credential's tokens are a radio group: the selected one, marked **In use**, is the one
the dashboard reads, and selecting another switches to it. **Add token** adds one, and switches to
it straight away unless **Use this token now** is unticked. Each token can be tested, renamed or
replaced (**Edit**), and removed. Removing the token in use hands the mark to the oldest one left.
A token stored before credentials could hold several shows up as **Default**.

Values are encrypted with AES-256-GCM before they reach the SQLite database, each bound to its
own name. The browser can add, rename, replace, test and remove a token, but never reads one back;
it sees the last four characters only. The key comes from one of two places:

| Mode        | How                                                                                         | When to use                                                            |
| ----------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Passphrase  | Leave `DASHI_MASTER_KEY` unset; set a passphrase in the UI and enter it after every restart | Anything reachable from another machine: a stolen disk reveals nothing |
| Environment | `DASHI_MASTER_KEY=$(openssl rand -base64 32)`, or `DASHI_MASTER_KEY_FILE`                   | A machine you already trust, or a server you redeploy often            |

## Sessions and usage

**Sessions** (the default page) lists every session whose hooks report here in one table, with
its branch, issue and tokens. Under each running session's row is its timeline: when it was
working, waiting for you or idle, read against the time axis under the headings. A session is
named by the first line of its first prompt (at most 80 characters; nothing more of the prompt is
kept), then by its repository, then by the folder it runs in, then by its short id; under the name
are its repository or folder and its branch. Idle means it finished its turn and waits for your
next message; waiting for you means it stopped to ask, such as for a permission. **Usage**
adds up tokens across all repositories, then by repository, pull request or branch, day and
model. It counts tokens only; subscription sessions have no per-token price to show.

### Where the data comes from

Each section names its sources in gray tags that link to the docs below; hover a tag for what it
sends.

| Source | What Dashi gets from it | Received at | Shown in |
| --- | --- | --- | --- |
| [Claude Code hooks](https://code.claude.com/docs/en/hooks) | `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop` and `SessionEnd`, with the session id, git remote, branch, folder and first prompt; from a cloud session, every prompt and final reply | `POST /api/events` | Session rows, states, timeline; the branch that Usage groups by; a cloud session's chat |
| [Codex `notify`](https://developers.openai.com/codex/config-advanced) | `agent-turn-complete`, with the thread id and first input message | `POST /api/events` | Codex session rows and states |
| [Claude Code OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage) | The `claude_code.token.usage` counter, per session, model and token type, over OTLP/HTTP JSON | `POST /api/telemetry/v1/metrics` | Every token count, on Sessions and Usage |
| [GitHub GraphQL API](https://docs.github.com/en/graphql) | Issues and pull requests, for the board | Fetched by the server | The pull request of a branch on Usage, read from boards already fetched |
| [Claude Code routines](https://code.claude.com/docs/en/routines) | A session started on claude.ai | Called by the server | Cloud starts in Started from the board |
| [Laptop runner](#the-laptop-runner) | Starts run on your machine, an open chat's transcript from `~/.claude/projects`, and chat messages sent on to cloud sessions | Polls `/api/runner/*` | Laptop starts, the session chat, and `DASHI_START_ID` on the sessions it starts |
| [Workflow plugin hook](https://github.com/cnotv/agent-base#what-the-reporter-sends) | What launched each session and what pays for it, as kinds: entrypoint, terminal, launching app, billing kind, API host, Dashi start id; the cloud session it runs in | `POST /api/events` headers | Triggered by and Billed through on Usage and Sessions; which start a cloud chat belongs to |
| [Dashi machine token](#set-up-a-machine-with-the-dashi-cli) | Which connected machine sent a report | Every ingest request | By machine on Usage |

Codex sends no token metrics, so Codex sessions show n/a for tokens, and Usage lists them under By agent with no tokens.

### Where the tokens were spent

Usage says what spent the tokens four ways. The table by pull request and branch, and each session
on the Sessions page, show the same "triggered by" and "billed through" labels.

- **Triggered by**, in this order:
  1. **The Dashi board** (laptop runner or Claude cloud): the runner sets `DASHI_START_ID` on the
     sessions it starts. Older runners are recognised by the start's worktree folder; routines by
     their cloud session.
  2. **An app such as CodePilot:** the app that launched Claude Code.
  3. **An editor** (VS Code, Cursor, Zed).
  4. **The Agent SDK.**
  5. **A terminal** (iTerm, Terminal, Warp, Ghostty and others).
- **Billed through:**
  - A Claude login, with its email when the metrics carry one (a subscription or a Console
    account).
  - An Anthropic API key, or OpenRouter (or another host) through `ANTHROPIC_BASE_URL`.
  - Amazon Bedrock, Google Vertex AI or Microsoft Foundry.
  - For Codex: an OpenAI API key or a ChatGPT login.
- **By machine:** the connected machine whose ingest token reported the tokens.
- **By agent:** Claude Code and Codex. Codex sends no token metrics, so its sessions are counted
  with no tokens.

Triggered by and billed through come from the workflow plugin's status hook (0.5.0 or later). It
runs inside every session and reads them from the session's environment:
- `CLAUDE_CODE_ENTRYPOINT`
- `TERM_PROGRAM`
- the launching app (the macOS bundle id it hands down, or the nearest ancestor process that is
  not a shell)
- which of `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK` and the like are set

It sends kinds and hosts only, never a key's value. Where the hook said nothing, Claude Code's
metric attributes fill in (`app.entrypoint`, which `dashi connect` turns on, and `user.email`).
Tokens recorded before Dashi asked read "Not reported"; update the plugin to fill them in from then on.

Both are fed by the machines running Claude Code, not read from them. The quick way to connect
one is the `dashi` CLI, below; the steps after it do the same by hand.

### Set up a machine with the dashi CLI

**Credentials, Set up a machine** unfolds one command for macOS or Linux. It downloads the CLI,
`apps/cli/src/dashi.ts`, which the dashboard serves from `/api/cli/script`. It checks the file
against the SHA-256 the page shows (from `/api/cli/script-info`) and stops on a mismatch. Then
it runs `node ~/dashi/dashi.ts connect <dashboard>`. It needs only Node 22.18 or later: no npm
and no package to install.

`dashi connect`:

1. Checks for Node, git and Claude Code (and tmux, for the runner), and that the dashboard
   answers.
2. Asks the dashboard to pair and prints a code. It opens `/pair?code=…`, where you approve the
   machine while signed in, name it, and tick whether it also runs the sessions you start from
   the board. The tokens go from the dashboard straight to the CLI, once; nothing is pasted or
   shown. A code lasts ten minutes, and its poll secret never leaves the CLI.
3. Lists the keys it adds to `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`),
   with the tokens shortened, and asks before writing them. These are the same keys as the
   manual snippet. It keeps a copy of the old file, leaves every other key alone, and refuses
   to touch a file that isn't valid JSON.
4. Installs the `workflow` plugin, then, if ticked, the laptop runner. The runner is checked
   against its own hash and installed as the macOS login agent or the Linux systemd user
   service described under [The laptop runner](#the-laptop-runner).
5. Confirms the dashboard accepts each token.

`--runner` or `--no-runner` answers the runner question up front, and `--yes` answers every
question with yes. Afterwards:

- `dashi doctor` checks it all again and says how to fix what fails.
- `dashi runner install|uninstall|status|logs` handles the runner alone.
- `dashi update` fetches the CLI and runner the dashboard now serves, both checked by hash.
- `dashi disconnect` revokes this machine's tokens with the tokens themselves, removes the
  dashboard's variables from the settings, and uninstalls the runner.

Every command it runs is an argument list, never a shell string, and the files holding a token
are readable by you only. Windows isn't supported yet.

### By hand

1. In **Credentials, Connect Claude Code**, create a token for the machine and merge the
   snippet it shows into that machine's `~/.claude/settings.json`. It enables the `workflow`
   plugin from agent-base, whose hook posts each session event to `/api/events`, sets the
   hook's `DASHI_URL` and `DASHI_TOKEN`, and turns on Claude Code's
   OpenTelemetry metrics, exported to `/api/telemetry/v1/metrics`. It has to be the user
   settings file: Claude Code ignores telemetry settings in a repository's
   `.claude/settings.json`.
2. Start a new session; one already open keeps its old settings. The token's **Last report**
   shows when the machine last reached the dashboard. If it stays at **Never**, install the
   plugin by hand (`claude plugin marketplace add cnotv/agent-base`, then
   `claude plugin install workflow@cnotv`) and start another session.

The token is shown once and stored as a hash. It can only send events and metrics, never
read anything, and **Revoke** cuts one machine off. A session silent for six hours counts as
inactive, since a closed terminal never reports that it ended.

### Chat with a session

The speech-bubble icon opens a session's conversation in a drawer, as in Claude: what was
typed, Claude's answers, and each tool it used, updated live, with a box for the next message
(Enter sends, Shift+Enter starts a new line). It leads each start under **Started from the
board**, and each row of the sessions table, which lists only sessions whose hooks report
here. A laptop session's conversation lives on the laptop, so it needs the laptop runner below:

- While the drawer is open, the runner reads the session's transcript in
  `~/.claude/projects` every couple of seconds and sends its last 150 messages, without tool
  results or thinking. The server keeps them in memory only, with every stored secret
  scrubbed, and forgets them about 20 seconds after the drawer closes; nothing is written to
  disk.
- For a start, the runner finds its session as the newest transcript of the start's worktree.
- A message goes into a session running in tmux (every steerable start from Dashi does), pasted
  into its pane and sent. An unattended start takes one once its transcript has been quiet for a
  minute, by being resumed. An ended session is resumed unattended with
  `claude --resume <id> -p <message>`, its output going to `~/dashi/logs`, on the OpenRouter model
  of the start it came from, if any. A session
  waiting on a permission, or running in a plain terminal, can't take one, and the drawer says
  why.

A routine's or other cloud session's conversation comes from its own hooks instead, since there is
no API to read one, and claude.ai refuses to be shown in a frame:

- The workflow plugin's status hook (0.6.0 or later) sends the cloud session it runs in, with each
  prompt (`UserPromptSubmit`) and each turn's final reply (`Stop`'s `last_assistant_message`).
  Dashi keeps a cloud session's last 150 messages in memory, scrubbed of every stored secret, for
  the 200 sessions it heard from most recently; a restart forgets them. Tool calls are not shown.
- The hook has to reach Dashi from the cloud: the routine's cloud environment needs `DASHI_URL`,
  `DASHI_TOKEN` (an ingest token, which can only report) and Dashi's host in its allowed domains.
  **Credentials, Claude cloud routines** lists them under its last setup step.
- A message goes out through the laptop runner, with
  [`claude -p --cloud <session>`](https://code.claude.com/docs/en/claude-code-on-the-web#send-follow-ups-from-the-cli)
  and the message on standard input, so the runner's `claude` must be logged in to the same
  claude.ai account. The session takes it as its next message, as if typed in the Claude app.

## Board cards

The board opens on **All repositories**: every configured repository's issues on one board,
newest first in each column, each card naming its repository. The toggle above it switches to
one repository, picked from the list and kept in the address (`?repository=owner/name`).

The last column, **Closed**, holds each repository's 20 most recently closed issues, with when
each closed and the merged pull request that closed it, whose checks, deploy preview, screenshot,
video and changed files stay on the card. Every column's arrow folds it to a strip
showing only its name and count; **No pull request** and **Closed** start folded, and this
browser remembers what you fold.

Each open pull request gets one card, listing every issue it closes (by a `Closes #n` line or
by its `<type>/<n>-description` branch). An issue without a pull request has a card of its own.

An issue without a pull request that Dashi started a session on, from its card or the New issue
dialog, sits in **Started from Dashi**, right after No pull request, newest start first. Its card
shows the start's state and where it runs, its details with Retry when it failed, its
conversation and session link once it has them, and Discard for a start that never ran (queued
or failed): Discard removes it from Dashi before a runner picks it up, and the card goes back to
No pull request with its Start button. A start a runner is launching, or one that started, stays,
since usage reads it to tell which sessions Dashi started.

A pull request's checks sit at the card's top right. The card ends in one row of icons, each
named in its tooltip: a red warning when the branch has a merge conflict, the deploy preview,
the screenshot and video, the changed files, then Merge and Close. Checks show as a ring with one coloured arc per state (red failed, amber running, green
passed, grey skipped or neutral) and the passed count; hovering it lists every check with its
state and a link to its run. The globe opens the Netlify deploy preview once Netlify reports
one, on the page named by a `Preview route: /path` line in the pull request body, or on its
home page when there is none. The code icon opens a drawer from the side with every file the
pull request changes, its status and line counts, and its diff; past ten files each one starts
folded, and past three hundred the rest is left to GitHub.

## Netlify

The button at the top of the board is green, and opens the site in Netlify, when a Netlify
site builds the selected repository. Otherwise **Enable Netlify** creates one after a
confirmation. The site builds the default branch, posts a deploy preview on each pull request,
and takes its build command and folder from the repository's `netlify.toml`.

It needs a Netlify personal access token under **Credentials**. Netlify's API cannot list its
GitHub App installations, so the new site is linked through the installation that another
Netlify site of the same GitHub owner already uses. The first repository of an owner is linked
once in Netlify itself; the button works for the rest.

A site is matched to its repository by the repository Netlify links it to, which Netlify does
not follow through a rename on GitHub. After renaming a repository, link its site to the new
name in Netlify (Site configuration, Build and deploy, Repository, Link to a different
repository); until then the board offers **Enable Netlify**, which would make a second site.

## Start a session from the board

Every card without a pull request has a **Start** button (the play icon), so work can be started
from the phone; once a pull request exists, the session that opened it carries on with it. Pick a
workflow from agent-base's `start` router (suggested from the issue's labels), add a note if the
issue leaves something out, and pick where it runs:

| Where                              | What happens                                                                                                          | Needs                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Laptop, steered from the phone     | The runner starts `claude --remote-control` in tmux, in a fresh worktree of the repository; open it in the Claude app | The laptop runner, and tmux 3.2 or later  |
| Laptop, unattended                 | The runner starts `claude -p` in a fresh worktree with the permission mode and model you pick; its hooks report it here | The laptop runner                         |
| Claude cloud, sent from the laptop | The runner runs `claude --cloud` in its clone and reports the claude.ai link back                                     | The laptop runner, logged in to claude.ai |
| Claude cloud routine               | The dashboard fires the repository's routine through the routines API; works with the laptop off                      | A routine for the repository              |

Each start's session opens with `/workflow:start <workflow> <issue link>`, then the note, then
the workflow spelled out: read AGENTS.md and the issue, branch as `<type>/<issue>-<slug>` (with
permission to push that name, so a cloud session does not stay on its `claude/` branch and drop
off the board), tests first, the checks before every push, a draft pull request at the first
commit, and staying with it until it is green. A routine receives the first line as text, not as a
command, and a cloud session may not have the workflow plugin, so the steps travel with the
message. The message is built once, in `packages/contracts/src/first-message.ts`, for the server
and the demo alike.

A pull request with merge conflicts shows a red warning icon on its card. Tapping it opens the
same dialog for the `conflicts` workflow: the session checks out that pull request's branch,
brings in the default branch, resolves the conflicts, runs the checks and pushes, and asks you
when both sides changed the same logic. It opens with `/workflow:start conflicts <pull request link>`, and its steps
keep it on that pull request's branch. **Sessions**
lists the starts inside its time window, with the session's link or what the runner said. Each
row's details icon opens the start in full: where it ran, its links, the first message the session
was sent, and for a failed one what the error means and a **Retry**, which starts it again as a new
start with the same request (without attachments, which are never kept).

### Run on an OpenRouter model

An unattended laptop start can run on any [OpenRouter model](https://openrouter.ai/models) instead
of the laptop's Claude login: pick **OpenRouter** under **Model** in the Start dialog and type the
model's slug, such as `openai/gpt-5-mini`; one ending in `:free` costs nothing. Only unattended
starts can: Remote Control needs a claude.ai login, and a cloud session runs in Anthropic's cloud.

The runner starts Claude Code with the environment
[OpenRouter documents](https://openrouter.ai/docs/guides/guides/claude-code-integration):
`ANTHROPIC_BASE_URL=https://openrouter.ai/api`, the key as `ANTHROPIC_AUTH_TOKEN`, an empty
`ANTHROPIC_API_KEY`, and the model as `ANTHROPIC_MODEL` and every default model, so no background
call goes elsewhere. The key is the laptop's own `OPENROUTER_API_KEY`: the dashboard sends only
the model, and the key reaches Claude Code through its environment, never an argument.

To give the runner the key, export `OPENROUTER_API_KEY` in the shell and run `dashi runner install`
(or `dashi connect`); it goes into the runner's plist or `~/dashi/runner.env` beside the runner token,
and later installs and `dashi update` keep it. `dashi doctor` says whether the runner has one. A
start on OpenRouter without it fails and says so. Usage lists these sessions as billed through
OpenRouter, from the session's `ANTHROPIC_BASE_URL`.

### New issue

**New issue**, on Sessions and on the board, starts work that has no issue yet, as a chat: pick
the repository and the same workflow and place to run as **Start**, then write what the work is
about, attaching files by picking, pasting or dropping them. Sending (Enter) opens the issue on
GitHub as you, titled by the message's first line, then starts the session on it with the message
as its note.

Attachments are never stored. They travel with the start and are dropped once handed over: a
laptop session steered from the phone or unattended gets them as files under
`~/dashi/attachments/<repository>-<start>`, beside the worktree so nothing of them is committed,
and its first message names their paths; a session that only takes text (Claude cloud from the
laptop, or a routine) gets them as base64 inside its first message, so those take at most 40 KB
of attachments, against 8 MB and five files for the laptop. The issue lists only their names. A
laptop start waits in memory for its runner for up to fifteen minutes; a restart of the
dashboard before then drops its attachments.
Behind a proxy that limits request bodies (plain Nginx stops at 1 MB), raise the limit to
about 12 MB, `client_max_body_size 12m`, or larger attachments are refused before they arrive.

### The laptop runner

The server cannot reach into the laptop, so the laptop asks. `dashi connect` installs it when you
tick it on the pair page (see [Set up a machine](#set-up-a-machine-with-the-dashi-cli)); by hand, under **Credentials, Laptop runner**,
create a runner for the machine, pick macOS or Linux, and paste the commands it shows into a
terminal. The runner is one file, `apps/runner/src/runner.ts`, served by the dashboard from
`/api/runner/script`; the dialog shows its SHA-256 (from `/api/runner/script-info`), and every
command checks the download against it before anything runs, stopping on a mismatch. A
**read it first** snippet downloads and checks it and opens it in `less`, installing nothing.

- **macOS**: a login agent that starts with the Mac and restarts if it stops; its log is
  `~/dashi/runner.log`. Install it from Terminal on the Mac itself, since launchd starts login agents
  only inside a GUI login, not over SSH. `launchctl print gui/$(id -u)/dev.dashi.runner` shows its state.
- **Linux**: a systemd user service, `~/.config/systemd/user/dashi-runner.service`, with the token
  in `~/dashi/runner.env` (mode 600) rather than in the unit; its log is
  `journalctl --user -u dashi-runner`, and `loginctl enable-linger $USER` keeps it running after
  you log out.

It needs Node 22.18 or later, git and Claude Code, logged in; tmux 3.2 or later for sessions
steered from the phone (`brew install tmux` or `sudo apt install tmux`).

It asks for work every five seconds, every second and a half while a chat drawer is open, with
its own runner token, which can only take and report starts, send the transcript of a session
whose drawer is open, and report on the messages it delivers, never read anything else. It accepts only a known workflow, target and permission mode
and a repository in `owner/name` form; it clones under `~/dashi/repos` with your own git
credentials, and every command is an argument list, never a shell string. **Revoke** cuts it off.

Without the dashboard, `claude remote-control --spawn worktree` on the laptop is Claude Code's
own way to start sessions from the Claude app; the runner adds the board's issues and workflows.

### Claude cloud routines

For starts with the laptop off, each repository needs a routine. Anthropic has no API to create
one, so **Credentials, Claude cloud routines** unfolds numbered steps for it, under **Set up the routine**: create the
routine at [claude.ai/code/routines](https://claude.ai/code/routines) with the repository selected,
give it the prompt shown (the routine only sees the fired text as untrusted until its own prompt
says to follow it, and pushes to a `claude/` branch unless told otherwise; the prompt says to
follow the text's steps and push to the branch it names), add an **API** trigger and generate its token, and save the id and token there.
The token can fire that routine and nothing else, and is stored in the vault. Routines allow 30
runs an hour each, and take at most 65,536 characters of text per run.

**Test the routine** fires a real, tiny run told only to reply and change nothing, since there is
no way to check a token without running the routine, and shows the session's link or the API's
reason. The panel also shows how the repository's last routine start went. "Authentication
failed" means the token no longer matches the routine: it was regenerated or revoked, or saved for
another routine; generate a new one, save it, and test.

### Workflow skills in the repository

A cloud session, routine or not, does not install the plugins a repository enables in
`.claude/settings.json`, so it never gets agent-base's workflow plugin. It does load the skills
committed under `.claude/skills/`. When a repository on the board lacks agent-base's workflow
skills there, or holds an older copy, the board asks to add them. **Add them in a pull request**
copies every file under agent-base's `plugins/workflow/skills/` into `.claude/skills/`, unchanged,
on the `chore/workflow-skills` branch, and opens the pull request with your GitHub access, which
needs write access to contents and pull requests. While it is open, the board links to it; **Not
now** hides the question until the next visit. When agent-base changes its skills, the board
offers the update the same way. A local session that also has the plugin lists each skill twice,
once as `workflow:<name>` and once as `<name>`; they are the same files.

## Merge and close

A board card with a pull request has **Merge** and **Close** buttons, each asking for
confirmation. Merge squash-merges with the pull request's title followed by its number, and
sends the head commit the card shows, so GitHub refuses it if anyone pushed since the board
loaded. Close closes the pull request without merging and leaves the branch. Either way the
board reloads, and a refusal from GitHub (conflicts, required checks or reviews, missing write
permission) is shown as GitHub words it. Merge is off for drafts and conflicting branches.

A draft means the pull request is being changed. The card's **Back to draft** button (a pencil)
turns a ready pull request into a draft, and on a draft it becomes **Ready for review**. Neither
asks, since each undoes the other. Starting a session on a pull request from the board, such as
**Fix the conflicts**, makes it a draft first. The session marks it ready again once the change
is validated, as the agent-base workflow does for every change to a ready pull request.

## Screenshots and videos

A board card with a pull request has an image and a video button at its bottom. The video
opens in a popover and plays on its own. Clicking the screenshot or the video, or its icon
while the preview shows, puts it full screen; on an iPhone the video uses the phone's own
player and the screenshot opens in a new tab. Each comes from the first of:

1. The `pr-preview` artifact of the pull request's head commit, recorded by the shared
   workflow in agent-base. The server downloads it once with the reader's GitHub token (the App
   needs **Actions: read**), keeps it under `<data dir>/pr-media`, and serves it itself.
2. The first image or video in the pull request body. The server sends the browser on to the
   link GitHub signed for that reader, so attachments of private repositories load too; a link
   to any host other than GitHub's is never followed.

A button is greyed out when neither has one.

The shared workflow also captures the same route on the base branch as `before.png`. The screenshot
popover then shows it next to the pull request's, labelled **Before** and **After** (stacked on a
phone), so the change is what you see first. A recording without one (an older recording, or a base
branch that didn't build) shows the pull request's screenshot alone. A pull request body never
supplies a before picture.

## Access

Locally, the server only listens on loopback and rejects requests whose `Host` header is not
a loopback name, and mutations from another origin, so a web page elsewhere cannot reach it
through DNS rebinding. The two ingest routes, `/api/events` and `/api/telemetry/v1/metrics`,
take an ingest token instead of a sign-in, in both modes. So do the CLI's routes:
- creating a pairing, and polling it with its secret
- `/api/machine/whoami`, where a machine checks or revokes its own token
- `/api/cli/script`

Approving a pairing, the one step that makes tokens, needs a signed-in person. Cloud mode (`DASHI_MODE=cloud`) answers only its own domain,
only over https, and only to a signed-in allowlisted GitHub account; it refuses to start
without all three configured.

## Settings

| Variable                                   | Default                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `DASHI_MODE`                               | `local` (or `cloud`)                                      |
| `PORT`                                     | `4317`                                                    |
| `DASHI_HOST`                               | `127.0.0.1`, `0.0.0.0` in cloud mode                      |
| `DASHI_PUBLIC_URL`                         | `http://localhost:<PORT>`; required, https, in cloud mode |
| `DASHI_GITHUB_APP_CLIENT_ID`               | unset (no sign-in)                                        |
| `DASHI_GITHUB_APP_CLIENT_SECRET` / `_FILE` | unset                                                     |
| `DASHI_ALLOWED_USERS`                      | unset; required with sign-in                              |
| `DASHI_DATA_DIR`                           | `data`                                                    |
| `DASHI_REPOS_FILE`                         | `config/repos.json`                                       |
| `DASHI_MASTER_KEY` / `_FILE`               | unset (passphrase mode)                                   |
| `VITE_DEMO_MODE` (UI build)                | unset                                                     |
| `VITE_API_BASE_URL` (UI build)             | unset (same origin)                                       |

## UI

React 19 with [Radix Themes](https://www.radix-ui.com/themes) (light and dark follow the
system) and [TanStack Table](https://tanstack.com/table) for the sortable tables on Sessions
and Usage. No Tailwind.

## Develop

```sh
pnpm dev                          # API on 4317, UI on 5318
# To sign in through the dev UI, run the API with DASHI_PUBLIC_URL=http://localhost:5318
# and register that callback URL on the GitHub App as well.
pnpm lint --max-warnings 0
pnpm typecheck
pnpm test

# The container check CI runs, here for local mode; cloud mode uses docker-compose.cloud.yml
cp .github/ci/local.env .env
docker compose up --build --detach --wait
node --env-file=.env apps/server/src/ops/smoke-test.ts local
```

Agent instructions are in `AGENTS.md`.

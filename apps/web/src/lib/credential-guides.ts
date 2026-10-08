import type { CredentialGuide, MachineGuideName } from './types'

export const credentialGuides: Record<string, CredentialGuide> = {
  'github-token': {
    isUsedByDashi: true,
    usedFor:
      'Reads and changes GitHub when nobody is signed in with GitHub; a signed-in person’s own token is used instead when there is one.',
    calls: [
      'POST https://api.github.com/graphql: the board (issues, pull requests, check rollups), pull request bodies, back to draft and ready for review',
      'POST /repos/{owner}/{repo}/issues: New issue',
      'PUT /repos/{owner}/{repo}/pulls/{number}/merge: Merge',
      'PATCH /repos/{owner}/{repo}/pulls/{number}: Close',
      'GET /repos/{owner}/{repo}/pulls/{number}/files: the changed files of a pull request',
      'GET /repos/{owner}/{repo}/actions/artifacts and .../artifacts/{id}/zip: preview screenshots and videos',
      'GET /repos/{owner}/{repo}: the repository, when a Netlify site is created for it',
      'GET https://api.github.com/user: Test',
    ],
    permissions: [
      'Fine-grained token, limited to the repositories on the board',
      'Metadata: read',
      'Issues: read and write',
      'Pull requests: read and write',
      'Contents: read and write (merging)',
      'Actions: read (preview artifacts)',
      'Commit statuses and Checks: read (the check rollup)',
    ],
    docs: [
      { label: 'GitHub GraphQL API', url: 'https://docs.github.com/en/graphql' },
      { label: 'GitHub REST API', url: 'https://docs.github.com/en/rest' },
      {
        label: 'Permissions for fine-grained tokens',
        url: 'https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens',
      },
    ],
  },
  'netlify-token': {
    isUsedByDashi: true,
    usedFor: 'Shows on the board whether Netlify builds a repository and links its deploy previews, and creates the site when it does not.',
    calls: [
      'GET https://api.netlify.com/api/v1/sites?filter=all: each repository’s site and deploy previews',
      'POST https://api.netlify.com/api/v1/sites: a new site, from the Issues board',
      'GET https://api.netlify.com/api/v1/user: Test',
    ],
    permissions: ['A personal access token acts with your whole Netlify account; Netlify has no narrower scopes.'],
    docs: [
      { label: 'Netlify API', url: 'https://docs.netlify.com/api/get-started/' },
      { label: 'Netlify API reference', url: 'https://open-api.netlify.com/' },
    ],
  },
  'anthropic-api-key': {
    isUsedByDashi: false,
    usedFor:
      'Kept for running Claude sessions billed per token; no session uses it yet. A session started with a key shows as "Anthropic API key" under Billed through on Usage.',
    calls: ['GET https://api.anthropic.com/v1/models: Test only'],
    permissions: ['Any Console API key; it is billed to that key’s workspace.'],
    docs: [
      { label: 'Anthropic API keys', url: 'https://docs.anthropic.com/en/api/getting-started' },
      { label: 'Claude Code with an API key (ANTHROPIC_API_KEY)', url: 'https://code.claude.com/docs/en/iam' },
    ],
  },
  'openai-api-key': {
    isUsedByDashi: false,
    usedFor: 'Kept for running Codex sessions billed per token; no session uses it yet.',
    calls: ['GET https://api.openai.com/v1/models: Test only'],
    permissions: ['Any project API key; it is billed to that project.'],
    docs: [
      { label: 'OpenAI API reference', url: 'https://platform.openai.com/docs/api-reference/models' },
      { label: 'Codex with an API key', url: 'https://developers.openai.com/codex/auth' },
    ],
  },
  'openrouter-api-key': {
    isUsedByDashi: false,
    usedFor:
      'Kept for routing Claude or Codex sessions through OpenRouter; no session uses it yet. A session pointed at OpenRouter shows as "OpenRouter" under Billed through on Usage.',
    calls: ['GET https://openrouter.ai/api/v1/key: Test only'],
    permissions: ['Any OpenRouter key; set a credit limit on it to cap spending.'],
    docs: [
      { label: 'OpenRouter quickstart', url: 'https://openrouter.ai/docs/quickstart' },
      { label: 'Claude Code through a gateway (ANTHROPIC_BASE_URL)', url: 'https://code.claude.com/docs/en/llm-gateway' },
    ],
  },
}

// The panels that connect a machine are not stored credentials, but each issues tokens, so each gets the same guide.
export const machineGuides: Record<MachineGuideName, CredentialGuide> = {
  'machine-setup': {
    isUsedByDashi: true,
    usedFor:
      'Connects a Mac or Linux machine in one command: the dashi CLI is approved here with a code and receives its tokens directly, so none is pasted or shown.',
    calls: [
      'GET /api/cli/script and /api/cli/script-info: the CLI and its hash, checked before it runs',
      'POST /api/pairings: the CLI asks for a code, signed out',
      'GET /api/pairings/{pairingId}: the CLI waits for you to approve the code',
      'POST /api/pairing-requests/approve: Approve on the pair page, which creates an ingest token and, if ticked, a runner token',
      'GET and DELETE /api/machine/whoami: dashi doctor and dashi disconnect, with the machine’s own token',
    ],
    permissions: [
      'Approving needs a signed-in session in cloud mode; the CLI itself holds no session.',
      'The tokens it receives are the ingest and runner tokens described under Connect Claude Code and Laptop runner.',
    ],
    docs: [{ label: 'Set up a machine with the dashi CLI', url: 'https://github.com/cnotv/dashi#set-up-a-machine-with-the-dashi-cli' }],
  },
  'connect-claude-code': {
    isUsedByDashi: true,
    usedFor:
      'An ingest token for one machine. The workflow plugin’s hook and Claude Code’s telemetry send with it; it can write session activity and token counts and read nothing back.',
    calls: [
      'POST /api/events: the hook reports SessionStart, UserPromptSubmit, Notification, Stop and SessionEnd',
      'POST /api/telemetry/v1/metrics: Claude Code’s OpenTelemetry token usage, per session and model',
    ],
    permissions: [
      'Sent as DASHI_TOKEN and in the OTLP Authorization header, both in ~/.claude/settings.json on that machine.',
      'Shown once; the dashboard keeps only its hash. Revoke cuts the machine off.',
    ],
    docs: [
      { label: 'Claude Code hooks', url: 'https://code.claude.com/docs/en/hooks' },
      { label: 'Claude Code monitoring and usage', url: 'https://code.claude.com/docs/en/monitoring-usage' },
      { label: 'The workflow plugin (agent-base)', url: 'https://github.com/cnotv/agent-base#what-the-reporter-sends' },
    ],
  },
  'laptop-runner': {
    isUsedByDashi: true,
    usedFor:
      'A runner token for one machine. The runner polls with it for sessions started from the board and reports back; the dashboard never connects to the laptop.',
    calls: [
      'POST /api/runner/claim: takes the next start waiting for this machine',
      'POST /api/runner/starts/{startId}: reports a start’s progress and result',
      'POST /api/runner/chat-work: takes chat messages to type into a session',
      'POST /api/runner/chat/{sessionId}: sends the transcript while that session’s chat drawer is open',
      'POST /api/runner/deliveries/{deliveryId}: reports whether a chat message was typed',
    ],
    permissions: [
      'Can only take and report starts and chat; it cannot read the board, credentials or other machines.',
      'The runner clones with your own git credentials on that machine, never one from here.',
      'Shown once inside the install commands; the dashboard keeps only its hash. Revoke cuts the runner off.',
    ],
    docs: [{ label: 'The laptop runner', url: 'https://github.com/cnotv/dashi#the-laptop-runner' }],
  },
}

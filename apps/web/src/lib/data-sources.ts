import type { DataSource, DataSourceId } from './types'

export const dataSources: Record<DataSourceId, DataSource> = {
  'claude-code-hooks': {
    label: 'Claude Code hooks',
    description:
      'Claude Code runs a hook on SessionStart, UserPromptSubmit, Notification, Stop and SessionEnd, which posts the event to /api/events. It sets the session, its state, branch and first prompt.',
    docsUrl: 'https://code.claude.com/docs/en/hooks',
  },
  'codex-notify': {
    label: 'Codex notify',
    description: 'Codex runs its notify command when a turn completes, which posts agent-turn-complete to /api/events.',
    docsUrl: 'https://developers.openai.com/codex/config-advanced',
  },
  'claude-code-otel': {
    label: 'Claude Code OpenTelemetry',
    description:
      'Claude Code exports the claude_code.token.usage metric over OTLP to /api/telemetry/v1/metrics, per session, model and token type. Codex sends no token metrics.',
    docsUrl: 'https://code.claude.com/docs/en/monitoring-usage',
  },
  'github-graphql': {
    label: 'GitHub GraphQL API',
    description: "The board's query lists each repository's issues and pull requests; a branch's pull request is found there, without a request of its own.",
    docsUrl: 'https://docs.github.com/en/graphql',
  },
  'claude-code-routines': {
    label: 'Claude Code routines',
    description: 'A cloud start fires a routine through https://api.anthropic.com/v1/claude_code/routines, which opens a session on claude.ai.',
    docsUrl: 'https://code.claude.com/docs/en/routines',
  },
  'laptop-runner': {
    label: 'Laptop runner',
    description:
      "Dashi's runner on your machine starts sessions from the board and, while a chat is open, sends the session's transcript from ~/.claude/projects.",
    docsUrl: 'https://github.com/cnotv/dashi#the-laptop-runner',
  },
}

import type { ConnectSnippetInput } from './types'

const agentBaseMarketplace = 'cnotv'

/** The commands that install the reporting plugin by hand, for when the settings alone do not. */
export const pluginInstallCommands = [
  'claude plugin marketplace add cnotv/agent-base',
  `claude plugin install workflow@${agentBaseMarketplace}`,
]

/**
 * Builds the ~/.claude/settings.json snippet that connects a machine to this dashboard.
 * Sessions are reported by the hook in agent-base's workflow plugin, so the snippet enables the
 * plugin as well as setting the variables: without it nothing is ever sent. Claude Code only
 * reads telemetry settings from the user's own settings (or managed settings and the shell),
 * never from a repository's .claude/settings.json, which is why all of it goes in the user file.
 * The hook reads the first two variables; the rest turn on token metrics.
 * @returns The snippet as formatted JSON.
 */
export const connectSnippet = ({ dashboardUrl, ingestToken }: ConnectSnippetInput): string => {
  const baseUrl = dashboardUrl.replace(/\/+$/, '')
  return JSON.stringify(
    {
      extraKnownMarketplaces: {
        [agentBaseMarketplace]: { source: { source: 'github', repo: 'cnotv/agent-base' } },
      },
      enabledPlugins: { [`workflow@${agentBaseMarketplace}`]: true },
      env: {
        DASHI_URL: baseUrl,
        DASHI_TOKEN: ingestToken,
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_EXPORTER_OTLP_ENDPOINT: `${baseUrl}/api/telemetry`,
        OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${ingestToken}`,
        // Off by default; Usage needs it to tell a terminal session from VS Code or the Agent SDK.
        OTEL_METRICS_INCLUDE_ENTRYPOINT: 'true',
      },
    },
    null,
    2,
  )
}

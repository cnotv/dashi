import { describe, expect, it } from 'vitest'
import { connectSnippet } from './connect-snippet'

describe('connectSnippet', () => {
  it('enables the reporting plugin and points it and the metrics exporter at the dashboard', () => {
    const settings: unknown = JSON.parse(connectSnippet({ dashboardUrl: 'https://agents.example.com/', ingestToken: 'adt_example' }))
    expect(settings).toEqual({
      extraKnownMarketplaces: { cnotv: { source: { source: 'github', repo: 'cnotv/agent-base' } } },
      enabledPlugins: { 'workflow@cnotv': true },
      env: {
        DASHI_URL: 'https://agents.example.com',
        DASHI_TOKEN: 'adt_example',
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://agents.example.com/api/telemetry',
        OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer adt_example',
        OTEL_METRICS_INCLUDE_ENTRYPOINT: 'true',
      },
    })
  })
})

import type { SecretDefinitionWithTester } from './types.ts'

export const secretDefinitions: SecretDefinitionWithTester[] = [
  {
    name: 'github-token',
    label: 'GitHub token',
    description: 'Reads issues, pull requests, check runs and workflow artifacts when nobody is signed in with GitHub.',
    tokenPageUrl: 'https://github.com/settings/personal-access-tokens/new',
    tester: { url: 'https://api.github.com/user', credentialHeader: 'bearer', extraHeaders: { 'User-Agent': 'dashi' } },
  },
  {
    name: 'anthropic-api-key',
    label: 'Anthropic API key',
    description: 'Kept for Claude sessions billed per token instead of on the subscription; no session uses it yet.',
    tokenPageUrl: 'https://console.anthropic.com/settings/keys',
    tester: { url: 'https://api.anthropic.com/v1/models', credentialHeader: 'x-api-key', extraHeaders: { 'anthropic-version': '2023-06-01' } },
  },
  {
    name: 'openai-api-key',
    label: 'OpenAI API key',
    description: 'Kept for Codex sessions billed per token instead of on the ChatGPT subscription; no session uses it yet.',
    tokenPageUrl: 'https://platform.openai.com/api-keys',
    tester: { url: 'https://api.openai.com/v1/models', credentialHeader: 'bearer', extraHeaders: {} },
  },
  {
    name: 'openrouter-api-key',
    label: 'OpenRouter API key',
    description: 'Kept for routing Claude or Codex sessions through OpenRouter models; no session uses it yet.',
    tokenPageUrl: 'https://openrouter.ai/settings/keys',
    tester: { url: 'https://openrouter.ai/api/v1/key', credentialHeader: 'bearer', extraHeaders: {} },
  },
  {
    name: 'netlify-token',
    label: 'Netlify token',
    description: 'Shows whether Netlify builds a repository, and creates the site from the Issues board when it does not.',
    tokenPageUrl: 'https://app.netlify.com/user/applications#personal-access-tokens',
    tester: { url: 'https://api.netlify.com/api/v1/user', credentialHeader: 'bearer', extraHeaders: { 'User-Agent': 'dashi' } },
  },
]

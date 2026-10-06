import type { RepositoryReference, SecretSummary, SignedInUser } from '@dashi/contracts'

export const demoUser: SignedInUser = { login: 'demo', avatarUrl: '' }

export const sampleRepositories: RepositoryReference[] = [
  { owner: 'cnotv', name: 'example' },
  { owner: 'cnotv', name: 'example-api' },
]

export const sampleSecrets: SecretSummary[] = [
  {
    name: 'github-token',
    label: 'GitHub token',
    description: 'Reads issues, pull requests, check runs and workflow artifacts when nobody is signed in with GitHub.',
    tokenPageUrl: 'https://github.com/settings/personal-access-tokens/new',
    entries: [{ entryId: 'default', label: 'Default', lastFour: 'demo', isInUse: true, updatedAt: '2026-09-28T00:00:00Z' }],
  },
  {
    name: 'anthropic-api-key',
    label: 'Anthropic API key',
    description: 'Runs Claude sessions billed per token instead of on the subscription.',
    tokenPageUrl: 'https://console.anthropic.com/settings/keys',
    entries: [],
  },
  {
    name: 'openai-api-key',
    label: 'OpenAI API key',
    description: 'Runs Codex sessions billed per token instead of on the ChatGPT subscription.',
    tokenPageUrl: 'https://platform.openai.com/api-keys',
    entries: [],
  },
  {
    name: 'openrouter-api-key',
    label: 'OpenRouter API key',
    description: 'Routes Claude or Codex sessions through OpenRouter models.',
    tokenPageUrl: 'https://openrouter.ai/settings/keys',
    entries: [],
  },
  {
    name: 'netlify-token',
    label: 'Netlify token',
    description: 'Shows whether Netlify builds a repository, and creates the site from the Issues board when it does not.',
    tokenPageUrl: 'https://app.netlify.com/user/applications#personal-access-tokens',
    entries: [{ entryId: 'default', label: 'Default', lastFour: 'demo', isInUse: true, updatedAt: '2026-09-28T00:00:00Z' }],
  },
]

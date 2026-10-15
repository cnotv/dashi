import type {
  BoardCard,
  BoardColumn,
  CheckGate,
  IssueLabel,
  IssueSummary,
  PreviewMediaKind,
  PullRequestFiles,
  PullRequestSummary,
} from '@dashi/contracts'
import type { DemoPullRequestOutcome } from '@/lib/types'

// Served from apps/web/public so demo mode has a recording to open without any server.
export const demoMediaUrls: Record<PreviewMediaKind, string> = {
  image: '/demo-media/screenshot.png',
  video: '/demo-media/video.webm',
  before: '/demo-media/before.png',
}

const issueOf = (issueNumber: number, title: string, linkedPullRequestNumbers: number[], labels: IssueLabel[] = []): IssueSummary => ({
  number: issueNumber,
  title,
  url: `https://github.com/cnotv/example/issues/${issueNumber}`,
  updatedAt: '2026-09-27T10:00:00Z',
  closedAt: null,
  labels,
  linkedPullRequestNumbers,
})

const runUrl = (runNumber: number): string => `https://github.com/cnotv/example/runs/${runNumber}`

const failingGates: CheckGate[] = [
  { name: 'lint', state: 'success', url: runUrl(1) },
  { name: 'typecheck', state: 'success', url: runUrl(2) },
  { name: 'test', state: 'failure', url: runUrl(3) },
  { name: 'e2e', state: 'pending', url: runUrl(4) },
  { name: 'lighthouse', state: 'skipped', url: runUrl(5) },
  { name: 'deploy/netlify', state: 'success', url: 'https://deploy-preview-30--cnotv-example.netlify.app' },
]

const passingGates: CheckGate[] = [
  { name: 'lint', state: 'success', url: runUrl(11) },
  { name: 'typecheck', state: 'success', url: runUrl(12) },
  { name: 'test', state: 'success', url: runUrl(13) },
  { name: 'deploy/netlify', state: 'success', url: 'https://deploy-preview-29--cnotv-example.netlify.app' },
]

const mergedGates: CheckGate[] = [
  { name: 'lint', state: 'success', url: runUrl(21) },
  { name: 'test', state: 'success', url: runUrl(22) },
  { name: 'deploy/netlify', state: 'success', url: 'https://deploy-preview-26--cnotv-example.netlify.app' },
]

const mergedPullRequest: PullRequestSummary = {
  number: 26,
  title: 'feat: frame rate counter (#4)',
  url: 'https://github.com/cnotv/example/pull/26',
  isDraft: false,
  headRefName: 'feat/4-frame-rate',
  headSha: '89abcdef',
  reviewDecision: 'APPROVED',
  mergeable: 'UNKNOWN',
  body: 'Closes #4\n\nPreview route: /stats',
  updatedAt: '2026-09-25T16:20:00Z',
  gates: mergedGates,
  gateSummary: { passed: 3, failed: 0, pending: 0, total: 3, overallState: 'passing' },
  media: { hasImage: true, hasVideo: true },
  previewUrl: 'https://deploy-preview-26--cnotv-example.netlify.app/stats',
}

const closedIssueOf = (issueNumber: number, title: string, closedAt: string, pullRequest: PullRequestSummary | null): BoardCard => ({
  issues: [{ ...issueOf(issueNumber, title, pullRequest === null ? [] : [pullRequest.number]), updatedAt: closedAt, closedAt }],
  pullRequest,
  status: 'closed',
})

export const sampleBoardColumns: BoardColumn[] = [
  {
    status: 'no-pull-request',
    cards: [
      {
        issues: [issueOf(12, 'Add a camera preset', [], [{ name: 'enhancement', color: 'a2eeef' }])],
        pullRequest: null,
        status: 'no-pull-request',
      },
      {
        issues: [issueOf(14, 'Play a sound when marbles collide', [])],
        pullRequest: null,
        status: 'no-pull-request',
      },
      {
        issues: [issueOf(15, 'Pause the run when the tab is hidden', [])],
        pullRequest: null,
        status: 'no-pull-request',
      },
    ],
  },
  {
    status: 'draft',
    cards: [
      {
        issues: [],
        pullRequest: {
          number: 31,
          title: 'chore: tidy',
          url: 'https://github.com/cnotv/example/pull/31',
          isDraft: true,
          headRefName: 'claude/tidy-things',
          headSha: 'fedc9876',
          reviewDecision: null,
          mergeable: 'UNKNOWN',
          body: '',
          updatedAt: '2026-09-25T12:00:00Z',
          gates: [],
          gateSummary: { passed: 0, failed: 0, pending: 0, total: 0, overallState: 'none' },
          media: { hasImage: false, hasVideo: false },
          previewUrl: null,
        },
        status: 'draft',
      },
    ],
  },
  { status: 'checks-running', cards: [] },
  {
    status: 'checks-failing',
    cards: [
      {
        issues: [
          issueOf(7, 'Fix marble stickiness', [30]),
          issueOf(8, 'Marbles pass through the ramp edge', [30], [{ name: 'bug', color: 'd73a4a' }]),
        ],
        pullRequest: {
          number: 30,
          title: 'fix: marble collisions (#7)',
          url: 'https://github.com/cnotv/example/pull/30',
          isDraft: false,
          headRefName: 'fix/7-marble-stickiness',
          headSha: '0123abcd',
          reviewDecision: 'REVIEW_REQUIRED',
          mergeable: 'MERGEABLE',
          body: 'Closes #7\nCloses #8\n\nPreview route: /games/MarbleMadness',
          updatedAt: '2026-09-27T12:00:00Z',
          gates: failingGates,
          gateSummary: { passed: 3, failed: 1, pending: 1, total: 6, overallState: 'failing' },
          media: { hasImage: true, hasVideo: true },
          previewUrl: 'https://deploy-preview-30--cnotv-example.netlify.app/games/MarbleMadness',
        },
        status: 'checks-failing',
      },
    ],
  },
  {
    status: 'ready-for-review',
    cards: [
      {
        issues: [issueOf(5, 'Show the score after each round', [29])],
        pullRequest: {
          number: 29,
          title: 'feat: round score (#5)',
          url: 'https://github.com/cnotv/example/pull/29',
          isDraft: false,
          headRefName: 'feat/5-round-score',
          headSha: '4567cdef',
          reviewDecision: 'REVIEW_REQUIRED',
          mergeable: 'CONFLICTING',
          body: 'Closes #5',
          updatedAt: '2026-09-26T12:00:00Z',
          gates: passingGates,
          gateSummary: { passed: 4, failed: 0, pending: 0, total: 4, overallState: 'passing' },
          media: { hasImage: false, hasVideo: false },
          previewUrl: 'https://deploy-preview-29--cnotv-example.netlify.app',
        },
        status: 'ready-for-review',
      },
    ],
  },
  { status: 'approved', cards: [] },
  {
    status: 'closed',
    cards: [
      closedIssueOf(4, 'Show the frame rate in the corner', '2026-09-25T16:20:00Z', mergedPullRequest),
      closedIssueOf(3, 'Marbles fall through the floor on Safari', '2026-09-22T09:05:00Z', null),
    ],
  },
]

/**
 * Shows the board as it would look after demo merges and closes: a merged pull request closes its
 * issues, as the Closes lines would on GitHub, moving each to the Closed column with that pull
 * request, and a closed one
 * leaves each of its issues behind on a card of its own with no pull request.
 * @param columns The sample board's columns.
 * @param outcomes What happened to each changed pull request, by number.
 * @param now When the board is read, which stands for when a merged pull request closed its issues.
 * @returns The columns with the changed cards moved or removed.
 */
export const applyDemoPullRequestOutcomes = (
  columns: BoardColumn[],
  outcomes: Map<number, DemoPullRequestOutcome>,
  now: string,
): BoardColumn[] => {
  const cards = columns
    .flatMap((column) => column.cards)
    .flatMap((card): BoardCard[] => {
      const outcome = card.pullRequest ? outcomes.get(card.pullRequest.number) : undefined
      if (outcome === undefined || card.pullRequest === null) return [card]
      if (outcome === 'draft' || outcome === 'ready') {
        const isDraft = outcome === 'draft'
        return [{ ...card, pullRequest: { ...card.pullRequest, isDraft }, status: isDraft ? 'draft' : 'ready-for-review' }]
      }
      if (outcome === 'merged') {
        return card.issues.map((issue) => ({
          issues: [{ ...issue, closedAt: now, updatedAt: now }],
          pullRequest: card.pullRequest,
          status: 'closed',
        }))
      }
      return card.issues.map((issue) => ({ issues: [issue], pullRequest: null, status: 'no-pull-request' }))
    })
  return columns.map((column) => ({ ...column, cards: cards.filter((card) => card.status === column.status) }))
}

export const samplePullRequestFiles: PullRequestFiles = {
  isTruncated: false,
  files: [
    {
      filename: 'src/views/Games/MarbleMadness/physics.ts',
      previousFilename: null,
      status: 'modified',
      additions: 6,
      deletions: 2,
      patch: [
        '@@ -12,9 +12,13 @@ const gravity = -9.81',
        ' export const stepMarble = (marble: Marble, deltaSeconds: number): Marble => {',
        '-  const velocity = marble.velocity + gravity * deltaSeconds',
        '-  return { ...marble, velocity }',
        '+  const velocity = clampSpeed(marble.velocity + gravity * deltaSeconds)',
        '+  const position = marble.position + velocity * deltaSeconds',
        '+  return { ...marble, velocity, position }',
        ' }',
        ' ',
        '+const maximumSpeed = 40',
        '+',
        '+const clampSpeed = (speed: number): number => Math.max(-maximumSpeed, Math.min(maximumSpeed, speed))',
        ' ',
        ' export const resetMarble = (): Marble => ({ velocity: 0, position: 0 })',
      ].join('\n'),
      blobUrl: 'https://github.com/cnotv/example/blob/0123abcd/src/views/Games/MarbleMadness/physics.ts',
    },
    {
      filename: 'src/views/Games/MarbleMadness/ramp.ts',
      previousFilename: 'src/views/Games/MarbleMadness/slope.ts',
      status: 'renamed',
      additions: 1,
      deletions: 1,
      patch:
        '@@ -1,3 +1,3 @@\n-export const slopeAngle = 0.4\n+export const rampAngle = 0.4\n export const rampWidth = 3\n export const rampLength = 12\n\\ No newline at end of file',
      blobUrl: 'https://github.com/cnotv/example/blob/0123abcd/src/views/Games/MarbleMadness/ramp.ts',
    },
    {
      filename: 'public/marble.png',
      previousFilename: null,
      status: 'added',
      additions: 0,
      deletions: 0,
      patch: null,
      blobUrl: 'https://github.com/cnotv/example/blob/0123abcd/public/marble.png',
    },
  ],
}

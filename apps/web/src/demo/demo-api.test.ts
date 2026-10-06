import { describe, expect, it } from 'vitest'
import { createDemoApi } from './demo-api'
import { sampleBoardColumns } from './sample-board'

describe('createDemoApi', () => {
  it('serves a board for whichever repository is asked for', async () => {
    const demoApi = createDemoApi()
    const [firstRepository] = await demoApi.listRepositories()
    const board = await demoApi.readBoard(firstRepository!, false)
    expect(board.repository).toEqual(firstRepository)
    expect(board.columns.flatMap((column) => column.cards).length).toBeGreaterThan(0)
  })

  it('opens a new issue in the No pull request column and starts a session on it', async () => {
    const demoApi = createDemoApi()
    const [firstRepository] = await demoApi.listRepositories()
    const createdIssue = await demoApi.createIssue(firstRepository!, { title: 'Show the frame time', body: 'In the corner.' })
    const board = await demoApi.readBoard(firstRepository!, false)
    const noPullRequestCards = board.columns.find((column) => column.status === 'no-pull-request')?.cards ?? []
    expect(noPullRequestCards[0]?.issues[0]).toMatchObject({ number: createdIssue.number, title: 'Show the frame time' })
    const screenshot = { name: 'corner.png', mediaType: 'image/png', base64: 'aGVsbG8=' }
    const start = await demoApi.startSession({
      repository: firstRepository!,
      issueNumber: createdIssue.number,
      pullRequestNumber: null,
      workflow: 'feature',
      target: 'laptop-remote-control',
      permissionMode: 'auto',
      note: 'In the corner.',
      attachments: [screenshot],
    })
    expect(start).toMatchObject({ issueNumber: createdIssue.number, note: 'In the corner.' })
    expect(JSON.stringify(await demoApi.listSessionStarts())).not.toContain(screenshot.base64)
  })

  it('keeps several tokens per credential in memory, showing only their last four characters', async () => {
    const demoApi = createDemoApi()
    const entriesOf = async () => (await demoApi.listSecrets()).find((secret) => secret.name === 'openrouter-api-key')?.entries ?? []
    await demoApi.addSecretEntry('openrouter-api-key', 'Personal', 'sk-or-example-9876')
    const { entryId: workId } = await demoApi.addSecretEntry('openrouter-api-key', 'Work', 'sk-or-example-5432')
    expect((await entriesOf()).map((entry) => [entry.label, entry.lastFour, entry.isInUse])).toEqual([
      ['Personal', '9876', true],
      ['Work', '5432', false],
    ])
    expect(JSON.stringify(await demoApi.listSecrets())).not.toContain('sk-or-example-9876')
    await demoApi.useSecretEntry('openrouter-api-key', workId)
    await demoApi.deleteSecretEntry('openrouter-api-key', workId)
    expect((await entriesOf()).map((entry) => [entry.label, entry.isInUse])).toEqual([['Personal', true]])
  })

  it('is signed in as a demo user with no GitHub sign-in to offer', async () => {
    expect(await createDemoApi().readSession()).toEqual({
      signInRequired: false,
      signInAvailable: false,
      user: { login: 'demo', avatarUrl: '' },
    })
  })

  it('starts fresh for every instance', async () => {
    const firstApi = createDemoApi()
    await firstApi.deleteSecretEntry('github-token', 'default')
    const secondApi = createDemoApi()
    expect((await secondApi.listSecrets()).find((secret) => secret.name === 'github-token')?.entries).toHaveLength(1)
  })

  it('shows running sessions inside the window it was asked for', async () => {
    const overview = await createDemoApi().readSessions(24)
    expect(overview.sessions.some((session) => session.state === 'working')).toBe(true)
    expect(overview.timeline.every((segment) => segment.startedAt >= overview.windowStartedAt)).toBe(true)
  })

  it('adds up usage so the parts match the total', async () => {
    const report = await createDemoApi().readUsage(30)
    const dailyTotal = report.byDay.reduce((sum, usage) => sum + usage.tokens.total, 0)
    expect(dailyTotal).toBe(report.totals.total)
  })

  it('creates and revokes ingest tokens in memory', async () => {
    const demoApi = createDemoApi()
    const createdToken = await demoApi.createMachineToken('runner', 'Desk')
    expect((await demoApi.listMachineTokens('runner')).map((runnerToken) => runnerToken.label)).toContain('Desk')
    expect((await demoApi.listMachineTokens('ingest')).map((ingestToken) => ingestToken.label)).not.toContain('Desk')
    await demoApi.revokeMachineToken('runner', createdToken.summary.tokenId)
    expect((await demoApi.listMachineTokens('runner')).map((runnerToken) => runnerToken.label)).not.toContain('Desk')
  })

  it('approves a pairing with the tokens asked for', async () => {
    const demoApi = createDemoApi()
    const description = await demoApi.describePairing('abcd-2345')
    await demoApi.approvePairing({ userCode: description.userCode, label: 'Studio', withRunner: false })
    expect((await demoApi.listMachineTokens('ingest')).map((ingestToken) => ingestToken.label)).toContain('Studio')
    expect((await demoApi.listMachineTokens('runner')).map((runnerToken) => runnerToken.label)).not.toContain('Studio')
  })

  it('points media at the bundled demo recording', () => {
    const demoApi = createDemoApi()
    const [pullRequest] = sampleBoardColumns
      .flatMap((column) => column.cards)
      .flatMap((card) => (card.pullRequest ? [card.pullRequest] : []))
    expect(demoApi.pullRequestMediaUrl({ owner: 'cnotv', name: 'example' }, pullRequest!, 'video')).toBe('/demo-media/video.webm')
  })

  it("moves the issues of a merged pull request to Closed, and leaves a closed one's issues behind", async () => {
    const demoApi = createDemoApi()
    const repository = { owner: 'cnotv', name: 'example' }
    const cardsOf = async () => (await demoApi.readBoard(repository, false)).columns.flatMap((column) => column.cards)
    const [multiIssueCard, pullRequestOnlyCard] = [
      (await cardsOf()).find((card) => card.issues.length > 1 && card.pullRequest !== null),
      (await cardsOf()).find((card) => card.issues.length === 0 && card.pullRequest !== null),
    ]
    await demoApi.closePullRequest(repository, multiIssueCard!.pullRequest!)
    const issueOnlyCards = (await cardsOf()).filter((card) => card.pullRequest === null)
    multiIssueCard!.issues.forEach((issue) =>
      expect(issueOnlyCards).toContainEqual({ issues: [issue], pullRequest: null, status: 'no-pull-request' }),
    )
    await demoApi.mergePullRequest(repository, pullRequestOnlyCard!.pullRequest!)
    expect((await cardsOf()).some((card) => card.pullRequest?.number === pullRequestOnlyCard!.pullRequest!.number)).toBe(false)
    const freshDemoApi = createDemoApi()
    const freshCardsOf = async () => (await freshDemoApi.readBoard(repository, false)).columns.flatMap((column) => column.cards)
    const mergedCard = (await freshCardsOf()).find((card) => card.issues.length > 1 && card.pullRequest !== null)
    await freshDemoApi.mergePullRequest(repository, mergedCard!.pullRequest!)
    const closedCards = (await freshCardsOf()).filter((card) => card.status === 'closed')
    expect(closedCards.flatMap((card) => card.issues.map((issue) => issue.number))).toEqual(
      expect.arrayContaining(mergedCard!.issues.map((issue) => issue.number)),
    )
    const closedWithMergedPullRequest = closedCards.filter((card) => card.pullRequest?.number === mergedCard!.pullRequest!.number)
    expect(closedWithMergedPullRequest).toHaveLength(mergedCard!.issues.length)
  })

  it('enables Netlify for a repository in memory only', async () => {
    const demoApi = createDemoApi()
    const repository = { owner: 'cnotv', name: 'example-api' }
    expect(await demoApi.readNetlifyStatus(repository)).toEqual({ state: 'inactive' })
    await demoApi.enableNetlify(repository)
    expect(await demoApi.readNetlifyStatus(repository)).toMatchObject({ state: 'active', siteName: 'cnotv-example-api' })
  })
})

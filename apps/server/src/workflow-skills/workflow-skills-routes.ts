import { Hono } from 'hono'
import type { WorkflowSkillsPullRequest, WorkflowSkillsStatus } from '@dashi/contracts'
import type { AppEnvironment } from '../app/types.ts'
import { findRepository } from '../repos/load-repositories.ts'
import type { WorkflowSkillsDependencies } from './types.ts'
import { openWorkflowSkillsPullRequest, readWorkflowSkillsStatus } from './workflow-skills.ts'

const missingTokenError = { error: 'Sign in with GitHub, or save a GitHub token under Credentials' }
const writeAccessHint = 'The GitHub App or stored token needs write access to contents and pull requests.'

/**
 * Builds the routes that say whether a repository carries agent-base's workflow skills, and open
 * the pull request that copies them in. A status is kept per reader for a short while, since the
 * board asks for it on every visit.
 * @param dependencies The repositories, the reader's token, the GitHub caller and the clock.
 * @returns The routes, mounted under /api.
 */
export const createWorkflowSkillsRoutes = ({ repositories, githubTokenOf, createGithubRestFetcher, cacheMilliseconds, now }: WorkflowSkillsDependencies) => {
  const routes = new Hono<AppEnvironment>()
  const statusCache = new Map<string, { status: WorkflowSkillsStatus; storedAt: number }>()
  const cacheKeyOf = (login: string | undefined, owner: string, name: string): string => `${login ?? '(stored token)'}:${owner}/${name}`

  routes.get('/repositories/:owner/:name/workflow-skills', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const session = context.get('session')
    const cacheKey = cacheKeyOf(session?.user.login, repository.owner, repository.name)
    const cachedStatus = statusCache.get(cacheKey)
    if (cachedStatus && now() - cachedStatus.storedAt < cacheMilliseconds) return context.json(cachedStatus.status)
    const githubToken = githubTokenOf(session)
    if (githubToken === null) return context.json(missingTokenError, 412)
    const result = await readWorkflowSkillsStatus(createGithubRestFetcher(githubToken), repository)
    if (!result.ok) return context.json({ error: result.message }, 502)
    statusCache.set(cacheKey, { status: result.value, storedAt: now() })
    return context.json<WorkflowSkillsStatus>(result.value)
  })

  routes.post('/repositories/:owner/:name/workflow-skills', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const session = context.get('session')
    const githubToken = githubTokenOf(session)
    if (githubToken === null) return context.json(missingTokenError, 412)
    const result = await openWorkflowSkillsPullRequest(createGithubRestFetcher(githubToken), repository)
    statusCache.delete(cacheKeyOf(session?.user.login, repository.owner, repository.name))
    if (result.ok) return context.json<WorkflowSkillsPullRequest>(result.value, 201)
    if (result.status === 403 || result.status === 404) return context.json({ error: `${result.message}. ${writeAccessHint}` }, 403)
    return context.json({ error: result.message }, result.status === 409 ? 409 : 502)
  })

  return routes
}

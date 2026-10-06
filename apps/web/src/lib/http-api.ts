import type { MachineTokenKind } from '@dashi/contracts'
import type { ChatTarget, DashboardApi } from './types'

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const errorBody: unknown = await response.json()
    return typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody && typeof errorBody.error === 'string'
      ? errorBody.error
      : `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

/**
 * Creates the API that talks to a dashboard server.
 * @param apiBaseUrl The server's address, or empty for the same origin.
 * @returns The API; each call throws with the server's error message.
 */
export const createHttpApi = (apiBaseUrl: string): DashboardApi => {
  const requestJson = async <ResponseBody>(path: string, init: RequestInit = {}): Promise<ResponseBody> => {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    })
    if (!response.ok) throw new Error(await readErrorMessage(response))
    return response.status === 204 ? (undefined as ResponseBody) : ((await response.json()) as ResponseBody)
  }

  const sendJson = <ResponseBody>(method: string, path: string, body: unknown = {}): Promise<ResponseBody> =>
    requestJson<ResponseBody>(path, { method, body: JSON.stringify(body) })

  const machineTokensPath = (kind: MachineTokenKind): string => `/api/${kind}-tokens`
  const repositoryPath = (repository: { owner: string; name: string }): string =>
    `/api/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
  const secretPath = (name: string): string => `/api/secrets/${encodeURIComponent(name)}`
  const chatPathOf = (target: ChatTarget): string =>
    target.kind === 'session'
      ? `/api/sessions/${encodeURIComponent(target.sessionId)}/chat`
      : `/api/session-starts/${encodeURIComponent(target.startId)}/chat`

  return {
    signInUrl: `${apiBaseUrl}/api/auth/github/start`,
    readSession: () => requestJson('/api/auth/session'),
    signOut: () => sendJson('POST', '/api/auth/sign-out'),
    readVault: () => requestJson('/api/vault'),
    setUpVault: (passphrase) => sendJson('POST', '/api/vault/setup', { passphrase }),
    unlockVault: (passphrase) => sendJson('POST', '/api/vault/unlock', { passphrase }),
    lockVault: () => sendJson('POST', '/api/vault/lock'),
    listSecrets: () => requestJson('/api/secrets'),
    saveSecret: (name, value) => sendJson('PUT', secretPath(name), { value }),
    deleteSecret: (name) => sendJson('DELETE', secretPath(name)),
    testSecret: (name) => sendJson('POST', `${secretPath(name)}/test`),
    listRepositories: () => requestJson('/api/repositories'),
    readBoard: (repository, refresh) => requestJson(`${repositoryPath(repository)}/board${refresh ? '?refresh=1' : ''}`),
    readSessions: (hours) => requestJson(`/api/sessions?hours=${hours}`),
    readSessionChat: (target) => requestJson(chatPathOf(target)),
    sendChatMessage: (target, text) => sendJson('POST', chatPathOf(target), { text }),
    readUsage: (days) => requestJson(`/api/usage?days=${days}`),
    listMachineTokens: (kind) => requestJson(machineTokensPath(kind)),
    createMachineToken: (kind, label) => sendJson('POST', machineTokensPath(kind), { label }),
    revokeMachineToken: (kind, tokenId) => sendJson('DELETE', `${machineTokensPath(kind)}/${encodeURIComponent(tokenId)}`),
    readStartOptions: (repository) =>
      requestJson(`/api/start-options?owner=${encodeURIComponent(repository.owner)}&name=${encodeURIComponent(repository.name)}`),
    listSessionStarts: () => requestJson('/api/session-starts'),
    startSession: (submission) => sendJson('POST', '/api/session-starts', submission),
    createIssue: (repository, newIssue) => sendJson('POST', `${repositoryPath(repository)}/issues`, newIssue),
    readSessionStart: (startId) => requestJson(`/api/session-starts/${encodeURIComponent(startId)}`),
    retrySessionStart: (startId) => sendJson('POST', `/api/session-starts/${encodeURIComponent(startId)}/retry`),
    testRoutine: (repository) => sendJson('POST', `${repositoryPath(repository)}/routine/test`),
    readRunnerScriptInfo: () => requestJson('/api/runner/script-info'),
    readCliScriptInfo: () => requestJson('/api/cli/script-info'),
    describePairing: (userCode) => requestJson(`/api/pairing-requests/${encodeURIComponent(userCode)}`),
    approvePairing: (approval) => sendJson('POST', '/api/pairing-requests/approve', approval),
    readRoutineSettings: (repository) => requestJson(`${repositoryPath(repository)}/routine`),
    saveRoutineSettings: (repository, routineId, token) => sendJson('PUT', `${repositoryPath(repository)}/routine`, { routineId, token }),
    deleteRoutineSettings: (repository) => sendJson('DELETE', `${repositoryPath(repository)}/routine`),
    mergePullRequest: (repository, pullRequest) =>
      sendJson('POST', `${repositoryPath(repository)}/pulls/${pullRequest.number}/merge`, {
        title: pullRequest.title,
        headSha: pullRequest.headSha,
      }),
    closePullRequest: (repository, pullRequest) => sendJson('POST', `${repositoryPath(repository)}/pulls/${pullRequest.number}/close`),
    setPullRequestDraft: (repository, pullRequest, isDraft) =>
      sendJson('POST', `${repositoryPath(repository)}/pulls/${pullRequest.number}/draft`, { draft: isDraft }),
    readPullRequestFiles: (repository, pullRequest) => requestJson(`${repositoryPath(repository)}/pulls/${pullRequest.number}/files`),
    readNetlifyStatus: (repository) => requestJson(`${repositoryPath(repository)}/netlify`),
    enableNetlify: (repository) => sendJson('POST', `${repositoryPath(repository)}/netlify`),
    pullRequestMediaUrl: (repository, pullRequest, kind) =>
      `${apiBaseUrl}${repositoryPath(repository)}/pulls/${pullRequest.number}/media/${kind}${pullRequest.headSha ? `?sha=${encodeURIComponent(pullRequest.headSha)}` : ''}`,
  }
}

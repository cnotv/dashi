import type { z } from 'zod'
import type { RepositoryReference, SessionStart, SessionStartRequest, StartAttachment } from '@dashi/contracts'
import type { DashboardSession } from '../auth/types.ts'
import type { MachineTokenStore } from '../machine-tokens/types.ts'
import type { Vault } from '../secrets/types.ts'
import type { runnerReportSchema } from './schema.ts'

export type RunnerReport = z.infer<typeof runnerReportSchema>

export interface ClaimedStart {
  start: SessionStart
  prompt: string
}

export interface SessionStartStore {
  createStart: (request: SessionStartRequest) => SessionStart
  listRecentStarts: () => SessionStart[]
  readStart: (startId: string) => SessionStart | null
  claimNextLaptopStart: (runnerLabel: string) => SessionStart | null
  recordRunnerReport: (startId: string, runnerLabel: string, report: RunnerReport) => SessionStart | null
  recordOutcome: (startId: string, outcome: { state: 'started' | 'failed'; sessionUrl: string | null; message: string | null }) => SessionStart
}

export interface RoutineStore {
  readRoutineId: (repository: RepositoryReference) => string | null
  saveRoutineId: (repository: RepositoryReference, routineId: string) => void
  deleteRoutineId: (repository: RepositoryReference) => void
}

export type RoutineFireResult = { ok: true; sessionUrl: string } | { ok: false; message: string }

export type RoutineFirer = (routineId: string, routineToken: string, text: string) => Promise<RoutineFireResult>

export interface SessionStartServices {
  startStore: SessionStartStore
  routineStore: RoutineStore
  runnerTokens: MachineTokenStore
  fireRoutine: RoutineFirer
  runnerScriptPath: string
}

export type AttachmentDelivery = 'files' | 'inline'

export interface AttachmentRelay {
  hold: (startId: string, attachments: StartAttachment[]) => void
  take: (startId: string) => StartAttachment[]
}

// Turns a pull request into a draft with the reader's own GitHub access; a refusal is left at that.
export type PullRequestDraftMarker = (session: DashboardSession | null, repository: RepositoryReference, pullRequestNumber: number) => Promise<void>

export interface SessionStartDependencies extends SessionStartServices {
  attachmentRelay: AttachmentRelay
  markPullRequestDraft: PullRequestDraftMarker
  vault: Vault
  repositories: RepositoryReference[]
  now: () => number
}

import { z } from 'zod'
import { openRouterModelPattern } from '@dashi/contracts/open-router'

// GitHub's own limits on owner and repository names; nothing else can become a clone path.
const repositorySchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).refine((name) => name !== '.' && name !== '..'),
})

export const startWorkflowSchema = z.enum(['research', 'feature', 'fix', 'refactor', 'docs', 'design', '3d', 'security', 'tests', 'chore', 'conflicts'])

export const sessionStartRequestSchema = z.object({
  repository: repositorySchema,
  issueNumber: z.number().int().positive().nullable(),
  pullRequestNumber: z.number().int().positive().nullable().default(null),
  workflow: startWorkflowSchema,
  target: z.enum(['laptop-remote-control', 'laptop-headless', 'laptop-cloud', 'cloud-routine']),
  permissionMode: z.enum(['auto', 'acceptEdits', 'dontAsk']).default('auto'),
  openRouterModel: z.string().regex(openRouterModelPattern).nullable().default(null),
  note: z.string().trim().max(20000).default(''),
})

// The runner writes each name as a file name, so it is a plain base name and nothing else.
export const startAttachmentSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/)
    .refine((name) => !name.includes('..')),
  mediaType: z.string().regex(/^[a-z]+\/[A-Za-z0-9.+-]{1,100}$/),
  base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
})

export const sessionStartSubmissionSchema = sessionStartRequestSchema.extend({
  attachments: z
    .array(startAttachmentSchema)
    .default([])
    .refine((attachments) => new Set(attachments.map((attachment) => attachment.name)).size === attachments.length, 'Attachment names repeat'),
})

export const runnerReportSchema = z.object({
  state: z.enum(['started', 'failed']),
  sessionUrl: z.string().url().startsWith('https://').max(500).nullable().default(null),
  message: z.string().max(2000).nullable().default(null),
})

export const routineSettingsBodySchema = z.object({
  routineId: z.string().regex(/^trig_[A-Za-z0-9]{8,64}$/),
  token: z.string().trim().min(20).max(512),
})

export const routineFireResponseSchema = z.object({
  claude_code_session_id: z.string(),
  claude_code_session_url: z.string().url(),
})

export const anthropicErrorSchema = z.object({ error: z.object({ message: z.string() }) })

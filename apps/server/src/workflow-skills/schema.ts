import { z } from 'zod'

export const treeEntrySchema = z.object({
  path: z.string(),
  mode: z.string(),
  type: z.string(),
  sha: z.string(),
})

export const treeSchema = z.object({ sha: z.string(), tree: z.array(treeEntrySchema) })

export const repositoryDetailsSchema = z.object({ default_branch: z.string() })

export const gitReferenceSchema = z.object({ object: z.object({ sha: z.string() }) })

export const gitCommitSchema = z.object({ sha: z.string(), tree: z.object({ sha: z.string() }) })

export const gitObjectSchema = z.object({ sha: z.string() })

export const blobSchema = z.object({ content: z.string(), encoding: z.literal('base64') })

export const pullRequestLinkSchema = z.object({ number: z.number().int().positive(), html_url: z.string().url() })

export const openPullRequestsSchema = z.array(pullRequestLinkSchema)

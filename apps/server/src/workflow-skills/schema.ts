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

export const settingsObjectSchema = z.record(z.string(), z.unknown())

// A settings file declares the plugin when it registers agent-base as the cnotv marketplace and
// enables the workflow plugin from it; any other settings may sit alongside.
export const pluginDeclarationSchema = z.object({
  extraKnownMarketplaces: z.object({
    cnotv: z.object({ source: z.object({ source: z.literal('github'), repo: z.literal('cnotv/agent-base') }) }),
  }),
  enabledPlugins: z.object({ 'workflow@cnotv': z.literal(true) }),
})

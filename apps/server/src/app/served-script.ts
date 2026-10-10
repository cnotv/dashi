import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Env, Hono } from 'hono'
import type { ServedScriptInfo } from '@dashi/contracts'
import type { ServedScript } from './types.ts'

/**
 * Adds the two routes a machine downloads one of Dashi's files from: the file itself, and its
 * SHA-256 and size, which the download is checked against before anything runs it.
 * @param routes The routes to add them to.
 * @param script Where the file is served, where it is on disk, and its path in the repository.
 */
export const addServedScriptRoutes = <Environment extends Env>(routes: Hono<Environment>, script: ServedScript): void => {
  routes.get(script.path, async (context) => {
    context.header('content-type', 'text/plain; charset=utf-8')
    context.header('content-disposition', `attachment; filename="${script.fileName}"`)
    return context.body(await readFile(script.filePath, 'utf8'))
  })

  routes.get(`${script.path}-info`, async (context) => {
    const contents = await readFile(script.filePath)
    return context.json<ServedScriptInfo>({
      sha256: createHash('sha256').update(contents).digest('hex'),
      byteLength: contents.byteLength,
      sourcePath: script.sourcePath,
    })
  })
}

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createPnpmPlugin } from "./index.js"

interface PatchworkConfig {
  server?: string
  sub?: boolean
}

function readPatchworkConfig(): PatchworkConfig {
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf-8")
    )
    return pkg?.patchwork ?? {}
  } catch {
    return {}
  }
}

let plugin: ReturnType<typeof createPnpmPlugin>
let timer: ReturnType<typeof setTimeout>

function ensurePlugin() {
  if (!plugin) {
    const config = readPatchworkConfig()
    const sub =
      process.env.PATCHWORK_SUB !== undefined
        ? process.env.PATCHWORK_SUB !== "false"
        : config.sub !== false
    const syncServerUrl =
      process.env.PATCHWORK_SYNC_SERVER ?? config.server
    plugin = createPnpmPlugin({ syncServerUrl, sub })
  }
  clearTimeout(timer)
  timer = setTimeout(() => plugin.shutdown().catch(() => {}), 60_000)
  timer.unref()
  return plugin
}

export const resolvers = [
  {
    canResolve: (dep: { bareSpecifier?: string }) =>
      ensurePlugin().resolvers[0].canResolve(dep),
    resolve: (dep: { bareSpecifier?: string }) =>
      ensurePlugin().resolvers[0].resolve(dep),
  },
]

export const fetchers = [
  {
    canFetch: (pkgId: string, resolution: { type?: string }) =>
      ensurePlugin().fetchers[0].canFetch(pkgId, resolution),
    fetch: (cafs: any, resolution: any, opts: any, fetchers: any) =>
      ensurePlugin().fetchers[0].fetch(cafs, resolution, opts, fetchers),
  },
]

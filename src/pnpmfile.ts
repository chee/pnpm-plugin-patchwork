import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createPnpmPlugin } from "./index.js"

function readSyncServer(): string | undefined {
  if (process.env.PATCHWORK_SYNC_SERVER) return process.env.PATCHWORK_SYNC_SERVER
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"))
    return pkg?.patchwork?.server
  } catch {
    return undefined
  }
}

// Lazy init: don't open the WebSocket connection until first use.
// Debounced shutdown: close the connection after last use so the
// process can exit cleanly once pnpm is done.
let plugin: ReturnType<typeof createPnpmPlugin>
let timer: ReturnType<typeof setTimeout>

function ensurePlugin() {
  if (!plugin) plugin = createPnpmPlugin({
    syncServerUrl: readSyncServer(),
  })
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

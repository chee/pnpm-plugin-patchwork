import { createRepo } from "./automerge-client.js"
import {
  canResolve,
  resolve,
  parseAutomergeSpec,
  type ResolveResult,
} from "./resolver.js"
import {
  canFetch,
  fetchToDirectory,
  fetchWithCafs,
} from "./fetcher.js"
import type { Repo } from "@automerge/automerge-repo"
import type { AutomergeResolution, FileEntry } from "./types.js"

export interface PatchworkPlugin {
  resolvers: {
    canResolve: (bareSpecifier: string) => boolean
    resolve: (bareSpecifier: string) => Promise<ResolveResult>
  }
  fetchers: {
    canFetch: (pkgId: string, resolution: { type?: string }) => boolean
    fetch: (
      resolution: AutomergeResolution
    ) => Promise<{ packageDir: string; cleanup: () => Promise<void> }>
  }
  shutdown: () => Promise<void>
}

export function createPatchworkPlugin(opts?: {
  syncServerUrl?: string
  sub?: boolean
  repo?: Repo
}): PatchworkPlugin {
  let repoPromise: Promise<Repo> | null = null

  function getRepo(): Promise<Repo> {
    if (opts?.repo) return Promise.resolve(opts.repo)
    if (!repoPromise) {
      repoPromise = createRepo({
        syncServerUrl: opts?.syncServerUrl,
        sub: opts?.sub,
      })
    }
    return repoPromise
  }

  return {
    resolvers: {
      canResolve,
      resolve: async (bareSpecifier: string) => {
        const repo = await getRepo()
        return resolve(bareSpecifier, repo)
      },
    },
    fetchers: {
      canFetch,
      fetch: async (resolution: AutomergeResolution) => {
        const repo = await getRepo()
        return fetchToDirectory(resolution, repo)
      },
    },
    shutdown: async () => {
      if (!opts?.repo && repoPromise) {
        const repo = await repoPromise
        await repo.shutdown()
      }
    },
  }
}

export function createPnpmPlugin(opts?: {
  syncServerUrl?: string
  sub?: boolean
}) {
  let repoPromise: Promise<Repo> | null = null

  function getRepo(): Promise<Repo> {
    if (!repoPromise) {
      repoPromise = createRepo({
        syncServerUrl: opts?.syncServerUrl,
        sub: opts?.sub,
      })
    }
    return repoPromise
  }

  return {
    resolvers: [
      {
        canResolve: (wantedDep: { bareSpecifier?: string }) =>
          canResolve(wantedDep.bareSpecifier ?? ""),
        resolve: async (wantedDep: { bareSpecifier?: string }) => {
          const repo = await getRepo()
          return resolve(wantedDep.bareSpecifier!, repo)
        },
      },
    ],
    fetchers: [
      {
        canFetch: (_pkgId: string, resolution: { type?: string }) =>
          canFetch(_pkgId, resolution),
        fetch: async (cafs: any, resolution: any, fetchOpts: any, fetchers: any) => {
          const repo = await getRepo()
          return fetchWithCafs(cafs, resolution, fetchOpts, fetchers, repo)
        },
      },
    ],
    shutdown: async () => {
      if (repoPromise) {
        const repo = await repoPromise
        await repo.shutdown()
      }
    },
  }
}

export {
  canResolve,
  resolve,
  parseAutomergeSpec,
  canFetch,
  fetchToDirectory,
  fetchWithCafs,
  createRepo,
}
export type { ResolveResult, AutomergeResolution, FileEntry }
export type {
  DirectoryDocument,
  DirectoryEntry,
  FileDocument,
} from "./types.js"

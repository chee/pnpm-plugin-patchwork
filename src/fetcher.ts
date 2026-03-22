import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import type { Repo } from "@automerge/automerge-repo"
import { isValidAutomergeUrl } from "@automerge/automerge-repo"
import type { AutomergeUrl } from "@automerge/automerge-repo"
import { walkFolderTree } from "./automerge-client.js"
import type { AutomergeResolution } from "./types.js"

export function canFetch(
  _pkgId: string,
  resolution: { type?: string }
): boolean {
  return resolution.type === "custom:automerge"
}

export async function fetchToDirectory(
  resolution: AutomergeResolution,
  repo: Repo
): Promise<{ packageDir: string; cleanup: () => Promise<void> }> {
  const walkUrl = await resolveWalkUrl(resolution.automergeUrl, repo)
  const files = await walkFolderTree(repo, walkUrl)

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pnpm-automerge-"))
  const packageDir = path.join(tmpDir, "package")
  await fs.mkdir(packageDir, { recursive: true })

  for (const file of files) {
    const filePath = path.join(packageDir, file.path)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, file.content, {
      mode: file.mode ?? 0o644,
    })
  }

  return {
    packageDir,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    },
  }
}

// pnpm cafs-based fetch: writes files to a temp directory,
// then uses cafs.addFilesFromDir to store them directly.
export async function fetchWithCafs(
  cafs: any,
  resolution: AutomergeResolution,
  opts: any,
  _fetchers: any,
  repo: Repo
): Promise<any> {
  const { packageDir, cleanup } = await fetchToDirectory(resolution, repo)

  try {
    const { filesIndex, manifest } = cafs.addFilesFromDir(packageDir)
    // filesIndex is a Map<string, {filePath, ...}> — convert to Map<string, string>
    const filesMap = new Map<string, string>()
    for (const [relativePath, entry] of filesIndex) {
      filesMap.set(relativePath, (entry as any).filePath)
    }
    return {
      filesMap,
      manifest: opts.readManifest ? manifest : undefined,
      requiresBuild: false,
    }
  } finally {
    await cleanup()
  }
}

async function resolveWalkUrl(
  automergeUrl: string,
  repo: Repo
): Promise<AutomergeUrl> {
  let rootUrl: string
  let subpath: string | undefined
  const slashIndex = automergeUrl.indexOf("/", "automerge:".length)
  if (slashIndex !== -1) {
    rootUrl = automergeUrl.slice(0, slashIndex)
    subpath = automergeUrl.slice(slashIndex + 1)
  } else {
    rootUrl = automergeUrl
  }

  if (!isValidAutomergeUrl(rootUrl)) {
    throw new Error(`Invalid automerge URL: ${rootUrl}`)
  }

  let walkUrl: AutomergeUrl = rootUrl as AutomergeUrl
  if (subpath) {
    walkUrl = await resolveSubfolder(repo, rootUrl as AutomergeUrl, subpath)
  }

  return walkUrl
}

async function resolveSubfolder(
  repo: Repo,
  rootUrl: AutomergeUrl,
  subpath: string
): Promise<AutomergeUrl> {
  const parts = subpath.split("/").filter(Boolean)
  let currentUrl = rootUrl

  for (const part of parts) {
    const handle = await repo.find<{
      docs: Array<{ name: string; type: string; url: AutomergeUrl }>
    }>(currentUrl)
    const doc = handle.doc()
    const entry = doc.docs.find(
      (e) => e.name === part && e.type === "folder"
    )
    if (!entry) {
      throw new Error(
        `Subfolder "${part}" not found in ${currentUrl} (resolving subpath "${subpath}")`
      )
    }
    currentUrl = entry.url
  }

  return currentUrl
}

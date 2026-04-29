import { Repo } from "@automerge/automerge-repo"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import type { AutomergeUrl } from "@automerge/automerge-repo"
import type {
  DirectoryDocument,
  FileDocument,
  FileEntry,
} from "./types.js"

export const DEFAULT_SYNC_SERVER = "wss://sync3.automerge.org"
export const DEFAULT_SUBDUCTION_SERVER =
  "wss://subduction.sync.inkandswitch.com"
const DEFAULT_TIMEOUT_MS = 30_000

let subductionReady = false

async function ensureSubduction(): Promise<void> {
  if (subductionReady) return
  const mod: any = await import("@automerge/automerge-repo")
  await mod.initSubduction()
  subductionReady = true
}

export async function createRepo(opts?: {
  syncServerUrl?: string
  sub?: boolean
}): Promise<Repo> {
  await ensureSubduction()
  const sub = opts?.sub !== false
  if (sub) {
    return new Repo({
      subductionWebsocketEndpoints: [
        opts?.syncServerUrl ?? DEFAULT_SUBDUCTION_SERVER,
      ],
      periodicSyncInterval: 0,
      batchSyncInterval: 0,
    } as any)
  }
  return new Repo({
    network: [
      new BrowserWebSocketClientAdapter(
        opts?.syncServerUrl ?? DEFAULT_SYNC_SERVER
      ) as any,
    ],
  })
}

async function findWithTimeout<T>(
  repo: Repo,
  url: AutomergeUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const handle = await repo.find<T>(url, { signal: controller.signal } as any)
    return handle.doc()
  } finally {
    clearTimeout(timer)
  }
}

export async function walkFolderTree(
  repo: Repo,
  rootUrl: AutomergeUrl,
  basePath = ""
): Promise<FileEntry[]> {
  const doc = await findWithTimeout<DirectoryDocument>(repo, rootUrl)
  const files: FileEntry[] = []

  for (const entry of doc.docs) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name

    if (entry.type === "folder") {
      const subFiles = await walkFolderTree(repo, entry.url, entryPath)
      files.push(...subFiles)
    } else {
      const fileDoc = await findWithTimeout<FileDocument>(repo, entry.url)
      const content =
        fileDoc.content instanceof Uint8Array
          ? Buffer.from(fileDoc.content)
          : Buffer.from(String(fileDoc.content), "utf-8")
      files.push({
        path: entryPath,
        content,
        mode: fileDoc.metadata?.permissions,
      })
    }
  }

  return files
}

export async function readPackageJson(
  repo: Repo,
  rootUrl: AutomergeUrl
): Promise<{ name: string; version: string }> {
  const doc = await findWithTimeout<DirectoryDocument>(repo, rootUrl)

  const pkgEntry = doc.docs.find(
    (e) => e.name === "package.json" && e.type === "file"
  )
  if (!pkgEntry) {
    throw new Error(
      `No package.json found in automerge folder document ${rootUrl}`
    )
  }

  const fileDoc = await findWithTimeout<FileDocument>(repo, pkgEntry.url)
  const content =
    typeof fileDoc.content === "string"
      ? fileDoc.content
      : new TextDecoder().decode(fileDoc.content)

  return JSON.parse(content)
}

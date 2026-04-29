import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as crypto from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createServer, type Server, type AddressInfo } from "node:http"
import { readFileSync } from "node:fs"

const exec = promisify(execFile)
const FIXTURE_DIR = path.join(import.meta.dirname, "fixture")
const PROJECT_ROOT = path.join(import.meta.dirname, "..")
const PNPM = path.join(PROJECT_ROOT, "node_modules/.bin/pnpm")
const PKG_VERSION = JSON.parse(
  readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8")
).version as string
const TARBALL_NAME = `pnpm-plugin-patchwork-${PKG_VERSION}.tgz`

let registry: Server
let registryPort: number

beforeAll(async () => {
  // Clean up any previous install
  await fs.rm(path.join(FIXTURE_DIR, "node_modules"), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(FIXTURE_DIR, "pnpm-lock.yaml"), { force: true })
  await fs.rm(path.join(FIXTURE_DIR, TARBALL_NAME), { force: true })

  // Pack the built project into a tarball
  await exec("pnpm", ["pack", "--pack-destination", FIXTURE_DIR], {
    cwd: PROJECT_ROOT,
  })

  const tarballPath = path.join(FIXTURE_DIR, TARBALL_NAME)
  const tarballData = await fs.readFile(tarballPath)

  // Compute SHA512 integrity of the tarball
  const hash = crypto
    .createHash("sha512")
    .update(tarballData)
    .digest("base64")
  const integrity = `sha512-${hash}`

  // Start a local registry that serves the plugin and proxies everything
  // else to the real npm registry
  registry = createServer(async (req, res) => {
    if (req.url === "/pnpm-plugin-patchwork") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          name: "pnpm-plugin-patchwork",
          "dist-tags": { latest: PKG_VERSION },
          versions: {
            [PKG_VERSION]: {
              name: "pnpm-plugin-patchwork",
              version: PKG_VERSION,
              dist: {
                integrity,
                tarball: `http://localhost:${registryPort}/pnpm-plugin-patchwork/-/${TARBALL_NAME}`,
              },
            },
          },
        })
      )
    } else if (
      req.url === `/pnpm-plugin-patchwork/-/${TARBALL_NAME}`
    ) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" })
      res.end(tarballData)
    } else {
      // Proxy to real npm registry
      try {
        const upstream = await fetch(
          `https://registry.npmjs.org${req.url}`,
          {
            headers: { accept: req.headers.accept ?? "" },
            signal: AbortSignal.timeout(30_000),
          }
        )
        const body = Buffer.from(await upstream.arrayBuffer())
        res.writeHead(upstream.status, {
          "content-type":
            upstream.headers.get("content-type") ?? "application/octet-stream",
        })
        res.end(body)
      } catch {
        res.writeHead(502)
        res.end("Bad Gateway")
      }
    }
  })

  await new Promise<void>((resolve) => {
    registry.listen(0, () => {
      registryPort = (registry.address() as AddressInfo).port
      resolve()
    })
  })

  // Write pnpm-workspace.yaml with config dependency using version+integrity
  await fs.writeFile(
    path.join(FIXTURE_DIR, "pnpm-workspace.yaml"),
    [
      "configDependencies:",
      `  pnpm-plugin-patchwork: "${PKG_VERSION}+${integrity}"`,
      "",
      "allowBuilds:",
      "  cbor-extract: false",
      "",
    ].join("\n")
  )
})

afterAll(async () => {
  if (registry) {
    await new Promise<void>((resolve) => registry.close(() => resolve()))
  }
  await fs.rm(path.join(FIXTURE_DIR, "node_modules"), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(FIXTURE_DIR, "pnpm-lock.yaml"), { force: true })
  await fs.rm(path.join(FIXTURE_DIR, TARBALL_NAME), { force: true })
  // Restore workspace yaml to avoid interfering with root pnpm commands
  await fs.writeFile(
    path.join(FIXTURE_DIR, "pnpm-workspace.yaml"),
    "allowBuilds:\n  cbor-extract: false\n"
  )
})

describe("e2e: pnpm install", () => {
  it("installs an automerge: dependency via pnpm", async () => {
    // Run pnpm install in the fixture directory
    const { stdout, stderr } = await exec(
      PNPM,
      [
        "install",
        "--no-frozen-lockfile",
        `--registry=http://localhost:${registryPort}`,
      ],
      {
        cwd: FIXTURE_DIR,
        timeout: 90_000,
        env: { ...process.env, npm_config_yes: "true", PATCHWORK_SUB: "false" },
      }
    ).catch((err) => {
      const out = (err.stdout ?? "") + (err.stderr ?? "")
      // pnpm exits 1 for ERR_PNPM_IGNORED_BUILDS which isn't a real failure
      if (out.includes("ERR_PNPM_IGNORED_BUILDS")) {
        return { stdout: err.stdout ?? "", stderr: err.stderr ?? "" }
      }
      // Rethrow with full output visible
      throw new Error(
        `pnpm install failed (code ${err.code}):\nSTDOUT: ${err.stdout}\nSTDERR: ${err.stderr}`
      )
    })

    const output = stdout + stderr
    expect(output).toContain("@patchwork/chat")

    // Verify the package was installed
    const pkgJsonPath = path.join(
      FIXTURE_DIR,
      "node_modules/@patchwork/chat/package.json"
    )
    const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8"))
    expect(pkgJson.name).toBe("@patchwork/chat")
    expect(pkgJson.version).toMatch(/^0\.\d+\.\d+$/)

    // Verify actual source files exist
    const files = await fs.readdir(
      path.join(FIXTURE_DIR, "node_modules/@patchwork/chat")
    )
    expect(files.length).toBeGreaterThan(1)
  }, 120_000)
})

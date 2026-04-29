import * as esbuild from "esbuild"
import { createRequire } from "module"
import * as path from "path"
import * as fs from "fs"

const require = createRequire(import.meta.url)

function findPackageDir(packageName) {
  const main = require.resolve(packageName)
  let dir = path.dirname(main)
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    dir = path.dirname(dir)
  }
  return dir
}

const automergeDir = findPackageDir("@automerge/automerge")
const subductionDir = findPackageDir("@automerge/automerge-subduction")

const wasmBase64Plugin = {
  name: "wasm-base64",
  setup(build) {
    build.onResolve({ filter: /^@automerge\/automerge$/ }, () => ({
      path: path.join(
        automergeDir,
        "dist/mjs/entrypoints/fullfat_base64.js"
      ),
    }))

    // Redirect bare @automerge/automerge-subduction to a virtual module
    // that decodes the base64 wasm and initializes it, so the bundle is
    // self-contained (no .wasm file on disk needed at runtime).
    build.onResolve({ filter: /^@automerge\/automerge-subduction$/ }, () => ({
      path: "subduction-base64-init",
      namespace: "subduction-virtual",
    }))

    build.onLoad(
      { filter: /.*/, namespace: "subduction-virtual" },
      () => ({
        contents: `
          import { initSync } from "@automerge/automerge-subduction/slim";
          import { wasmBase64 } from "@automerge/automerge-subduction/wasm-base64";
          const wasmBytes = Buffer.from(wasmBase64, "base64");
          initSync({ module: wasmBytes });
          export * from "@automerge/automerge-subduction/slim";
        `,
        resolveDir: subductionDir,
        loader: "js",
      })
    )
  },
}

await esbuild.build({
  entryPoints: ["src/pnpmfile.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "pnpmfile.mjs",
  plugins: [wasmBase64Plugin],
  banner: {
    js: [
      'import { createRequire as __cjsRequire } from "module";',
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __pathDirname } from "path";',
      "const require = __cjsRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join(" "),
  },
})

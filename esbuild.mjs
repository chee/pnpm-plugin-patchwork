import * as esbuild from "esbuild"
import { createRequire } from "module"
import * as path from "path"
import * as fs from "fs"

const require = createRequire(import.meta.url)

// Find the automerge package root by resolving the main entry then walking up
const automergeMain = require.resolve("@automerge/automerge")
let automergeDir = path.dirname(automergeMain)
while (!fs.existsSync(path.join(automergeDir, "package.json"))) {
  automergeDir = path.dirname(automergeDir)
}

const automergeBase64Plugin = {
  name: "automerge-base64",
  setup(build) {
    // Redirect the fullfat node entrypoint to the base64 one
    // so the WASM is embedded in the bundle instead of loaded from disk
    build.onResolve({ filter: /^@automerge\/automerge$/ }, () => ({
      path: path.join(
        automergeDir,
        "dist/mjs/entrypoints/fullfat_base64.js"
      ),
    }))
  },
}

await esbuild.build({
  entryPoints: ["src/pnpmfile.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "pnpmfile.mjs",
  plugins: [automergeBase64Plugin],
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

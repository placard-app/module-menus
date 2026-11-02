#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"
import { zipSync } from "fflate"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const packDir = join(root, "pack")
const distZipParent = join(root, "dist")
const manifest = JSON.parse(readFileSync(join(root, "placard.module.json"), "utf8"))

rmSync(packDir, { recursive: true, force: true })
mkdirSync(join(packDir, "server"), { recursive: true })
mkdirSync(join(packDir, "web"), { recursive: true })
mkdirSync(distZipParent, { recursive: true })

cpSync(join(root, "placard.module.json"), join(packDir, "placard.module.json"))
cpSync(join(root, "LICENSE"), join(packDir, "LICENSE"))

const shimReact = join(root, "src/web/shims/react.ts")
const shimJsx = join(root, "src/web/shims/jsx-runtime.ts")
const shimRouter = join(root, "src/web/shims/react-router.ts")

await esbuild.build({
  entryPoints: [join(root, "src/server/index.ts")],
  outfile: join(packDir, "server/index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "info",
})

await esbuild.build({
  entryPoints: [join(root, "src/web/index.ts")],
  outfile: join(packDir, "web/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  alias: {
    react: shimReact,
    "react/jsx-runtime": shimJsx,
    "react-router": shimRouter,
  },
  logLevel: "info",
})

const webAssets = join(root, "src/web/assets")
if (existsSync(webAssets)) {
  mkdirSync(join(packDir, "web/assets"), { recursive: true })
  cpSync(webAssets, join(packDir, "web/assets"), { recursive: true })
}

writeFileSync(
  join(packDir, "README.md"),
  `# ${manifest.id}

Upload this zip in Placard → Settings → Module marketplace
(or install from this GitHub repo’s latest Release).

Requires a Placard SDK 1 host with place-sections and persistent-data capabilities.
`,
)

const collect = (dir, prefix = "") => {
  const files = {}
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(abs).isDirectory()) Object.assign(files, collect(abs, rel))
    else files[rel] = new Uint8Array(readFileSync(abs))
  }
  return files
}

const files = collect(packDir)
const zipped = zipSync(files, { level: 6 })
const outZip = join(distZipParent, `${manifest.id}-${manifest.version}.zip`)
const outModule = join(distZipParent, `${manifest.id}-${manifest.version}.placard-module`)
writeFileSync(outZip, Buffer.from(zipped))
writeFileSync(outModule, Buffer.from(zipped))
console.log(`Packed ${outZip}`)
console.log(`Packed ${outModule} (${Object.keys(files).length} files)`)

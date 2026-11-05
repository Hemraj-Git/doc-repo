// Bundles the sandboxed preview renderer (docx-preview, SheetJS, pptx-preview) into
// public/preview/frame.js. Runs automatically before `next dev` and `next build`.
import { build } from "esbuild"

await build({
  entryPoints: ["preview-frame/frame.ts"],
  outfile: "public/preview/frame.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  platform: "browser",
  legalComments: "external",
  logLevel: "warning",
})

console.log("✔ Built public/preview/frame.js")

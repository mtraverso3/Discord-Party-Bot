import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })

// Main process and preload run inside Electron's Node runtime.
const nodeOpts = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
}
await build({ ...nodeOpts, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' })
await build({ ...nodeOpts, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js' })

// Renderer is a plain browser bundle.
await build({
  entryPoints: ['src/renderer/app.ts'],
  outfile: 'dist/renderer.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
})

copyFileSync('src/renderer/index.html', 'dist/index.html')
copyFileSync('src/renderer/styles.css', 'dist/styles.css')

console.log('Build complete.')

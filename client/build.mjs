import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

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

// Renderer is a React browser bundle; Tailwind compiles the stylesheet.
await build({
  entryPoints: ['src/renderer/main.tsx'],
  outfile: 'dist/renderer.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})

execSync('npx @tailwindcss/cli -i src/renderer/styles.css -o dist/styles.css --minify', { stdio: 'inherit' })
copyFileSync('src/renderer/index.html', 'dist/index.html')

console.log('Build complete.')

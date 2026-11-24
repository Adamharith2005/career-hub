// Produces an unpacked, runnable desktop app in release/ for the CURRENT platform using @electron/packager (no code-signing tools needed).
import { packager } from '@electron/packager'
const out = await packager({
  dir: '.', name: 'Career Hub', out: 'release', overwrite: true, prune: true, asar: true,
  platform: process.platform, arch: process.arch, extraResource: ['data'],
  ignore: [/^\/(tests|scripts|test-output|renderer|core|electron|docs|release|private|graphify-out|\.git|\.env)/, /\.log$/, /^\/(tsconfig|vite\.config|vitest\.config).*/, /\.map$/],
  appCopyright: 'Career Hub — local-first, private by default',
})
console.log('Packaged to:', out.join(', '))

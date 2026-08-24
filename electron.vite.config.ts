import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const require_ = createRequire(import.meta.url)

export default defineConfig({
  main: {
    // Embedded feature backends must be bundled (not externalized): the runtime
    // reaches them through code-split dynamic imports.
    plugins: [externalizeDepsPlugin({ exclude: [
      '@moirasia/desktop-shell', '@moirasia/ui-react', '@moirasia/feature-exithibition', '@moirasia/feature-amove', '@moirasia/feature-orbis',
      '@codemirror/commands', '@codemirror/state', '@codemirror/view', 'zod'
    ] })],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@moirasia/feature-exithibition', '@moirasia/feature-amove', '@moirasia/feature-orbis'] })],
    build: {
      rollupOptions: {
        input: {
          shell: resolve(import.meta.dirname, 'src/preload/shell.ts'),
          'feature-amove-shelf': require_.resolve('@moirasia/feature-amove/preload/shelf')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    resolve: { dedupe: ['react', 'react-dom'] },
    plugins: [react(), tailwindcss()],
    // ui-react is a linked workspace package, so Vite does not crawl its CommonJS
    // transitive dependencies automatically. The telemetry renderer pulls recharts
    // through it; pre-bundle both packages so the CJS export works in the browser.
    optimizeDeps: {
      include: [
        '@moirasia/ui-react > recharts',
        '@moirasia/ui-react > recharts > use-sync-external-store/shim/with-selector'
      ]
    },
    build: {
      rollupOptions: {
        input: {
          shell: resolve(import.meta.dirname, 'src/renderer/shell.html'),
          'feature-amove-shelf': resolve(import.meta.dirname, 'src/renderer/feature-amove-shelf.html')
        }
      }
    }
  }
})

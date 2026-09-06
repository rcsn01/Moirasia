import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

function requireSelfContainedPreloads(): Plugin {
  return {
    name: 'require-self-contained-preloads',
    generateBundle(_options, bundle) {
      const sharedChunks = Object.values(bundle).filter((output) => output.type === 'chunk' && !output.isEntry)
      if (sharedChunks.length > 0) this.error(`Preload entries must be self-contained; shared chunks race Electron startup: ${sharedChunks.map((chunk) => chunk.fileName).join(', ')}`)
    }
  }
}

export default defineConfig({
  main: {
    // Embedded feature backends must be bundled (not externalized): the runtime
    // reaches them through code-split dynamic imports.
    plugins: [externalizeDepsPlugin({ exclude: [
      '@moirasia/desktop-shell', '@moirasia/ui-react',
      '@codemirror/commands', '@codemirror/state', '@codemirror/view', 'zod'
    ] })],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), requireSelfContainedPreloads()],
    build: {
      rollupOptions: {
        input: {
          shell: resolve(import.meta.dirname, 'src/preload/shell.ts'),
          'feature-amove-shelf': resolve(import.meta.dirname, 'apps/integrated/Amove/src/preload/shelf.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    // Renderer entries live inside the integrated app repos (apps/integrated/<App>/src/renderer),
    // so the renderer root is the repository root.
    root: resolve(import.meta.dirname),
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
          'feature-amove-shelf': resolve(import.meta.dirname, 'apps/integrated/Amove/src/renderer/shelf.html')
        }
      }
    }
  }
})

import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@moirasia/desktop-shell', '@moirasia/ui-react'] })],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          shell: resolve(import.meta.dirname, 'src/preload/shell.ts')
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
    build: {
      rollupOptions: {
        input: {
          shell: resolve(import.meta.dirname, 'src/renderer/shell.html')
        }
      }
    }
  }
})

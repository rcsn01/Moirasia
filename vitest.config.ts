import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      include: ['src/main/application-controller.ts', 'src/main/settings.ts', 'packages/desktop-shell/src/**/*.ts']
    }
  }
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      include: ['src/main/application-controller.ts', 'src/main/settings.ts', 'packages/desktop-shell/src/**/*.ts']
    }
  }
})

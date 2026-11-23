import { defineConfig, devices } from '@playwright/test'

const origin = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL,
    baseURL: origin + '/dlut-nihongo-quiz/',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: origin + '/dlut-nihongo-quiz/',
  },
})

import { defineConfig } from "@playwright/test"
import { resolve } from "node:path"
const core = process.env.PLACARD_CORE_DIR ?? "../core"
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    command: `node ${resolve(core, "apps/server/test/e2e-server.ts")}`,
    url: "http://localhost:3100/api/health",
    timeout: 180000,
    env: {
      ...process.env,
      PORT: "3100",
      PLACARD_MODULES_DIR: resolve("test-results/host-modules"),
      MEDIA_DIR: resolve("test-results/host-media"),
    },
  },
})

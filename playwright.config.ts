/// <reference types="node" />
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    headless: true,
    baseURL: "http://localhost:4567",
  },
  webServer: {
    command: "node harness/serve.js",
    port: 4567,
    reuseExistingServer: !process.env.CI,
  },
});

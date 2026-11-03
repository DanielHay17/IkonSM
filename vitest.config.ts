import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import agents from "agents/vite";

export default defineConfig({
  plugins: [
    agents(),
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: { bindings: { HUB_PASSCODE: "test-pass", SESSION_SECRET: "test-secret" } },
    }),
  ],
  test: { include: ["test/**/*.spec.ts"], testTimeout: 30000 },
});

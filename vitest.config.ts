import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import agents from "agents/vite";

export default defineConfig({
  plugins: [
    agents(),
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      // ANTHROPIC_API_KEY and CF_AIG_TOKEN are forced empty so tests always use the rules/template engines,
      // even if .dev.vars has a key or an AI Gateway token (LLM_PROVIDER "auto" then resolves to off).
      // EMAIL_DOMAIN stays on the reserved test domain whatever the deployed one is.
      miniflare: {
        bindings: { HUB_PASSCODE: "test-passcode-1234", SESSION_SECRET: "test-secret", ANTHROPIC_API_KEY: "", CF_AIG_TOKEN: "", EMAIL_DOMAIN: "ikon.example.com" },
      },
    }),
  ],
  test: { include: ["test/**/*.spec.ts"], testTimeout: 30000 },
});

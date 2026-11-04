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
      // The Microsoft 365 app is forced off too; test/onedrive.spec.ts switches it on in an env view.
      miniflare: {
        bindings: {
          HUB_PASSCODE: "test-passcode-1234",
          SESSION_SECRET: "test-secret",
          ANTHROPIC_API_KEY: "",
          CF_AIG_TOKEN: "",
          MS_CLIENT_ID: "",
          MS_CLIENT_SECRET: "",
          MS_TENANT: "",
        },
      },
    }),
  ],
  test: { include: ["test/**/*.spec.ts"], testTimeout: 30000 },
});

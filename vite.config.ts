import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import agents from "agents/vite";

export default defineConfig({
  plugins: [agents(), react(), tailwindcss(), cloudflare({ remoteBindings: false })],
});

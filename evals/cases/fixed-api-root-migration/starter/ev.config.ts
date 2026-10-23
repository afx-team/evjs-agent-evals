import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
  server: { routing: { dir: "./src/endpoints" } },
});

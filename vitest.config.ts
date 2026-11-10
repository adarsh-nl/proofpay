import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Several agents and CI share the machine; module imports alone can take seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // src/server/** modules start with `import "server-only"`, which throws when
      // imported outside a React Server Component. Unit tests run under plain node.
      "server-only": fileURLToPath(
        new URL("./tests/unit/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
});

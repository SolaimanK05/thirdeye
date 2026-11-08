import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Every test file runs in its own worker, so a full run starts about a
    // hundred workers at once. The slower files (server-render and bench
    // tests) can pass 5 s on a busy machine; 20 s keeps a run from failing
    // on load alone.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

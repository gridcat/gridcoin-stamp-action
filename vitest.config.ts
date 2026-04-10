import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests run under plain Node (no jsdom / happy-dom), matching the
    // environment the action actually executes in on GitHub runners.
    environment: 'node',

    // Enables `describe`, `it`, `expect`, `beforeEach`, `vi`, etc. as
    // ambient globals so test files don't need per-file imports. Paired
    // with `"types": ["vitest/globals", "node"]` in tsconfig.json so the
    // TS language server picks up the same declarations.
    globals: true,

    include: ['__tests__/**/*.test.ts'],
  },
});

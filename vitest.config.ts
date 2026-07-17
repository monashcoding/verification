import { defineConfig } from 'vitest/config';

// Explicit config so Vitest does not auto-discover web/vite.config.ts as a second
// project and run the server tests twice. Unit tests are pure (no DB) and live
// alongside the server code.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

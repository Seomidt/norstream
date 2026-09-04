import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Task 1 opretter ingen tests endnu. Uden dette fejler `npm test --workspaces`
    // fra repo-roden med "No test files found". Fjern naar rigtige tests findes.
    passWithNoTests: true,
  },
});

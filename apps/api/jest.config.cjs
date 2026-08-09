/**
 * Jest config for the chat engine test suite (TASK 0 — P1 blocker fix).
 *
 * WHY ESM mode: src/services/chat/__tests__/*.test.ts are written for Node's
 * built-in `node:test` runner and the chat code they import (transitively,
 * e.g. src/utils/logger.ts) uses ESM-only idioms:
 *     const __filename = fileURLToPath(import.meta.url);
 * These are valid native ESM but are a SyntaxError under Jest's CommonJS
 * wrapper (which already declares `__filename`/`__dirname`). Rather than
 * touch any source/test file (out of scope per RAILS.md §4), we run Jest in
 * its official ESM mode (`--experimental-vm-modules` + ts-jest useESM), so the
 * source stays native ESM and compiles cleanly.
 *
 * The suite imports `describe`/`it`/`mock` from `node:test`. Jest collects
 * tests only through ITS OWN registry, so moduleNameMapper redirects
 * `node:test` → jest.node-test-shim.mjs, which re-exports Jest globals under
 * the node:test module name. No existing test file is modified.
 *
 * Run:  npm run test:chat
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  // treat .ts as ESM so ts-jest useESM path runs and `import.meta.url` is valid
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['<rootDir>/src/services/chat/__tests__/**/*.test.ts', '<rootDir>/src/services/chat/tests/**/*.test.ts'],
  moduleNameMapper: {
    // strip `.js` from relative ESM specifiers → resolve to .ts source
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // node:test -> jest shim (test sources import describe/it/mock from here)
    '^node:test$': '<rootDir>/jest.node-test-shim.mjs',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        useESM: true,
        isolatedModules: true,
        diagnostics: false,
      },
    ],
  },
  // ts-jest ESM needs the .js specifier rewritten too; keep resolver fast
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  injectGlobals: false,
  verbose: true,
  forceExit: true,
};

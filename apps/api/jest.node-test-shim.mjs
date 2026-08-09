// Jest compatibility shim exposing Node's `node:test` API surface on top of
// Jest globals. Loaded via jest.config moduleNameMapper: '^node:test$'.
//
// Under Jest ESM mode the test files still do
// `import { describe, it, before, after, beforeEach } from 'node:test'`
// (and one file uses `mock`). Jest collects tests by intercepting its OWN
// describe/it — so this shim re-exports Jest's globals under the `node:test`
// module name. No test source file is touched.
//
// node:test -> Jest mapping (only members imported by the suite):
//   describe / it / test       -> jest describe / it / test
//   before / after             -> beforeAll / afterAll (once per file)
//   beforeEach / afterEach     -> beforeEach / afterEach
//   mock.fn() + .mock.callCount -> jest.fn() + callCount adapter
import {
  describe,
  it,
  test,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  jest,
} from '@jest/globals';

export { describe, it, test, beforeEach, afterEach, beforeAll, afterAll };

// node:test's `before`/`after` run once per scope (file level) -> jest all.
export const before = beforeAll;
export const after = afterAll;

// node:test mock helpers used by shadow-hook-v2.test.ts:
//   `mock.fn(() => …)` and `mockedFn.mock.callCount()`.
export const mock = {
  fn: function (...args) {
    const m = jest.fn(...(args || []));
    const mocked = m.mock || {};
    mocked.callCount = function () {
      const calls = m.mock.calls || [];
      return calls.length;
    };
    m.mock = mocked;
    return m;
  },
};

export default { describe, it, test, beforeEach, afterEach, mock };

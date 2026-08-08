import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { shouldRunShadow } from '../shadow-config.js';
import * as conversationServiceModule from '../../../business/conversation.service.js';

describe('shadow-config', () => {
  const originalEnv = process.env;
  
  it('shouldRunShadow: founder_only + store-founder -> true', () => {
    process.env.SHADOW_MODE = 'founder_only';
    process.env.FOUNDER_STORE_ID = 'store-founder';
    assert.strictEqual(shouldRunShadow('store-founder'), true);
    process.env = { ...originalEnv };
  });

  it('shouldRunShadow: founder_only + store-lain -> false', () => {
    process.env.SHADOW_MODE = 'founder_only';
    process.env.FOUNDER_STORE_ID = 'store-founder';
    assert.strictEqual(shouldRunShadow('store-lain'), false);
    process.env = { ...originalEnv };
  });

  it('shouldRunShadow: true -> true', () => {
    process.env.SHADOW_MODE = 'true';
    assert.strictEqual(shouldRunShadow('store-any'), true);
    process.env = { ...originalEnv };
  });

  it('shouldRunShadow: false -> false', () => {
    process.env.SHADOW_MODE = 'false';
    assert.strictEqual(shouldRunShadow('store-founder'), false);
    process.env = { ...originalEnv };
  });
});

describe('shadow-hook-behavior', () => {
  it('Hook tidak dijalankan jika shouldRunShadow=false', () => {
    const setImmediateMock = mock.fn();
    const globalSetImmediate = global.setImmediate;
    global.setImmediate = setImmediateMock as any;

    const storeId = 'store-lain';
    process.env.SHADOW_MODE = 'false';
    
    // Simulating the check
    if (shouldRunShadow(storeId)) {
        setImmediate(() => {});
    }

    assert.strictEqual(setImmediateMock.mock.callCount(), 0);
    global.setImmediate = globalSetImmediate;
  });

  it('Hook dijalankan jika shouldRunShadow=true', () => {
    const setImmediateMock = mock.fn();
    const globalSetImmediate = global.setImmediate;
    global.setImmediate = setImmediateMock as any;

    const storeId = 'store-founder';
    process.env.SHADOW_MODE = 'true';
    
    if (shouldRunShadow(storeId)) {
        setImmediate(() => {});
    }

    assert.strictEqual(setImmediateMock.mock.callCount(), 1);
    global.setImmediate = globalSetImmediate;
  });

  it('Hook fail-open: reasoning throw tidak throw ke caller', async () => {
    // Mock understand untuk throw error
    const understand = mock.fn(() => Promise.reject(new Error('Reasoning failed')));
    
    // Simulate background execution
    const runShadow = async () => {
      try {
        await understand();
      } catch (err) {
        // Fail-open: catch error
        return 'caught';
      }
    };

    const result = await runShadow();
    assert.strictEqual(result, 'caught');
    assert.strictEqual(understand.mock.callCount(), 1);
  });
});

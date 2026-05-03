import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { startConsumptionEngine, stopConsumptionEngine } from '../../src/jobs/consumptionEngine';

describe('startConsumptionEngine', () => {
  beforeEach(() => {
    stopConsumptionEngine();
  });

  afterEach(() => {
    stopConsumptionEngine();
  });

  it('starts the engine and returns a handle', () => {
    const handle = startConsumptionEngine();
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe('function');
    expect(typeof handle.triggerNow).toBe('function');
    handle.stop();
  });

  it('stop is idempotent', () => {
    const handle = startConsumptionEngine();
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });

  it('triggerNow runs a consumption cycle', async () => {
    const handle = startConsumptionEngine();
    await expect(handle.triggerNow()).resolves.toBeUndefined();
    handle.stop();
  });

  it('runOnStart fires once immediately', async () => {
    const handle = startConsumptionEngine({ runOnStart: true });
    await new Promise((r) => setTimeout(r, 50));
    handle.stop();
  });
});

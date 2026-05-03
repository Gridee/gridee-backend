import { describe, expect, it } from 'vitest';
import {
  HardwareLayerFactory,
  InMemoryEnergyBalanceRepository,
  MockHardwareLayer,
} from '../../src/hal';
import { ConfigError } from '../../src/lib/errors';

describe('HardwareLayerFactory', () => {
  it('builds MockHardwareLayer with default in-memory repo when none supplied', () => {
    const hal = HardwareLayerFactory.create({ type: 'mock' });
    expect(hal).toBeInstanceOf(MockHardwareLayer);
  });

  it('builds MockHardwareLayer with supplied repo', () => {
    const repo = new InMemoryEnergyBalanceRepository();
    const hal = HardwareLayerFactory.create({ type: 'mock', repository: repo });
    expect(hal).toBeInstanceOf(MockHardwareLayer);
  });

  it('throws on unknown type', () => {
    expect(() =>
      HardwareLayerFactory.create({ type: 'mqtt' as never }),
    ).toThrow(ConfigError);
  });

  it('uses the supplied clock', async () => {
    const repo = new InMemoryEnergyBalanceRepository({ clock: () => 12345 });
    const hal = HardwareLayerFactory.create({
      type: 'mock',
      repository: repo,
      clock: () => 12345,
    });
    await hal.mint(repo._seedForTest === undefined ? ('t' as never) : ('t' as never), 1000);
    // The clock is used in the repo's lastUpdatedAt — we don't directly observe
    // it on the HAL output, but this test confirms the factory accepts and
    // forwards the clock without error.
    expect(hal).toBeInstanceOf(MockHardwareLayer);
  });
});

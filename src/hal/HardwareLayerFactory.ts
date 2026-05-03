import { ConfigError } from '../lib/errors';
import {
  type IEnergyBalanceRepository,
  InMemoryEnergyBalanceRepository,
} from './IEnergyBalanceRepository';
import type { IHardwareLayer } from './IHardwareLayer';
import { MockHardwareLayer } from './MockHardwareLayer';

export type HardwareLayerType = 'mock';
// Future: 'mock' | 'mqtt'

export interface HardwareLayerFactoryConfig {
  type: HardwareLayerType;
  /**
   * Repository to back the HAL. Required for 'mock'. Caller decides
   * which repo impl (InMemory for dev/test, Postgres for prod).
   *
   * If omitted with type='mock', an InMemoryEnergyBalanceRepository is
   * used — convenient for tests but NOT for production.
   */
  repository?: IEnergyBalanceRepository;
  /** Optional clock injection for deterministic tests. */
  clock?: () => number;
}

/**
 * Hardware Abstraction Layer factory.
 *
 * Currently only `mock` is supported. The MQTT impl will be added when real
 * hardware is in scope — at that point the factory adds a 'mqtt' branch and
 * everything else stays the same.
 */
export class HardwareLayerFactory {
  static create(config: HardwareLayerFactoryConfig): IHardwareLayer {
    switch (config.type) {
      case 'mock': {
        const repository = config.repository ?? new InMemoryEnergyBalanceRepository(
          config.clock ? { clock: config.clock } : {},
        );
        const opts: ConstructorParameters<typeof MockHardwareLayer>[0] = { repository };
        if (config.clock) opts.clock = config.clock;
        return new MockHardwareLayer(opts);
      }
      default: {
        const _exhaustive: never = config.type;
        throw new ConfigError(`Unknown hardware layer type: ${String(_exhaustive)}`);
      }
    }
  }
}

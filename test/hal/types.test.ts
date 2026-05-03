import { describe, expect, it } from 'vitest';
import { kwhToMGrd, M_GRD_PER_GRD, toGrd, toMGrd } from '../../src/hal/types';

describe('mGRD math', () => {
  it('M_GRD_PER_GRD is 1000', () => {
    expect(M_GRD_PER_GRD).toBe(1000);
  });

  it('toMGrd rounds to nearest integer', () => {
    expect(toMGrd(1.0)).toBe(1000);
    expect(toMGrd(0.5)).toBe(500);
    expect(toMGrd(0.001)).toBe(1);
    expect(toMGrd(0.0004)).toBe(0);
    expect(toMGrd(0.0005)).toBe(1);
    expect(toMGrd(2.5)).toBe(2500);
  });

  it('toGrd is the inverse of toMGrd at 3-decimal precision', () => {
    for (const grd of [0, 0.001, 0.5, 1, 1.234, 100.005]) {
      expect(toGrd(toMGrd(grd))).toBeCloseTo(grd, 3);
    }
  });

  it('kwhToMGrd: 1 kWh = 1000 mGRD', () => {
    expect(kwhToMGrd(1)).toBe(1000);
    expect(kwhToMGrd(0.5)).toBe(500);
    expect(kwhToMGrd(0.001)).toBe(1);
  });

  it('toMGrd rejects non-finite numbers', () => {
    expect(() => toMGrd(NaN)).toThrow(RangeError);
    expect(() => toMGrd(Infinity)).toThrow(RangeError);
    expect(() => toMGrd(-Infinity)).toThrow(RangeError);
  });

  it('summing many 0.5 kWh in mGRD has no float drift', () => {
    let total = 0;
    for (let i = 0; i < 1000; i++) total += kwhToMGrd(0.5);
    expect(total).toBe(500_000); // 1000 × 500 exactly
    expect(toGrd(total)).toBe(500); // 500 GRD = 500 kWh
  });
});

import { describe, expect, it } from 'vitest';

import {
  decodeRules,
  encodeRules,
  MAX_SPECIES,
  mulberry32,
  mutateRules,
  presetRules,
  randomRules,
  setCell,
  toGpuMatrix,
} from './rules';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rules', () => {
  it('random rules are reproducible and quantised to 0.1', () => {
    const r = randomRules(5, 123);
    expect(r).toEqual(randomRules(5, 123));
    expect(r.matrix).toHaveLength(25);
    for (const v of r.matrix) {
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.round(v * 10)).toBeCloseTo(v * 10);
    }
  });

  it('clamps the species count', () => {
    expect(randomRules(1, 1).species).toBe(2);
    expect(randomRules(99, 1).species).toBe(MAX_SPECIES);
  });

  it('chains preset links each species to the next one', () => {
    const r = presetRules('chains', 4);
    expect(r.matrix[0 * 4 + 1]).toBe(0.4);
    expect(r.matrix[3 * 4 + 0]).toBe(0.4); // wraps around
    expect(r.matrix[1 * 4 + 0]).toBe(-0.3);
    expect(r.matrix[2 * 4 + 2]).toBe(0.6);
  });

  it('setCell clamps and quantises without mutating the input', () => {
    const r = presetRules('clusters', 3);
    const next = setCell(r, 0, 2, 1.37);
    expect(next.matrix[2]).toBe(1);
    expect(r.matrix[2]).toBe(-0.4);
  });

  it('mutation keeps values valid', () => {
    const m = mutateRules(randomRules(6, 9), 10, 0.5);
    for (const v of m.matrix) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it('pads the matrix into a fixed GPU layout', () => {
    const gpu = toGpuMatrix(presetRules('clusters', 2));
    expect(gpu).toHaveLength(MAX_SPECIES * MAX_SPECIES);
    expect(gpu.slice(0, 2)).toEqual([0.8, -0.4]);
    expect(gpu.slice(MAX_SPECIES, MAX_SPECIES + 2)).toEqual([-0.4, 0.8]);
    expect(gpu[2]).toBe(0);
  });
});

describe('URL encoding', () => {
  it('round-trips losslessly', () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = randomRules(2 + (seed % 7), seed);
      expect(decodeRules(encodeRules(r))).toEqual(r);
    }
  });

  it('is short: one character per cell', () => {
    expect(encodeRules(randomRules(6, 1))).toHaveLength(1 + 36);
  });

  it('rejects malformed input', () => {
    expect(decodeRules('')).toBeNull();
    expect(decodeRules('9abc')).toBeNull();
    expect(decodeRules('2abc')).toBeNull(); // needs 4 cells
    expect(decodeRules('2abz!')).toBeNull();
  });
});

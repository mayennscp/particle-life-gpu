import { d } from 'typegpu';
import { describe, expect, it } from 'vitest';

import { forceCurve, palette, wrapDelta, wrapPosition } from './physics';

// The same functions are compiled to WGSL for the GPU. Here they run as
// plain JavaScript, which is TypeGPU's "write once, run on both" model.

describe('forceCurve', () => {
  const beta = 0.3;

  it('always repels at very short range, whatever the attraction', () => {
    expect(forceCurve(0, 1, beta)).toBe(-1);
    expect(forceCurve(0.15, 1, beta)).toBeCloseTo(-0.5);
    expect(forceCurve(0.15, -1, beta)).toBeCloseTo(-0.5);
  });

  it('peaks at the attraction value halfway through the interaction band', () => {
    const peak = (1 + beta) / 2;
    expect(forceCurve(peak, 0.8, beta)).toBeCloseTo(0.8);
    expect(forceCurve(peak, -0.6, beta)).toBeCloseTo(-0.6);
  });

  it('is zero at the edges of the band and beyond', () => {
    expect(forceCurve(beta, 1, beta)).toBeCloseTo(0);
    expect(forceCurve(1, 1, beta)).toBe(0);
    expect(forceCurve(1.5, 1, beta)).toBe(0);
  });
});

const square = d.vec2f(1, 1);

describe('wrapDelta', () => {
  it('leaves short vectors alone', () => {
    const v = wrapDelta(d.vec2f(0.3, -0.4), square);
    expect(v.x).toBeCloseTo(0.3);
    expect(v.y).toBeCloseTo(-0.4);
  });

  it('takes the short way around the torus', () => {
    // From x = -0.9 to x = 0.9 is 1.8 to the right, or 0.2 to the left.
    const v = wrapDelta(d.vec2f(1.8, -1.5), square);
    expect(v.x).toBeCloseTo(-0.2);
    expect(v.y).toBeCloseTo(0.5);
  });

  it('respects a non-square (portrait) world', () => {
    const portrait = d.vec2f(1, 2);
    // 1.5 vertically is already the short way in a world 4 units tall.
    const v = wrapDelta(d.vec2f(1.5, 1.5), portrait);
    expect(v.x).toBeCloseTo(-0.5);
    expect(v.y).toBeCloseTo(1.5);
  });
});

describe('wrapPosition', () => {
  it('brings escaped particles back on the opposite edge', () => {
    const p = wrapPosition(d.vec2f(1.1, -1.25), square);
    expect(p.x).toBeCloseTo(-0.9);
    expect(p.y).toBeCloseTo(0.75);
  });

  it('wraps each axis by its own size', () => {
    const p = wrapPosition(d.vec2f(1.1, 2.5), d.vec2f(1, 2));
    expect(p.x).toBeCloseTo(-0.9);
    expect(p.y).toBeCloseTo(-1.5);
  });
});

describe('palette', () => {
  it('produces valid colours that differ between species', () => {
    const a = palette(0);
    const b = palette(0.5);
    for (const c of [a.x, a.y, a.z, b.x, b.y, b.z]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(0.5);
  });
});

import { d, std } from 'typegpu';

/*
 * These functions are written once in TypeScript and run in two places:
 * - on the GPU, where the 'use gpu' directive lets unplugin-typegpu compile
 *   them to WGSL inside the compute and render pipelines,
 * - on the CPU, as plain functions, which is how the unit tests check them.
 */

/**
 * The particle-life force curve.
 *
 * `rn` is the distance divided by the interaction radius (0..1).
 * - Below `beta` every pair repels, whatever the species, so particles
 *   never collapse into a single point.
 * - Between `beta` and 1 the force is a triangle peaking at `attraction`
 *   (the matrix value for this pair of species).
 */
export const forceCurve = (
  rn: number,
  attraction: number,
  beta: number
): number => {
  'use gpu';
  if (rn < beta) {
    return rn / beta - 1;
  }
  if (rn < 1) {
    return attraction * (1 - std.abs(2 * rn - 1 - beta) / (1 - beta));
  }
  return d.f32(0);
};

/**
 * The world is a torus spanning [-bounds, bounds]. Its aspect ratio follows
 * the screen, so particles fill the whole canvas on any device.
 * This function keeps a position inside it.
 */
export const wrapPosition = (p: d.v2f, bounds: d.v2f): d.v2f => {
  'use gpu';
  const size = bounds.mul(2);
  return std.fract(p.add(bounds).div(size)).mul(size).sub(bounds);
};

/**
 * Shortest vector between two points on the torus. Particles leaving one edge
 * come back on the other, and forces act across the seam too. Mapping the
 * offset back into [-bounds, bounds) is the same operation as wrapping a
 * position. It uses `fract` rather than `round`, because TypeGPU's CPU
 * implementation of `round` does not support vectors yet.
 */
export const wrapDelta = (delta: d.v2f, bounds: d.v2f): d.v2f => {
  'use gpu';
  return wrapPosition(delta, bounds);
};

/** Cosine palette: t in [0, 1) maps to an evenly spread, saturated hue. */
export const palette = (t: number): d.v3f => {
  'use gpu';
  return std
    .cos(d.vec3f(0, 0.33, 0.67).add(t).mul(6.28318))
    .mul(0.45)
    .add(0.55);
};

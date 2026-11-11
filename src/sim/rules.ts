/**
 * Interaction rules: an N×N matrix where cell [a][b] says how strongly
 * species `a` is attracted to (positive) or repelled by (negative) species `b`.
 * The matrix is usually NOT symmetric. That asymmetry makes particles chase
 * each other and is where the "life" comes from.
 *
 * Values are quantised to steps of 0.1 so every rule set fits in a short,
 * lossless URL hash.
 */

export const MAX_SPECIES = 8;
export const MIN_SPECIES = 2;

export type Rules = {
  species: number;
  /** Row-major, `species * species` values in [-1, 1]. */
  matrix: number[];
};

export type PresetName = 'random' | 'chains' | 'clusters' | 'orbits';

/** Small, fast, seedable PRNG, so a seed always gives the same universe. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `|| 0` turns -0 into 0, so equal rules always compare equal.
export const quantize = (v: number) =>
  Math.round(Math.max(-1, Math.min(1, v)) * 10) / 10 || 0;

const clampSpecies = (n: number) =>
  Math.max(MIN_SPECIES, Math.min(MAX_SPECIES, Math.round(n)));

export function randomRules(species: number, seed: number): Rules {
  const n = clampSpecies(species);
  const rng = mulberry32(seed);
  return {
    species: n,
    matrix: Array.from({ length: n * n }, () => quantize(rng() * 2 - 1)),
  };
}

export function presetRules(
  name: PresetName,
  species: number,
  seed = 1
): Rules {
  const n = clampSpecies(species);
  if (name === 'random') return randomRules(n, seed);

  const matrix = Array.from({ length: n * n }, (_, k) => {
    const row = Math.floor(k / n);
    const col = k % n;
    const next = (row + 1) % n;
    const prev = (row - 1 + n) % n;
    switch (name) {
      // Tight same-species blobs that chase the next species around a ring.
      case 'chains':
        return row === col ? 0.6 : col === next ? 0.4 : col === prev ? -0.3 : 0;
      // Like attracts like, everything else is pushed away -> cells.
      case 'clusters':
        return row === col ? 0.8 : -0.4;
      // Chase the next species, flee the previous one -> spinning rings.
      case 'orbits':
        return row === col ? 0.4 : col === next ? 0.9 : col === prev ? -0.9 : 0;
    }
  });
  return { species: n, matrix: matrix.map(quantize) };
}

/** Nudges every cell a little, handy for exploring around a nice rule set. */
export function mutateRules(rules: Rules, seed: number, amount = 0.2): Rules {
  const rng = mulberry32(seed);
  return {
    species: rules.species,
    matrix: rules.matrix.map((v) => quantize(v + (rng() * 2 - 1) * amount)),
  };
}

export function setCell(
  rules: Rules,
  row: number,
  col: number,
  value: number
): Rules {
  const matrix = [...rules.matrix];
  matrix[row * rules.species + col] = quantize(value);
  return { species: rules.species, matrix };
}

/** Lays the matrix out in a fixed MAX_SPECIES² grid for the GPU buffer. */
export function toGpuMatrix(rules: Rules): number[] {
  const out = new Array<number>(MAX_SPECIES * MAX_SPECIES).fill(0);
  for (let r = 0; r < rules.species; r++) {
    for (let c = 0; c < rules.species; c++) {
      out[r * MAX_SPECIES + c] = rules.matrix[r * rules.species + c];
    }
  }
  return out;
}

// One character per cell: -1.0 -> 'a', 0.0 -> 'k', +1.0 -> 'u'.
const ALPHABET = 'abcdefghijklmnopqrstu';

export function encodeRules(rules: Rules): string {
  return (
    String(rules.species) +
    rules.matrix.map((v) => ALPHABET[Math.round(v * 10) + 10]).join('')
  );
}

export function decodeRules(code: string): Rules | null {
  const species = Number(code[0]);
  if (
    !Number.isInteger(species) ||
    species < MIN_SPECIES ||
    species > MAX_SPECIES
  ) {
    return null;
  }
  const body = code.slice(1);
  if (body.length !== species * species) return null;
  const matrix: number[] = [];
  for (const ch of body) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    matrix.push((idx - 10) / 10);
  }
  return { species, matrix };
}

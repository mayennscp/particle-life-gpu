import tgpu, { d, std, type TgpuRoot } from 'typegpu';

import { forceCurve, palette, wrapDelta, wrapPosition } from '../sim/physics';
import { mulberry32, MAX_SPECIES, type Rules, toGpuMatrix } from '../sim/rules';

export const MAX_PARTICLES = 16384;

const Particle = d.struct({
  position: d.vec2f,
  velocity: d.vec2f,
  species: d.u32,
});
const ParticleArray = d.arrayOf(Particle, MAX_PARTICLES);

const SimParams = d.struct({
  count: d.u32,
  species: d.u32,
  rMax: d.f32,
  beta: d.f32,
  /** Velocity multiplier per step, derived from the friction half-life. */
  damping: d.f32,
  force: d.f32,
  dt: d.f32,
  /** 0 = idle, 1 = push particles away, -1 = pull them in. */
  pointerMode: d.f32,
  pointer: d.vec2f,
  pointerRadius: d.f32,
  /** Half-size of the toroidal world. The shorter screen side is always 1. */
  bounds: d.vec2f,
});

const View = d.struct({
  /** World to clip space: 1 / bounds. */
  scale: d.vec2f,
  pointSize: d.f32,
});

export type SimSettings = {
  rMax: number;
  beta: number;
  frictionHalfLife: number;
  force: number;
};

export type Pointer = { x: number; y: number; mode: -1 | 0 | 1 };

const DT = 0.01;

export function createSimulation(root: TgpuRoot, canvas: HTMLCanvasElement) {
  const context = root.configureContext({ canvas, alphaMode: 'premultiplied' });
  const format = navigator.gpu.getPreferredCanvasFormat();

  // --- Resources ----------------------------------------------------------

  const params = root.createUniform(SimParams);
  const view = root.createUniform(View);
  const rules = root.createReadonly(
    d.arrayOf(d.f32, MAX_SPECIES * MAX_SPECIES)
  );

  // Ping-pong buffers: each step reads one and writes the other, so every
  // particle sees a consistent snapshot of its neighbours.
  const buffers = [0, 1].map(() =>
    root.createBuffer(ParticleArray).$usage('storage')
  );

  const computeLayout = tgpu.bindGroupLayout({
    current: { storage: ParticleArray },
    next: { storage: ParticleArray, access: 'mutable' },
  });
  const renderLayout = tgpu.bindGroupLayout({
    particles: { storage: ParticleArray },
  });

  const computeGroups = [0, 1].map((i) =>
    root.createBindGroup(computeLayout, {
      current: buffers[i],
      next: buffers[1 - i],
    })
  );
  const renderGroups = buffers.map((particles) =>
    root.createBindGroup(renderLayout, { particles })
  );

  // --- Compute: one thread per particle, O(n²) over all neighbours ---------

  const step = root.createGuardedComputePipeline((i) => {
    'use gpu';
    const self = Particle(computeLayout.$.current[i]);
    let acc = d.vec2f();

    for (let j = d.u32(0); j < params.$.count; j++) {
      if (j === i) {
        continue;
      }
      const other = computeLayout.$.current[j];
      const delta = wrapDelta(
        other.position.sub(self.position),
        params.$.bounds
      );
      const dist = std.length(delta);
      if (dist > 0 && dist < params.$.rMax) {
        const attraction = rules.$[self.species * MAX_SPECIES + other.species];
        const f = forceCurve(dist / params.$.rMax, attraction, params.$.beta);
        acc = acc.add(delta.div(dist).mul(f));
      }
    }

    // Mouse / touch interaction: a soft radial push or pull.
    if (params.$.pointerMode !== 0) {
      const away = wrapDelta(
        self.position.sub(params.$.pointer),
        params.$.bounds
      );
      const dist = std.length(away);
      if (dist > 0 && dist < params.$.pointerRadius) {
        const falloff = 1 - dist / params.$.pointerRadius;
        acc = acc.add(away.div(dist).mul(falloff * params.$.pointerMode * 12));
      }
    }

    self.velocity = self.velocity
      .mul(params.$.damping)
      .add(acc.mul(params.$.rMax * params.$.force * params.$.dt));
    self.position = wrapPosition(
      self.position.add(self.velocity.mul(params.$.dt)),
      params.$.bounds
    );

    computeLayout.$.next[i] = Particle(self);
  });

  // --- Render: one instanced quad per particle, soft glowing disc ----------

  const draw = root.createRenderPipeline({
    vertex: ({ $vertexIndex, $instanceIndex }) => {
      'use gpu';
      const corners = [
        d.vec2f(-1, -1),
        d.vec2f(1, -1),
        d.vec2f(-1, 1),
        d.vec2f(-1, 1),
        d.vec2f(1, -1),
        d.vec2f(1, 1),
      ];
      const corner = corners[$vertexIndex];
      const p = renderLayout.$.particles[$instanceIndex];
      const world = p.position.add(corner.mul(view.$.pointSize));
      return {
        $position: d.vec4f(world.mul(view.$.scale), 0, 1),
        uv: corner,
        color: palette(d.f32(p.species) / d.f32(params.$.species)),
      };
    },
    fragment: ({ uv, color }) => {
      'use gpu';
      const r = std.length(uv);
      const core = 1 - std.smoothstep(0.35, 0.55, r);
      const glow = std.pow(std.max(1 - r, 0), 3) * 0.45;
      // Below 1 so dense clusters keep their colour instead of burning to white.
      const alpha = std.min(core + glow, 1) * 0.8;
      // Premultiplied colour, blended additively below.
      return d.vec4f(color.mul(alpha), alpha);
    },
    targets: {
      format,
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      },
    },
  });

  // --- State on the CPU side ----------------------------------------------

  let current = 0;
  let count = 4096;
  let species = 6;
  let settings: SimSettings = {
    rMax: 0.2,
    beta: 0.3,
    frictionHalfLife: 0.04,
    force: 10,
  };
  let pointer: Pointer = { x: 0, y: 0, mode: 0 };
  let bounds = d.vec2f(1, 1);

  const writeParams = () => {
    params.write({
      count,
      species,
      rMax: settings.rMax,
      beta: settings.beta,
      damping: Math.pow(0.5, DT / settings.frictionHalfLife),
      force: settings.force,
      dt: DT,
      pointerMode: pointer.mode,
      pointer: d.vec2f(pointer.x, pointer.y),
      pointerRadius: 0.25,
      bounds,
    });
  };

  const writeView = () => {
    // Particles shrink as their number grows, so density looks similar.
    const pointSize = Math.min(0.02, Math.max(0.004, 0.55 / Math.sqrt(count)));
    view.write({ scale: d.vec2f(1 / bounds.x, 1 / bounds.y), pointSize });
  };

  /** Respawns particles uniformly, species split evenly. */
  const respawn = (seed = Math.random() * 2 ** 32) => {
    const rng = mulberry32(seed);
    const data = Array.from({ length: MAX_PARTICLES }, (_, i) => ({
      position: d.vec2f((rng() * 2 - 1) * bounds.x, (rng() * 2 - 1) * bounds.y),
      velocity: d.vec2f(0, 0),
      species: i % species,
    }));
    buffers[0].write(data);
    buffers[1].write(data);
    current = 0;
  };

  return {
    respawn,

    setRules(next: Rules) {
      const speciesChanged = next.species !== species;
      species = next.species;
      rules.write(toGpuMatrix(next));
      writeParams();
      if (speciesChanged) respawn();
    },

    setCount(next: number) {
      count = Math.min(MAX_PARTICLES, next);
      writeParams();
      writeView();
    },

    setSettings(next: Partial<SimSettings>) {
      settings = { ...settings, ...next };
      writeParams();
    },

    setPointer(next: Pointer) {
      pointer = next;
      writeParams();
    },

    resize(width: number, height: number) {
      const side = Math.min(width, height);
      bounds = d.vec2f(width / side, height / side);
      writeParams();
      writeView();
    },

    /** Converts a CSS-pixel position on the canvas to world coordinates. */
    toWorld(px: number, py: number, cssWidth: number, cssHeight: number) {
      return {
        x: ((px / cssWidth) * 2 - 1) * bounds.x,
        y: -((py / cssHeight) * 2 - 1) * bounds.y,
      };
    },

    frame(simulate: boolean) {
      if (simulate) {
        step.with(computeGroups[current]).dispatchThreads(count);
        current = 1 - current;
      }
      draw
        .with(renderGroups[current])
        .withColorAttachment({
          view: context,
          clearValue: [0.02, 0.02, 0.035, 1],
          loadOp: 'clear',
          storeOp: 'store',
        })
        .draw(6, count);
    },

    get count() {
      return count;
    },
  };
}

export type Simulation = ReturnType<typeof createSimulation>;

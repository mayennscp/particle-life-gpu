import './style.css';

import tgpu, { common } from 'typegpu';

import { createSimulation, MAX_PARTICLES } from './gpu/simulation';
import { palette } from './sim/physics';
import {
  decodeRules,
  encodeRules,
  mutateRules,
  type PresetName,
  presetRules,
  quantize,
  type Rules,
  setCell,
} from './sim/rules';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('canvas');

function showUnsupported(reason: string) {
  $('unsupported').hidden = false;
  $('unsupported-reason').textContent = reason;
  $('panel').hidden = true;
  $('panel-toggle').hidden = true;
}

async function main() {
  if (!navigator.gpu) {
    showUnsupported('navigator.gpu is undefined.');
    return;
  }

  let root;
  try {
    root = await tgpu.init();
  } catch (err) {
    showUnsupported(String(err));
    return;
  }

  const sim = createSimulation(root, canvas);

  // --- Rules: from the URL hash if present, otherwise a nice preset ---------

  const randomSeed = () => Math.floor(Math.random() * 2 ** 32);
  let rules: Rules =
    decodeRules(location.hash.slice(1)) ?? presetRules('orbits', 6);

  const applyRules = (next: Rules, { updateHash = true } = {}) => {
    rules = next;
    sim.setRules(rules);
    renderMatrix();
    speciesInput.value = String(rules.species);
    $('species-value').textContent = String(rules.species);
    if (updateHash) history.replaceState(null, '', `#${encodeRules(rules)}`);
  };

  // --- Matrix editor ------------------------------------------------------

  const matrixEl = $('matrix');

  const cssColor = (i: number, n: number) => {
    const c = palette(i / n);
    const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    return `rgb(${to255(c.x)} ${to255(c.y)} ${to255(c.z)})`;
  };

  const cellBackground = (v: number) => {
    const channel = v >= 0 ? '--positive' : '--negative';
    return `rgba(var(${channel}), ${0.12 + Math.abs(v) * 0.88})`;
  };

  function renderMatrix() {
    const n = rules.species;
    matrixEl.style.gridTemplateColumns = `repeat(${n + 1}, 1fr)`;
    matrixEl.replaceChildren();
    matrixEl.append(document.createElement('span'));
    for (let c = 0; c < n; c++) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.setProperty('--c', cssColor(c, n));
      matrixEl.append(sw);
    }
    for (let r = 0; r < n; r++) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.setProperty('--c', cssColor(r, n));
      matrixEl.append(sw);
      for (let c = 0; c < n; c++) {
        const v = rules.matrix[r * n + c];
        const cell = document.createElement('button');
        cell.className = 'cell';
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.style.background = cellBackground(v);
        cell.title = `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
        cell.setAttribute(
          'aria-label',
          `Species ${r + 1} towards species ${c + 1}: ${v.toFixed(1)}`
        );
        matrixEl.append(cell);
      }
    }
  }

  const nudgeCell = (
    target: EventTarget | null,
    delta: number,
    wrap: boolean
  ) => {
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>('.cell');
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const current = rules.matrix[row * rules.species + col];
    let next = quantize(current + delta);
    // Clicking past the end cycles around, so a single button is enough on touch.
    if (wrap && next === current) next = delta > 0 ? -1 : 1;
    applyRules(setCell(rules, row, col, next));
  };

  matrixEl.addEventListener('click', (e) =>
    nudgeCell(e.target, e.shiftKey ? -0.2 : 0.2, true)
  );
  matrixEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    nudgeCell(e.target, -0.2, true);
  });
  matrixEl.addEventListener(
    'wheel',
    (e) => {
      if (!(e.target as HTMLElement).closest('.cell')) return;
      e.preventDefault();
      nudgeCell(e.target, e.deltaY < 0 ? 0.1 : -0.1, false);
    },
    { passive: false }
  );

  // --- Controls -----------------------------------------------------------

  const speciesInput = $<HTMLInputElement>('species');
  let lastPreset: PresetName = 'orbits';

  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) =>
    btn.addEventListener('click', () => {
      lastPreset = btn.dataset.preset as PresetName;
      applyRules(presetRules(lastPreset, rules.species, randomSeed()));
      sim.respawn();
    })
  );

  speciesInput.addEventListener('input', () => {
    const n = Number(speciesInput.value);
    applyRules(presetRules(lastPreset, n, randomSeed()));
  });

  $('mutate').addEventListener('click', () =>
    applyRules(mutateRules(rules, randomSeed()))
  );

  const toast = $('toast');
  let toastTimer = 0;
  const showToast = (text: string) => {
    toast.textContent = text;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(
      () => toast.classList.remove('visible'),
      1800
    );
  };

  $('share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showToast('Link to these rules copied');
    } catch {
      showToast('Copy the address bar to share these rules');
    }
  });

  const bindSlider = (
    id: string,
    format: (v: number) => string,
    onChange: (v: number) => void
  ) => {
    const input = $<HTMLInputElement>(id);
    const output = $(`${id}-value`);
    const update = () => {
      const v = Number(input.value);
      output.textContent = format(v);
      onChange(v);
    };
    input.addEventListener('input', update);
    update();
  };

  bindSlider(
    'count',
    (v) => String(2 ** v),
    (v) => {
      const n = Math.min(MAX_PARTICLES, 2 ** v);
      sim.setCount(n);
      $('count-label').textContent = `${n} particles`;
    }
  );
  bindSlider(
    'radius',
    (v) => v.toFixed(2),
    (rMax) => sim.setSettings({ rMax })
  );
  bindSlider(
    'force',
    (v) => String(v),
    (force) => sim.setSettings({ force })
  );
  bindSlider(
    'friction',
    (v) => v.toFixed(3),
    (frictionHalfLife) => sim.setSettings({ frictionHalfLife })
  );

  let paused = false;
  const pauseBtn = $('pause');
  const togglePause = () => {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  };
  pauseBtn.addEventListener('click', togglePause);
  $('respawn').addEventListener('click', () => sim.respawn());

  const panel = $('panel');
  const toggle = $('panel-toggle');
  const setCollapsed = (collapsed: boolean) => {
    panel.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  toggle.addEventListener('click', () =>
    setCollapsed(!panel.classList.contains('collapsed'))
  );
  // On phones the simulation gets the whole screen first.
  if (window.matchMedia('(max-width: 720px)').matches) setCollapsed(true);

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'r' || e.key === 'R') {
      applyRules(presetRules('random', rules.species, randomSeed()));
      sim.respawn();
    }
  });

  window.addEventListener('hashchange', () => {
    const decoded = decodeRules(location.hash.slice(1));
    if (decoded) applyRules(decoded, { updateHash: false });
  });

  // --- Pointer interaction ------------------------------------------------

  const updatePointer = (e: PointerEvent, mode: -1 | 0 | 1) => {
    const rect = canvas.getBoundingClientRect();
    const { x, y } = sim.toWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height
    );
    sim.setPointer({ x, y, mode });
  };

  let pointerMode: -1 | 0 | 1 = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointerMode = e.button === 2 || e.shiftKey ? -1 : 1;
    updatePointer(e, pointerMode);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointerMode !== 0) updatePointer(e, pointerMode);
  });
  const release = (e: PointerEvent) => {
    pointerMode = 0;
    updatePointer(e, 0);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // --- Start --------------------------------------------------------------

  common.attachAutoResizer({
    root,
    canvas,
    onResize() {
      sim.resize(canvas.width, canvas.height);
    },
  });
  // Size the canvas right away; the auto-resizer only reacts to later changes.
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
  canvas.height = Math.max(
    1,
    Math.round(canvas.clientHeight * devicePixelRatio)
  );
  sim.resize(canvas.width, canvas.height);

  applyRules(rules, { updateHash: location.hash.length > 1 });
  sim.respawn();

  const fpsEl = $('fps');
  let frames = 0;
  let lastFpsUpdate = performance.now();

  const loop = (now: number) => {
    sim.frame(!paused);
    frames++;
    if (now - lastFpsUpdate > 500) {
      fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFpsUpdate))} fps`;
      frames = 0;
      lastFpsUpdate = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main();

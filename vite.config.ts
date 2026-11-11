import typegpu from 'unplugin-typegpu/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths, so the build also works from a GitHub Pages sub-path.
  base: './',
  plugins: [typegpu()],
  build: { target: 'es2022' },
  test: { environment: 'node' },
});

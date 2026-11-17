import { configDefaults, defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base './' so the built site works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  // .claude/ holds Claude Code's scratch copies of the repo: not our tests
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});

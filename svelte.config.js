import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Forms deliberately copy their starting values from props (they are re-created per edit).
    warningFilter: (w) => w.code !== 'state_referenced_locally',
  },
};

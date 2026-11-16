import { mount } from 'svelte';
import './styles.css';
import { loadSiteConfig } from './lib/store';

// Read public/config.json first so the app knows which Google Sheet to use.
loadSiteConfig()
  .then(() => import('./App.svelte'))
  .then(({ default: App }) => mount(App, { target: document.getElementById('app')! }));

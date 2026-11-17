import { mount } from 'svelte';
import './styles.css';
import { applyPrefs, getPrefs } from './lib/prefs';
import { loadSiteConfig } from './lib/store';

// theme and text size first, so the page doesn't flash in the wrong colours
applyPrefs(getPrefs());

// Read public/config.json first so the app knows which Google Sheet to use.
loadSiteConfig()
  .then(() => import('./App.svelte'))
  .then(({ default: App }) => mount(App, { target: document.getElementById('app')! }));

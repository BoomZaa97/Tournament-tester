/**
 * GitHub Pages lets browsers keep index.html for up to 10 minutes, and phones keep open tabs for days,
 * so people can be on an old version of the site. Every few minutes (and when the tab comes back into view)
 * fetch index.html fresh and compare its script name with the one this page loaded.
 */
export const update = $state({ ready: false });

const SCRIPT = /assets\/index-[\w-]+\.js/;

function loadedScript(): string | null {
  for (const s of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) {
    const m = s.src.match(SCRIPT);
    if (m) return m[0];
  }
  return null;
}

export function watchForUpdates(every = 5 * 60_000) {
  const mine = loadedScript();
  if (!mine) return; // dev server: nothing to compare
  let last = 0;
  async function check() {
    if (update.ready || Date.now() - last < 30_000) return;
    last = Date.now();
    try {
      const res = await fetch('./index.html?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const latest = (await res.text()).match(SCRIPT)?.[0];
      if (latest && latest !== mine) update.ready = true;
    } catch {
      // offline: try again later
    }
  }
  setTimeout(check, 3000);
  setInterval(check, every);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

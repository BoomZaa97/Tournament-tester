<script lang="ts">
  import Verified from '../components/Verified.svelte';
  import { app } from '../lib/app.svelte';
  import { getPrefs, savePrefs } from '../lib/prefs';
  import type { Prefs, TextSize, Theme } from '../lib/prefs';
  import { forgetOrgKey, orgKeyIds, pinnedTournaments } from '../lib/store';
  import type { AllData } from '../lib/store';

  let prefs = $state<Prefs>(getPrefs());
  function set<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    prefs = { ...prefs, [k]: v };
    savePrefs(prefs);
  }
  const themes: [Theme, string][] = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
  const sizes: [TextSize, string][] = [['normal', 'Normal'], ['large', 'Large']];

  // ---- what this device may do, and where
  let data = $state<AllData | null>(app.store.peekAll());
  app.store.loadAll().then((d) => (data = d), () => {});
  let keysTick = $state(0);
  const organizing = $derived.by(() => {
    void keysTick;
    void app.accountSync; // logging in brings keys
    return orgKeyIds().map((id) => ({ id, t: data?.tournaments.find((t) => t.id === id) }));
  });
  const playing = $derived.by(() => {
    void app.accountSync;
    return pinnedTournaments().map(({ id, playerId }) => ({
      id,
      playerId,
      t: data?.tournaments.find((t) => t.id === id),
      name: data?.players.find((p) => p.id === playerId)?.name,
    }));
  });
  const shared = app.store.kind === 'sheets';
  const role = $derived(
    app.store.isAdmin ? (shared ? 'Site admin' : 'Everything (this browser only)') : organizing.length ? 'Organizer' : playing.length || app.account ? 'Player' : 'Viewer',
  );

  function forget(id: string, name: string) {
    if (!confirm(`Stop editing “${name}” on this device? You'll need a helper link (or the account that made it) to edit it here again.`)) return;
    forgetOrgKey(id);
    keysTick++;
  }
</script>

<div class="wrap page">
  <h1>Settings</h1>
  <p class="muted lead">For this device only.</p>

  <section>
    <h2>Appearance</h2>
    <div class="opt">
      <span class="name">Theme</span>
      <div class="seg" role="radiogroup" aria-label="Theme">
        {#each themes as [v, label] (v)}
          <button role="radio" aria-checked={prefs.theme === v} class:on={prefs.theme === v} onclick={() => set('theme', v)}>{label}</button>
        {/each}
      </div>
      <span class="small muted hint">Auto follows your phone or computer.</span>
    </div>
    <div class="opt">
      <span class="name">Text size</span>
      <div class="seg" role="radiogroup" aria-label="Text size">
        {#each sizes as [v, label] (v)}
          <button role="radio" aria-checked={prefs.size === v} class:on={prefs.size === v} onclick={() => set('size', v)}>{label}</button>
        {/each}
      </div>
      <span class="small muted hint">Large makes everything a bit bigger, handy on a phone at the venue.</span>
    </div>
  </section>

  <hr class="rule" />

  <section>
    <h2>Your access</h2>
    <div class="role">
      <span class="label">On this device you are</span>
      <b class="rname">{role}</b>
    </div>

    {#if shared}
      <div class="item">
        {#if app.account}
          <span>Logged in as <a href="#/p/{app.account.playerId}"><b>{app.account.name}</b></a><Verified id={app.account.playerId} /></span>
          <a class="small" href="#/account">Account</a>
        {:else}
          <span class="muted">Not logged in. An account keeps your PINs and tournaments on all your devices and locks your name to you.</span>
          <a class="small" href="#/account/settings">Log in</a>
        {/if}
      </div>
    {/if}

    {#if app.store.isAdmin && shared}
      <p class="small">Site admin: you can edit every tournament. <a href="#/admin">Admin settings</a></p>
    {/if}

    {#if organizing.length}
      <h3>You organize</h3>
      <ul class="list">
        {#each organizing as o (o.id)}
          <li>
            <a href="#/t/{o.id}">{o.t?.name ?? 'Tournament ' + o.id}</a>
            {#if o.t?.game}<span class="small muted">{o.t.game}</span>{/if}
            <span class="spacer"></span>
            <button class="small ghost" onclick={() => forget(o.id, o.t?.name ?? o.id)}>Stop editing here</button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if playing.length}
      <h3>You play in</h3>
      <ul class="list">
        {#each playing as p (p.id)}
          <li>
            <a href="#/t/{p.id}">{p.t?.name ?? 'Tournament ' + p.id}</a>
            {#if p.name}<span class="small muted">as {p.name}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if !app.store.isAdmin && !organizing.length && !playing.length}
      <p class="small muted">You can see every tournament. Create one to organize it, or join one to report your own scores.</p>
    {/if}
  </section>

  {#if !app.store.isAdmin || !shared}
    <hr class="rule" />
    <p class="small muted owner">
      {shared ? 'Site owner?' : 'Data source, backups and roles:'} <a href="#/admin">Admin settings</a>
    </p>
  {/if}
</div>

<style>
  .page { padding-top: 28px; max-width: 720px; }
  h1 { margin-bottom: 4px; }
  .lead { margin: 0 0 24px; }
  section { display: grid; gap: 14px; }
  h3 { margin: 8px 0 0; }
  .opt { display: grid; grid-template-columns: 110px minmax(0, 360px); align-items: center; gap: 6px 16px; }
  .opt .name { font-weight: 600; }
  .opt .hint { grid-column: 2; }
  .seg { display: flex; border: 1px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; }
  .seg button {
    flex: 1 1 0; min-width: 0; min-height: 38px; border: 0; border-radius: 0; background: transparent; padding: 0 8px;
    font: 600 15px var(--font-cond); letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted);
  }
  .seg button + button { border-left: 1px solid var(--line-strong); }
  .seg button.on { background: var(--ink); color: var(--paper); }
  .role { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .rname { font: 700 26px/1 var(--font-cond); color: var(--accent); }
  .item { display: flex; align-items: baseline; gap: 12px; justify-content: space-between; flex-wrap: wrap; padding: 10px 12px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); }
  .list { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--line); }
  .list li { display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap; padding: 8px 2px; border-bottom: 1px solid var(--line); min-height: 44px; }
  .list a { font-weight: 600; text-decoration: none; }
  .list a:hover { text-decoration: underline; }
  .spacer { flex: 1; }
  .owner { margin: 0; }
  @media (max-width: 520px) {
    .opt { grid-template-columns: minmax(0, 1fr); }
    .opt .hint { grid-column: 1; }
  }
</style>

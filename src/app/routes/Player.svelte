<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { buildHistory, winRate } from '../lib/history';
  import type { PlayerStats } from '../lib/history';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  let stats = $state<PlayerStats | null>(null);
  let names = $state(new Map<string, string>());
  let error = $state('');
  let renaming = $state(false);
  let newName = $state('');

  async function load() {
    try {
      const d = await app.store.loadAll();
      const all = buildHistory(d.tournaments, d.players);
      names = new Map([...all.values()].map((s) => [s.player.id, s.player.name]));
      stats = all.get(id) ?? null;
      if (!stats) error = 'Player not found.';
    } catch (e) {
      error = errorText(e);
    }
  }
  load();

  const h2h = $derived.by(() => {
    if (!stats) return [];
    const m = new Map<string, { opp: string; w: number; l: number; d: number }>();
    for (const x of stats.matches) {
      const r = m.get(x.opponent) ?? { opp: x.opponent, w: 0, l: 0, d: 0 };
      if (x.outcome === 'W') r.w++;
      else if (x.outcome === 'L') r.l++;
      else r.d++;
      m.set(x.opponent, r);
    }
    return [...m.values()].sort((a, b) => b.w + b.l + b.d - (a.w + a.l + a.d));
  });

  let reset = $state<{ username: string; password: string } | null>(null);
  async function resetPassword() {
    if (!stats || !confirm(`Give ${stats.player.name}'s account a new password? Their old one stops working.`)) return;
    try {
      reset = await app.store.resetPassword!(id);
    } catch (err) {
      app.notify(errorText(err), 'error');
    }
  }

  const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');

  async function rename(e: SubmitEvent) {
    e.preventDefault();
    const nm = newName.trim();
    if (!nm || !stats) return;
    try {
      await app.store.renamePlayer(id, nm);
      renaming = false;
      app.notify('Renamed everywhere');
      await load();
    } catch (err) {
      app.notify(errorText(err), 'error');
    }
  }
</script>

<div class="wrap page">
  <a class="back small" href="#/players">← Players</a>
  {#if error}
    <p class="notice">{error}</p>
  {:else if !stats}
    <p class="muted">Loading…</p>
  {:else}
    <div class="titlebar">
      {#if renaming}
        <form class="row" onsubmit={rename}>
          <input bind:value={newName} aria-label="New name" />
          <button class="primary" type="submit">Save</button>
          <button type="button" class="ghost" onclick={() => (renaming = false)}>Cancel</button>
        </form>
      {:else}
        <h1>{stats.player.name}</h1>
        {#if app.store.isAdmin}
          <button class="small ghost" onclick={() => { newName = stats!.player.name; renaming = true; }}>Rename</button>
          {#if stats.player.account && app.store.resetPassword}
            <button class="small ghost" onclick={resetPassword}>Reset password</button>
          {/if}
        {/if}
      {/if}
    </div>
    {#if stats.player.account}<p class="small muted acct">Has an account</p>{/if}
    {#if reset}
      <p class="notice">
        New password for <b>{reset.username}</b>: <b class="pw">{reset.password}</b>. Give it to them; they can change it on their
        Account page. Their other devices are logged out.
      </p>
    {/if}

    <dl class="stats">
      <div><dt class="label">Titles</dt><dd>{stats.titles}</dd></div>
      <div><dt class="label">Record</dt><dd>{stats.wins}–{stats.losses}{stats.draws ? `–${stats.draws}` : ''}</dd></div>
      <div><dt class="label">Win rate</dt><dd>{winRate(stats)}</dd></div>
      <div><dt class="label">Events</dt><dd>{stats.tournaments.length}</dd></div>
    </dl>

    <div class="cols">
      <section>
        <h2>Tournaments</h2>
        <ul class="plain">
          {#each stats.tournaments as t (t.id)}
            <li>
              <span class="place" class:gold={t.place === 1 && t.finished}>{t.place ? ordinal(t.place) : '–'}</span>
              <span><a href="#/t/{t.id}">{t.name}</a>{#if t.game}<span class="muted small">&nbsp;· {t.game}</span>{/if}
                {#if !t.finished}<span class="muted small">&nbsp;· in progress</span>{/if}</span>
            </li>
          {/each}
        </ul>

        <h2 class="mt">Head-to-head</h2>
        {#if h2h.length}
          <table>
            <thead><tr><th>Opponent</th><th class="num">W</th><th class="num">L</th>{#if h2h.some((r) => r.d)}<th class="num">D</th>{/if}</tr></thead>
            <tbody>
              {#each h2h as r (r.opp)}
                <tr>
                  <td><a href="#/p/{r.opp}">{names.get(r.opp) ?? '?'}</a></td>
                  <td class="num" class:lead={r.w > r.l}>{r.w}</td>
                  <td class="num">{r.l}</td>
                  {#if h2h.some((x) => x.d)}<td class="num">{r.d}</td>{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="muted">No matches played yet.</p>
        {/if}
      </section>

      <section>
        <h2>Match history</h2>
        {#if stats.matches.length}
          <ul class="plain matches">
            {#each stats.matches as m, i (i)}
              <li>
                <span class="res r-{m.outcome}">{m.outcome}</span>
                <span class="mbody">
                  <span>vs <a href="#/p/{m.opponent}">{names.get(m.opponent) ?? '?'}</a> <b class="sc">{m.score}</b></span>
                  <span class="small muted"><a href="#/t/{m.tournamentId}">{m.tournamentName}</a> · {m.round}</span>
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">No matches played yet.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .page { padding-top: 20px; }
  .back { display: inline-block; margin-bottom: 8px; color: var(--muted); text-decoration: none; }
  .titlebar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .acct { margin: 2px 0 0; }
  .pw { font: 700 18px var(--font-cond); letter-spacing: 0.08em; color: var(--accent); }
  .titlebar input { max-width: 260px; }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 20px 0 28px; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--line); }
  .stats div { padding: 12px 4px; }
  .stats div + div { border-left: 1px solid var(--line); padding-left: 14px; }
  dd { margin: 2px 0 0; font: 700 30px/1 var(--font-cond); }
  .cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 36px; }
  h2 { padding-bottom: 6px; border-bottom: 2px solid var(--ink); }
  .mt { margin-top: 28px; }
  .plain { list-style: none; padding: 0; margin: 0; }
  .plain li { display: flex; gap: 12px; align-items: baseline; padding: 9px 2px; border-bottom: 1px solid var(--line); }
  .plain a { text-decoration: none; font-weight: 600; }
  .plain a:hover { text-decoration: underline; }
  .place { font: 700 18px var(--font-cond); width: 40px; flex: 0 0 40px; color: var(--muted); }
  .place.gold { color: var(--accent); }
  .matches li { align-items: center; }
  .res { width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center; font: 700 15px var(--font-cond); border-radius: var(--radius); border: 1px solid var(--line-strong); }
  .r-W { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .r-L { color: var(--muted); }
  .mbody { display: grid; }
  .sc { font-family: var(--font-cond); font-size: 17px; margin-left: 4px; }
  .lead { font-weight: 700; }
  td a { text-decoration: none; }
  @media (max-width: 760px) {
    .cols { grid-template-columns: minmax(0, 1fr); }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .stats div:nth-child(3) { border-left: 0; padding-left: 4px; }
  }
</style>

<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { buildHistory, winRate } from '../lib/history';
  import type { PlayerStats } from '../lib/history';

  let stats = $state<PlayerStats[] | null>(null);
  let error = $state('');
  let q = $state('');
  let game = $state('');
  let games = $state<string[]>([]);
  let sort = $state<'name' | 'wins' | 'rate' | 'titles'>('wins');

  app.store
    .loadAll()
    .then((d) => {
      games = [...new Set(d.tournaments.map((t) => t.game).filter(Boolean))].sort();
      load(d);
    })
    .catch((e) => {
      if (!stats) error = errorText(e); // else keep showing the copy from last time
    });

  let data: Awaited<ReturnType<typeof app.store.loadAll>> | null = null;
  function load(d = data) {
    if (!d) return;
    data = d;
    const ts = game ? d.tournaments.filter((t) => t.game === game) : d.tournaments;
    stats = [...buildHistory(ts, d.players).values()];
  }
  // what this device saw last time, until the sheet answers
  const seen = app.store.peekAll();
  if (seen && !stats) {
    games = [...new Set(seen.tournaments.map((t) => t.game).filter(Boolean))].sort();
    load(seen);
  }

  const rows = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const list = (stats ?? []).filter((s) => !needle || s.player.name.toLowerCase().includes(needle));
    const rate = (s: PlayerStats) => (s.wins + s.losses + s.draws ? (s.wins + s.draws / 2) / (s.wins + s.losses + s.draws) : -1);
    const by = {
      name: (a: PlayerStats, b: PlayerStats) => a.player.name.localeCompare(b.player.name),
      wins: (a: PlayerStats, b: PlayerStats) => b.wins - a.wins || a.losses - b.losses,
      rate: (a: PlayerStats, b: PlayerStats) => rate(b) - rate(a) || b.wins - a.wins,
      titles: (a: PlayerStats, b: PlayerStats) => b.titles - a.titles || b.wins - a.wins,
    }[sort];
    return list.sort(by);
  });
</script>

<div class="wrap page">
  <h1>Players</h1>
  <p class="muted">Records across every tournament.</p>

  <div class="row controls">
    <input type="search" placeholder="Search players" bind:value={q} aria-label="Search players" />
    {#if games.length}
      <select bind:value={game} onchange={() => load()} aria-label="Filter by game">
        <option value="">All games</option>
        {#each games as g}<option value={g}>{g}</option>{/each}
      </select>
    {/if}
  </div>

  {#if error}
    <p class="notice">Couldn't load: {error}</p>
  {:else if stats === null}
    <p class="muted">Loading…</p>
  {:else if rows.length === 0}
    <div class="empty">No players yet. They appear here once they're in a tournament.</div>
  {:else}
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            {#each [['name', 'Player'], ['titles', 'Titles'], ['wins', 'W–L'], ['rate', 'Win %']] as [k, label]}
              <th class:num={k !== 'name'}>
                <button class="sort" class:on={sort === k} onclick={() => (sort = k as typeof sort)}>{label}</button>
              </th>
            {/each}
            <th class="num hide-s">Events</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as s (s.player.id)}
            <tr>
              <td><a class="pname" href="#/p/{s.player.id}">{s.player.name}</a></td>
              <td class="num">{s.titles || ''}</td>
              <td class="num">{s.wins}–{s.losses}{s.draws ? `–${s.draws}` : ''}</td>
              <td class="num">{winRate(s)}</td>
              <td class="num hide-s">{s.tournaments.length}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .page { padding-top: 28px; }
  h1 { margin-bottom: 4px; }
  .controls { margin: 16px 0; flex-wrap: nowrap; }
  .controls input { flex: 1; min-width: 0; max-width: 320px; }
  .controls select { width: auto; max-width: 45%; }
  .tablewrap { overflow-x: auto; }
  .pname { font-weight: 600; text-decoration: none; }
  .pname:hover { text-decoration: underline; }
  .sort { all: unset; cursor: pointer; }
  .sort.on { color: var(--ink); text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 2px; text-underline-offset: 4px; }
  @media (max-width: 520px) { .hide-s { display: none; } }
</style>

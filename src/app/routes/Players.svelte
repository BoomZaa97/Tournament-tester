<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { filterTournaments, PROVISIONAL, ranked, rankings } from '../lib/ranking';
  import type { RankBy } from '../lib/ranking';
  import type { AllData } from '../lib/store';

  let data = $state<AllData | null>(null);
  let error = $state('');
  let q = $state('');
  let game = $state('');
  let category = $state('');
  let year = $state(0);
  let by = $state<RankBy>('rating');

  let picked = false;
  function show(d: AllData) {
    data = d;
    if (picked) return;
    picked = true;
    // start on the game with the most tournaments: a rating across different games means little
    const count = new Map<string, number>();
    for (const t of d.tournaments) if (t.game) count.set(t.game, (count.get(t.game) ?? 0) + 1);
    game = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }
  // what this device saw last time, until the sheet answers
  const seen = app.store.peekAll();
  if (seen) show(seen);
  app.store
    .loadAll()
    .then(show)
    .catch((e) => {
      if (!data) error = errorText(e); // else keep showing the copy from last time
    });

  const all = $derived(data?.tournaments ?? []);
  const games = $derived([...new Set(all.map((t) => t.game).filter(Boolean))].sort());
  const categories = $derived(
    [...new Set(all.filter((t) => !game || t.game === game).map((t) => t.category ?? '').filter(Boolean))].sort(),
  );
  const years = $derived([...new Set(all.map((t) => new Date(t.createdAt).getFullYear()))].sort((a, b) => b - a));
  $effect(() => {
    if (category && !categories.includes(category)) category = '';
  });

  const list = $derived.by(() => {
    if (!data) return [];
    const ts = filterTournaments(data.tournaments, { game, category, year: year || undefined });
    return ranked(rankings(ts, data.players).values(), by);
  });
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((r) => r.player.name.toLowerCase().includes(needle)) : list;
  });
  const firstUnranked = $derived(shown.findIndex((r) => r.rank === null));
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
</script>

<div class="wrap page">
  <h1>Rankings</h1>
  <p class="muted intro">
    From every result on this site. Pick a game{categories.length ? ' and category' : ''} to see who's on top.
  </p>

  <div class="controls">
    {#if games.length}
      <label class="field">
        <span>Game</span>
        <select bind:value={game}>
          <option value="">All games</option>
          {#each games as g}<option value={g}>{g}</option>{/each}
        </select>
      </label>
    {/if}
    {#if categories.length}
      <label class="field">
        <span>Category</span>
        <select bind:value={category}>
          <option value="">All categories</option>
          {#each categories as c}<option value={c}>{c}</option>{/each}
        </select>
      </label>
    {/if}
    {#if years.length > 1}
      <label class="field">
        <span>Period</span>
        <select bind:value={year}>
          <option value={0}>All time</option>
          {#each years as y}<option value={y}>{y}</option>{/each}
        </select>
      </label>
    {/if}
    <label class="field grow">
      <span>Find</span>
      <input type="search" placeholder="Player name" bind:value={q} />
    </label>
  </div>

  <div class="by" role="tablist" aria-label="Rank by">
    <button class:on={by === 'rating'} role="tab" aria-selected={by === 'rating'} onclick={() => (by = 'rating')}>Rating</button>
    <button class:on={by === 'points'} role="tab" aria-selected={by === 'points'} onclick={() => (by = 'points')}>Points</button>
  </div>

  {#if error}
    <p class="notice">Couldn't load: {error}</p>
  {:else if !data}
    <p class="muted">Loading…</p>
  {:else if shown.length === 0}
    <div class="empty">{q.trim() ? `Nobody called “${q.trim()}” here.` : 'No players here yet. They appear once they play in a tournament.'}</div>
  {:else}
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th class="num">#</th>
            <th>Player</th>
            <th class="num" class:sorted={by === 'rating'}>Rating</th>
            <th class="num" class:sorted={by === 'points'}>Points</th>
            <th class="num hide-s">W–L</th>
            <th class="num hide-s">Events</th>
            <th class="num hide-xs" title="1st / 2nd / 3rd places">Medals</th>
          </tr>
        </thead>
        <tbody>
          {#each shown as r, i (r.player.id)}
            {#if i === firstUnranked}
              <tr class="divider">
                <td colspan="7">
                  {by === 'rating'
                    ? `Not ranked yet: fewer than ${PROVISIONAL} rated matches`
                    : 'No points yet: points come from finished tournaments'}
                </td>
              </tr>
            {/if}
            <tr class:top={r.rank === 1}>
              <td class="num rank">{r.rank ?? '–'}</td>
              <td class="name"><a href="#/p/{r.player.id}">{r.player.name}</a></td>
              <td class="num" class:sorted={by === 'rating'}>
                <span class="val" class:prov={r.rated < PROVISIONAL}>{Math.round(r.rating)}</span>
                {#if Math.round(r.change)}
                  <span class="chg" class:up={r.change > 0}>{sign(Math.round(r.change))}</span>
                {/if}
              </td>
              <td class="num" class:sorted={by === 'points'}><span class="val">{r.points}</span></td>
              <td class="num hide-s">{r.wins}–{r.losses}{r.draws ? `–${r.draws}` : ''}</td>
              <td class="num hide-s">{r.events}</td>
              <td class="num hide-xs medals">
                {#if r.medals.some(Boolean)}{r.medals.join(' / ')}{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="small muted note">
      <b>Rating</b>: everyone starts at 1500. Each match moves it up or down; beating a higher-rated player gains more.
      Forfeits don't count. The small number is the change in the player's latest tournament.
      <b>Points</b>: 100 for 1st, 70 for 2nd, 50 for 3rd, 40 for 4th, 25 for top 8, 15 for top 16, 10 for taking part.
    </p>
  {/if}
</div>

<style>
  .page { padding-top: 28px; }
  h1 { margin-bottom: 4px; }
  .intro { margin-bottom: 16px; }
  .controls { display: flex; gap: 10px 12px; flex-wrap: wrap; align-items: end; margin-bottom: 16px; }
  .controls .field { flex: 0 1 200px; min-width: 0; }
  .controls .field > span { font-size: 13px; }
  .controls .grow { flex: 1 1 200px; max-width: 320px; }
  .by { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--radius); margin-bottom: 14px; }
  .by button { border: 0; border-radius: 0; min-height: 36px; background: transparent; font: 600 15px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; padding: 0 16px; color: var(--muted); }
  .by button + button { border-left: 1px solid var(--line-strong); }
  .by button.on { background: var(--ink); color: var(--paper); }
  .tablewrap { overflow-x: auto; }
  .rank { font: 700 18px var(--font-cond); color: var(--muted); width: 40px; }
  .top .rank { color: var(--accent); }
  .name a { font-weight: 600; text-decoration: none; }
  .name a:hover { text-decoration: underline; }
  th.sorted { color: var(--ink); }
  td.sorted .val { font: 700 18px var(--font-cond); }
  .val.prov { color: var(--muted); }
  .chg { display: inline-block; min-width: 30px; font-size: 12px; color: var(--muted); margin-left: 4px; text-align: left; }
  .chg.up { color: var(--ok); }
  .medals { white-space: nowrap; color: var(--ink-2); }
  .divider td { padding-top: 18px; font: 600 13px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); border-bottom: 2px solid var(--line-strong); }
  .note { margin-top: 12px; max-width: 640px; }
  @media (max-width: 640px) { .hide-s { display: none; } }
  @media (max-width: 420px) {
    .hide-xs { display: none; }
    td, th { padding: 8px 6px; }
    .chg { min-width: 0; }
    .controls .field { flex: 1 1 140px; }
  }
</style>

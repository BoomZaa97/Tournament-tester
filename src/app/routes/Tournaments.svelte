<script lang="ts">
  import { gameOf } from '../lib/games';
  import { app, errorText } from '../lib/app.svelte';
  import TournamentRows from '../components/TournamentRows.svelte';
  import { categoryOf, divisionOf, FORMAT_LABEL, OPEN, summaryOf, TIER_LABEL, tierOf } from '../lib/model';
  import type { Status, Tier, TournamentDoc } from '../lib/model';
  import type { Format } from '../../core';

  // ---- data: what this device saw last time first, then the sheet
  const seen = app.store.peekAll();
  let tournaments = $state<TournamentDoc[] | null>(seen?.tournaments ?? null);
  let error = $state('');
  app.store
    .loadAll()
    .then((d) => {
      tournaments = d.tournaments;
      app.noteVerified(d.players);
      error = '';
    })
    .catch((e) => (error = errorText(e)));

  // ---- filters (kept for this tab, so coming back from a tournament keeps them)
  type Sort = 'recent' | 'newest' | 'oldest' | 'players' | 'name';
  interface Filters {
    q: string;
    status: Status | 'all';
    game: string;
    category: string;
    division: string;
    tier: Tier | '';
    format: Format | '';
    official: boolean;
    signup: boolean;
    sort: Sort;
  }
  const BLANK: Filters = { q: '', status: 'all', game: '', category: '', division: '', tier: '', format: '', official: false, signup: false, sort: 'recent' };
  const KEY = 'tt.tfilter.v1';
  function restore(): Filters {
    try {
      return { ...BLANK, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') };
    } catch {
      return { ...BLANK };
    }
  }
  let f = $state<Filters>(restore());
  $effect(() => {
    const json = JSON.stringify(f);
    try {
      sessionStorage.setItem(KEY, json);
    } catch {
      /* private mode */
    }
  });
  const active = $derived(
    (Object.keys(BLANK) as (keyof Filters)[]).filter((k) => k !== 'sort' && k !== 'status' && f[k] !== BLANK[k]).length + (f.status !== 'all' ? 1 : 0),
  );
  function clear() {
    f = { ...BLANK, sort: f.sort };
    shown = PAGE;
  }

  // ---- choices come from the tournaments that exist
  const summaries = $derived((tournaments ?? []).map((t) => ({ t, ...summaryOf(t) })));
  const all = $derived(summaries.map((r) => r.t));
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const games = $derived(uniq(all.map((t) => gameOf(t))));
  const categories = $derived(uniq(all.filter((t) => !f.game || gameOf(t) === f.game).map(categoryOf)));
  const divisions = $derived(
    [...new Set(all.map(divisionOf))].sort((a, b) => Number(b === OPEN) - Number(a === OPEN) || a.localeCompare(b)),
  );
  const tiers = $derived((['major', 'semi', 'small'] as Tier[]).filter((x) => all.some((t) => tierOf(t) === x)));
  const formats = $derived((Object.keys(FORMAT_LABEL) as Format[]).filter((x) => all.some((t) => t.format === x)));
  const anyOfficial = $derived(all.some((t) => t.official === 'yes'));
  const anySignup = $derived(summaries.some((r) => r.status === 'setup' && r.t.signup));
  // a choice that no longer exists (e.g. after changing the game) is dropped
  $effect(() => {
    if (f.category && !categories.includes(f.category)) f.category = '';
  });

  const counts = $derived({
    all: summaries.length,
    running: summaries.filter((r) => r.status === 'running').length,
    setup: summaries.filter((r) => r.status === 'setup').length,
    finished: summaries.filter((r) => r.status === 'finished').length,
  });

  const matches = $derived.by(() => {
    const needle = f.q.trim().toLowerCase();
    const list = summaries.filter(
      ({ t, status }) =>
        (f.status === 'all' || status === f.status) &&
        (!f.game || gameOf(t) === f.game) &&
        (!f.category || categoryOf(t) === f.category) &&
        (!f.division || divisionOf(t) === f.division) &&
        (!f.tier || tierOf(t) === f.tier) &&
        (!f.format || t.format === f.format) &&
        (!f.official || t.official === 'yes') &&
        (!f.signup || (status === 'setup' && !!t.signup)) &&
        (!needle || [t.name, gameOf(t), categoryOf(t), t.code].some((s) => s?.toLowerCase().includes(needle))),
    );
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      recent: (a, b) => b.t.updatedAt.localeCompare(a.t.updatedAt),
      newest: (a, b) => b.t.createdAt.localeCompare(a.t.createdAt),
      oldest: (a, b) => a.t.createdAt.localeCompare(b.t.createdAt),
      players: (a, b) => b.t.entrants.length - a.t.entrants.length || b.t.createdAt.localeCompare(a.t.createdAt),
      name: (a, b) => (a.t.name || '').localeCompare(b.t.name || ''),
    };
    return list.sort(by[f.sort]);
  });
  const PAGE = 30;
  let shown = $state(PAGE);
  const rows = $derived(matches.slice(0, shown));
  let more = $state(false); // phone: the extra filters are folded away
  const canCreate = $derived((void app.account, app.store.can('create')));

  const STATUS: [Filters['status'], string, keyof typeof counts][] = [
    ['all', 'All', 'all'],
    ['running', 'In progress', 'running'],
    ['setup', 'Not started', 'setup'],
    ['finished', 'Finished', 'finished'],
  ];
</script>

<div class="wrap page">
  <div class="top">
    <div>
      <h1>Tournaments</h1>
      {#if tournaments}<p class="muted sub">{counts.all} in total{#if counts.running}{` · ${counts.running} in progress`}{/if}</p>{/if}
    </div>
    {#if canCreate}<a class="btn primary" href="#/new">New tournament</a>{/if}
  </div>

  {#if app.store.kind === 'local'}
    <p class="notice small">
      Saved in this browser only. To share brackets with other people, connect a Google Sheet in
      <a href="#/admin">Admin settings</a>.
    </p>
  {/if}
  {#if error && tournaments}
    <p class="notice small">Can't reach the sheet ({error}). Showing what this device saw last time.</p>
  {/if}

  {#if error && !tournaments}
    <p class="notice">Couldn't load tournaments: {error}</p>
  {:else if tournaments === null}
    <p class="muted">Loading…</p>
  {:else if !tournaments.length}
    <div class="empty">
      <p>No tournaments yet.</p>
      {#if canCreate}<a class="btn primary" href="#/new">Make the first one</a>{/if}
    </div>
  {:else}
    <div class="filters">
      <div class="status" role="tablist" aria-label="Status">
        {#each STATUS as [k, label, c]}
          <button role="tab" class:on={f.status === k} aria-selected={f.status === k} onclick={() => ((f.status = k), (shown = PAGE))}>
            {label} <span class="n num">{counts[c]}</span>
          </button>
        {/each}
      </div>

      <div class="line">
        <input class="search" type="search" placeholder="Search name, game or join code" bind:value={f.q} oninput={() => (shown = PAGE)} aria-label="Search tournaments" />
        <label class="field sort">
          <span>Sort</span>
          <select bind:value={f.sort}>
            <option value="recent">Recently updated</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="players">Most players</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
        <button class="small ghost toggle" onclick={() => (more = !more)} aria-expanded={more}>
          Filters{#if active}&nbsp;<b class="num">({active})</b>{/if}
        </button>
      </div>

      <div class="more" class:open={more}>
        {#if games.length > 1}
          <label class="field">
            <span>Game</span>
            <select bind:value={f.game} onchange={() => (shown = PAGE)}>
              <option value="">All games</option>
              {#each games as g}<option value={g}>{g}</option>{/each}
            </select>
          </label>
        {/if}
        {#if categories.length}
          <label class="field">
            <span>Category</span>
            <select bind:value={f.category} onchange={() => (shown = PAGE)}>
              <option value="">All categories</option>
              {#each categories as c}<option value={c}>{c}</option>{/each}
            </select>
          </label>
        {/if}
        {#if divisions.length > 1}
          <label class="field">
            <span>Division</span>
            <select bind:value={f.division} onchange={() => (shown = PAGE)}>
              <option value="">All divisions</option>
              {#each divisions as d}<option value={d}>{d}</option>{/each}
            </select>
          </label>
        {/if}
        {#if formats.length > 1}
          <label class="field">
            <span>Format</span>
            <select bind:value={f.format} onchange={() => (shown = PAGE)}>
              <option value="">All formats</option>
              {#each formats as x}<option value={x}>{FORMAT_LABEL[x]}</option>{/each}
            </select>
          </label>
        {/if}
        {#if tiers.length > 1}
          <label class="field">
            <span>Event size</span>
            <select bind:value={f.tier} onchange={() => (shown = PAGE)}>
              <option value="">All sizes</option>
              {#each tiers as x}<option value={x}>{x === 'small' ? 'Small events' : `${TIER_LABEL[x]}s`}</option>{/each}
            </select>
          </label>
        {/if}
        <div class="checks">
          {#if anyOfficial}<label class="check"><input type="checkbox" bind:checked={f.official} /> Official only</label>{/if}
          {#if anySignup}<label class="check"><input type="checkbox" bind:checked={f.signup} /> Taking sign-ups</label>{/if}
        </div>
      </div>

      {#if active}
        <p class="small found">
          {matches.length} of {counts.all} tournaments
          <button class="link small" onclick={clear}>Clear filters</button>
        </p>
      {/if}
    </div>

    <TournamentRows {rows} empty={active ? 'No tournaments match these filters.' : 'Nothing here.'} />
    {#if matches.length > shown}
      <div class="pager">
        <button class="ghost" onclick={() => (shown += PAGE)}>Show more</button>
        <span class="small muted">{shown} of {matches.length}</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .page { padding-top: 24px; }
  .top { display: flex; justify-content: space-between; align-items: end; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .sub { margin: 4px 0 0; }
  .notice { margin-bottom: 16px; }

  .filters { display: grid; gap: 10px; margin-bottom: 14px; }
  .status { display: flex; flex-wrap: wrap; border-bottom: 1px solid var(--line-strong); }
  .status button {
    border: 0; border-bottom: 3px solid transparent; border-radius: 0; background: none; min-height: 40px; padding: 0 12px;
    font: 600 16px var(--font-cond); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin-bottom: -1px;
  }
  .status button.on { color: var(--ink); border-bottom-color: var(--accent); }
  .status .n { font-weight: 500; color: var(--muted); margin-left: 2px; }

  .line { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
  .search { flex: 1 1 240px; min-width: 0; }
  .sort { flex: 0 1 190px; flex-direction: row; align-items: center; gap: 8px; }
  .sort > span { font-size: 13px; color: var(--muted); }
  .toggle { display: none; }

  .more { display: flex; gap: 10px 12px; flex-wrap: wrap; align-items: end; }
  .more .field { flex: 0 1 170px; min-width: 0; }
  .more .field > span { font-size: 13px; }
  .checks { display: flex; gap: 6px 16px; flex-wrap: wrap; align-items: center; min-height: 40px; }
  .check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 15px; }
  .found { margin: 0; color: var(--ink-2); display: flex; gap: 12px; align-items: center; }
  button.link { background: none; border: 0; padding: 0; min-height: 0; color: var(--ink); text-decoration: underline; cursor: pointer; }
  .pager { display: flex; align-items: center; gap: 12px; padding-top: 14px; }

  @media (max-width: 640px) {
    .toggle { display: inline-flex; }
    .sort { flex: 1 1 auto; }
    .more { display: none; }
    .more.open { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .more .field { flex: none; }
    .checks { grid-column: 1 / -1; }
  }
</style>

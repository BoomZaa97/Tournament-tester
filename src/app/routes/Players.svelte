<script lang="ts">
  import Verified from '../components/Verified.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import { categoryOf, divisionOf, OPEN, TIER_LABEL, TIER_WEIGHT, tierOf } from '../lib/model';
  import { START_RATING } from '../lib/ranking';
  import type { Tier } from '../lib/model';
  import { filterTournaments, PROVISIONAL, ranked, rankings } from '../lib/ranking';
  import type { RankBy, Ranked } from '../lib/ranking';
  import type { AllData } from '../lib/store';

  let data = $state<AllData | null>(null);
  let error = $state('');
  let q = $state('');
  let game = $state('');
  let category = $state('');
  let division = $state('');
  let tier = $state<Tier | ''>('');
  let year = $state(0);
  let by = $state<RankBy>('rating');
  let verifiedOnly = $state(false);

  let picked = false;
  function show(d: AllData) {
    data = d;
    app.noteVerified(d.players);
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
  const inGame = $derived(all.filter((t) => !game || t.game === game));
  const categories = $derived([...new Set(inGame.map(categoryOf).filter(Boolean))].sort());
  const inCategory = $derived(inGame.filter((t) => !category || categoryOf(t) === category));
  // Open first, then the rest A–Z
  const divisions = $derived(
    [...new Set(inCategory.map(divisionOf))].sort((a, b) => Number(b === OPEN) - Number(a === OPEN) || a.localeCompare(b)),
  );
  const tiers = $derived((['major', 'semi', 'small'] as Tier[]).filter((x) => inGame.some((t) => tierOf(t) === x)));
  const years = $derived([...new Set(all.map((t) => new Date(t.createdAt).getFullYear()))].sort((a, b) => b - a));
  $effect(() => {
    if (category && !categories.includes(category)) category = '';
    if (division && !divisions.includes(division)) division = '';
    if (tier && !tiers.includes(tier)) tier = '';
  });

  const scope = $derived(data ? filterTournaments(data.tournaments, { game, category, division, tier, year: year || undefined }) : []);
  const anyVerified = $derived(!!data?.players.some((p) => p.account));
  const list = $derived.by(() => {
    if (!data) return [];
    // players who chose "hide me from the rankings" are left out (their matches still rate their opponents)
    const table = rankings(scope, data.players);
    // with no filter, players with an account show up before their first match too (not ranked yet)
    if (!game && !category && !division && !tier && !year) {
      for (const p of data.players) {
        if (!p.account || table.has(p.id)) continue;
        table.set(p.id, {
          player: p, rating: START_RATING, rated: 0, peak: START_RATING, change: 0, history: [], points: 0, events: 0, wins: 0,
          losses: 0, draws: 0, titles: 0, medals: [0, 0, 0], best: null, majorTitles: 0, semiTitles: 0,
        });
      }
    }
    const rows = ranked([...table.values()].filter((r) => !r.player.unranked), by);
    // "verified only" hides the others but keeps everyone's real place in the whole ranking
    return verifiedOnly ? rows.filter((r) => app.verified.has(r.player.id)) : rows;
  });
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((r) => r.player.name.toLowerCase().includes(needle)) : list;
  });
  const podium = $derived(q.trim() ? [] : list.filter((r) => r.rank !== null && r.rank <= 3).slice(0, 3));
  const firstUnranked = $derived(shown.findIndex((r) => r.rank === null));
  const hasMajors = $derived(scope.some((t) => tierOf(t) === 'major'));
  const myId = $derived(app.account?.playerId ?? '');
  const mine = $derived(myId ? list.find((r) => r.player.id === myId) : undefined);

  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const value = (r: Ranked) => (by === 'rating' ? Math.round(r.rating) : r.points);
  const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
  function jumpToMe() {
    q = '';
    requestAnimationFrame(() => document.getElementById(`r-${myId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
</script>

<div class="wrap page">
  <h1>Rankings</h1>
  <p class="muted intro">
    From every result on this site. Pick a game{categories.length ? ', category' : ''} or event size to see who's on top.
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
    {#if divisions.length > 1}
      <label class="field">
        <span>Division</span>
        <select bind:value={division}>
          <option value="">All divisions</option>
          {#each divisions as d}<option value={d}>{d}</option>{/each}
        </select>
      </label>
    {/if}
    {#if tiers.length > 1}
      <label class="field">
        <span>Events</span>
        <select bind:value={tier}>
          <option value="">All sizes</option>
          {#each tiers as t}<option value={t}>{t === 'small' ? 'Small events' : `${TIER_LABEL[t]}s`}</option>{/each}
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

  <div class="bar">
    <div class="by" role="tablist" aria-label="Rank by">
      <button class:on={by === 'rating'} role="tab" aria-selected={by === 'rating'} onclick={() => (by = 'rating')}>Rating</button>
      <button class:on={by === 'points'} role="tab" aria-selected={by === 'points'} onclick={() => (by = 'points')}>Points</button>
    </div>
    {#if anyVerified}
      <label class="check small"><input type="checkbox" bind:checked={verifiedOnly} /> Verified players only</label>
    {/if}
    {#if mine}
      <button class="small ghost me-btn" onclick={jumpToMe}>
        You: {mine.rank ? `#${mine.rank}` : 'not ranked yet'}
      </button>
    {/if}
  </div>

  {#if error}
    <p class="notice">Couldn't load: {error}</p>
  {:else if !data}
    <p class="muted">Loading…</p>
  {:else if shown.length === 0}
    <div class="empty">
      {q.trim() ? `Nobody called “${q.trim()}” here.` : verifiedOnly ? 'No verified players here yet.' : 'No players here yet. They appear once they play in a tournament.'}
    </div>
  {:else}
    {#if podium.length >= 2}
      <ol class="podium" aria-label="Top {podium.length}">
        {#each podium as r (r.player.id)}
          <li class="p{r.rank}" class:me={r.player.id === myId}>
            <span class="place">{ordinal(r.rank!)}</span>
            <span class="pn"><a class="pname" href="#/p/{r.player.id}">{r.player.name}</a><Verified id={r.player.id} /></span>
            <span class="pval">{value(r)} <small>{by === 'rating' ? 'rating' : 'pts'}</small></span>
            <span class="small muted">
              {r.wins}–{r.losses}{r.draws ? `–${r.draws}` : ''}
              {#if r.titles}· {r.titles} title{r.titles === 1 ? '' : 's'}{/if}
              {#if r.majorTitles}· {r.majorTitles} major{/if}
            </span>
          </li>
        {/each}
      </ol>
    {/if}

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
            {#if hasMajors}<th class="num hide-xs" title="Majors won">Majors</th>{/if}
            <th class="num hide-xs" title="1st / 2nd / 3rd places">Medals</th>
          </tr>
        </thead>
        <tbody>
          {#each shown as r, i (r.player.id)}
            {#if i === firstUnranked}
              <tr class="divider">
                <td colspan="8">
                  {by === 'rating'
                    ? `Not ranked yet: fewer than ${PROVISIONAL} rated matches`
                    : 'No points yet: points come from finished tournaments'}
                </td>
              </tr>
            {/if}
            <tr id="r-{r.player.id}" class:top={r.rank === 1} class:me={r.player.id === myId}>
              <td class="num rank">{r.rank ?? '–'}</td>
              <td class="name">
                <a href="#/p/{r.player.id}">{r.player.name}</a><Verified id={r.player.id} />
                {#if r.player.id === myId}<span class="you">You</span>{/if}
              </td>
              <td class="num" class:sorted={by === 'rating'}>
                <span class="val" class:prov={r.rated < PROVISIONAL}>{Math.round(r.rating)}</span>
                {#if Math.round(r.change)}
                  <span class="chg" class:up={r.change > 0}>{sign(Math.round(r.change))}</span>
                {/if}
              </td>
              <td class="num" class:sorted={by === 'points'}><span class="val">{r.points}</span></td>
              <td class="num hide-s">{r.wins}–{r.losses}{r.draws ? `–${r.draws}` : ''}</td>
              <td class="num hide-s">{r.events}</td>
              {#if hasMajors}<td class="num hide-xs">{r.majorTitles || ''}</td>{/if}
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
      <b>Points</b>: 100 for 1st, 70 for 2nd, 50 for 3rd, 40 for 4th, 25 for top 8, 15 for top 16, 10 for taking part;
      ×{TIER_WEIGHT.major} at majors, ×{TIER_WEIGHT.semi} at semi-majors.
      {#if anyVerified}<b>Verified</b> <Verified id={data.players.find((p) => p.account)?.id} />: the name belongs to the player's own account.{/if}
    </p>
  {/if}
</div>

<style>
  .page { padding-top: 28px; }
  h1 { margin-bottom: 4px; }
  .intro { margin-bottom: 16px; }
  .controls { display: flex; gap: 10px 12px; flex-wrap: wrap; align-items: end; margin-bottom: 16px; }
  .controls .field { flex: 0 1 180px; min-width: 0; }
  .controls .field > span { font-size: 13px; }
  .controls .grow { flex: 1 1 200px; max-width: 320px; }
  .bar { display: flex; align-items: center; gap: 10px 18px; flex-wrap: wrap; margin-bottom: 16px; }
  .by { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--radius); }
  .by button { border: 0; border-radius: 0; min-height: 36px; background: transparent; font: 600 15px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; padding: 0 16px; color: var(--muted); }
  .by button + button { border-left: 1px solid var(--line-strong); }
  .by button.on { background: var(--ink); color: var(--paper); }
  .check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .me-btn { margin-left: auto; }

  .podium { list-style: none; padding: 0; margin: 0 0 18px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .podium li {
    display: grid; align-content: start; gap: 2px; padding: 12px 14px; min-width: 0;
    background: var(--card); border: 1px solid var(--line-strong); border-top: 3px solid var(--line-strong); border-radius: var(--radius);
  }
  .podium li.p1 { border-top-color: var(--accent); }
  .podium li.p2 { border-top-color: var(--ink); }
  .podium li.me { box-shadow: inset 3px 0 0 var(--accent); }
  .podium .place { font: 700 15px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .p1 .place { color: var(--accent); }
  .pname { font: 700 22px/1.15 var(--font-cond); text-decoration: none; overflow-wrap: anywhere; display: inline; }
  .pname:hover { text-decoration: underline; }
  .pn { min-width: 0; }
  .pval { font: 700 26px/1.1 var(--font-cond); margin-top: 4px; }
  .pval small { font-size: 14px; font-weight: 500; color: var(--muted); }

  .tablewrap { overflow-x: auto; }
  .rank { font: 700 18px var(--font-cond); color: var(--muted); width: 40px; }
  .top .rank { color: var(--accent); }
  .name a { font-weight: 600; text-decoration: none; }
  .name a:hover { text-decoration: underline; }
  tr.me td { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  tr.me td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
  .you { margin-left: 6px; font: 700 11px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  th.sorted { color: var(--ink); }
  td.sorted .val { font: 700 18px var(--font-cond); }
  .val.prov { color: var(--muted); }
  .chg { display: inline-block; min-width: 30px; font-size: 12px; color: var(--muted); margin-left: 4px; text-align: left; }
  .chg.up { color: var(--ok); }
  .medals { white-space: nowrap; color: var(--ink-2); }
  .divider td { padding-top: 18px; font: 600 13px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); border-bottom: 2px solid var(--line-strong); }
  .note { margin-top: 12px; max-width: 640px; }
  @media (max-width: 640px) {
    .hide-s { display: none; }
    .podium { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .podium li { grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: 2px 10px; padding: 8px 12px; border-top-width: 1px; border-left: 3px solid var(--line-strong); }
    .podium li.p1 { border-left-color: var(--accent); }
    .podium li.p2 { border-left-color: var(--ink); }
    .podium .pn { grid-column: 2; }
    .podium .pname { font-size: 19px; }
    .podium .pval { grid-column: 3; grid-row: 1; font-size: 20px; margin: 0; }
    .podium .small { grid-column: 2 / 4; }
  }
  @media (max-width: 420px) {
    .hide-xs { display: none; }
    td, th { padding: 8px 6px; }
    .chg { min-width: 0; }
    .controls .field { flex: 1 1 140px; }
    .me-btn { margin-left: 0; }
  }
</style>

<script lang="ts">
  import { canonicalGame, gameOf } from '../lib/games';
  import Verified from '../components/Verified.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import { categoryOf, divisionOf, isOfficial, OPEN, TIER_LABEL, TIER_WEIGHT, tierOf } from '../lib/model';
  import type { Tier } from '../lib/model';
  import { emptyRow, filterTournaments, PROVISIONAL, ranked, rankings } from '../lib/ranking';
  import type { RankBy, Ranked } from '../lib/ranking';
  import type { AllData } from '../lib/store';

  let data = $state<AllData | null>(null);
  let error = $state('');
  let q = $state('');
  /**
   * #/players/<game>[/<category>] opens that game's ranking (in that category); ALL = every game together
   * (#/players/all-games/Esports = one category across its games); OVERVIEW = the top of each game and category.
   */
  const ALL = 'all-games';
  const OVERVIEW = 'overview';
  const fromLink = app.path[1] ?? '';
  // #/players/cs2 opens CS2 too
  let game = $state(fromLink === ALL || fromLink === OVERVIEW ? '' : canonicalGame(fromLink));
  let overview = $state(fromLink === OVERVIEW);
  let category = $state(fromLink === OVERVIEW ? '' : (app.path[2] ?? ''));
  let division = $state('');
  let tier = $state<Tier | ''>('');
  let year = $state(0);
  let by = $state<RankBy>('rating');
  let verifiedOnly = $state(false);

  let picked = false;
  function show(d: AllData) {
    data = d;
    app.noteVerified(d.players);
    if (picked || fromLink) return;
    // start on the game with the most tournaments: a rating across different games means little
    const count = new Map<string, number>();
    for (const t of d.tournaments) if (gameOf(t)) count.set(gameOf(t), (count.get(gameOf(t)) ?? 0) + 1);
    const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top === undefined) return; // nothing yet (e.g. an empty copy from last time): wait for the sheet
    picked = true;
    // several games: start on the overview (each game's top players); one game: its ranking
    if (count.size > 1) overview = true;
    else game = top;
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
  const canCreate = $derived((void app.account, app.store.can('create')));
  // most played first
  const games = $derived.by(() => {
    const count = new Map<string, number>();
    for (const t of all) if (gameOf(t)) count.set(gameOf(t), (count.get(gameOf(t)) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
  });
  /** Keeps the link shareable without reloading the page. */
  function writeLink() {
    history.replaceState(null, '', '#/players/' + encodeURIComponent(game || ALL) + (category ? '/' + encodeURIComponent(category) : ''));
  }
  function pickGame(g: string, c = '') {
    picked = true;
    overview = false;
    game = g;
    category = c;
    writeLink();
    if (c) scrollTo({ top: 0 });
  }
  function pickCategory(c: string) {
    category = c;
    writeLink();
  }
  function pickOverview() {
    picked = true;
    overview = true;
    game = '';
    category = '';
    history.replaceState(null, '', '#/players/' + OVERVIEW);
  }
  /** The overview: each game (most played first) with its top players and its categories. */
  const showOverview = $derived(overview && games.length > 1);
  const board = $derived.by(() => {
    if (!data || !showOverview) return [];
    const players = data.players;
    return games.map((g) => {
      const ts = filterTournaments(all, { game: g });
      const rows = ranked(rankings(ts, players).values(), by);
      // ranked players first; before anyone is ranked, the ones still settling (shown greyed, no place)
      const top = rows.slice(0, 5).filter((r, i, l) => r.rank !== null || !l.some((x) => x.rank !== null));
      return {
        game: g,
        events: ts.length,
        players: rows.length,
        top,
        cats: [...new Set(ts.map(categoryOf).filter(Boolean))].sort(),
      };
    });
  });
  /** One card per category played in 2+ games (Esports = CS2 + Valorant + …): its players across those games. */
  const catBoard = $derived.by(() => {
    if (!data || !showOverview) return [];
    const players = data.players;
    const gamesOf = new Map<string, Set<string>>();
    for (const t of all) {
      const c = categoryOf(t);
      if (c && gameOf(t)) gamesOf.set(c, (gamesOf.get(c) ?? new Set()).add(gameOf(t)));
    }
    return [...gamesOf]
      .filter(([, gs]) => gs.size > 1)
      .map(([c, gs]) => {
        const ts = filterTournaments(all, { category: c });
        const rows = ranked(rankings(ts, players).values(), by);
        const top = rows.slice(0, 5).filter((r, i, l) => r.rank !== null || !l.some((x) => x.rank !== null));
        return { category: c, games: games.filter((g) => gs.has(g)), events: ts.length, players: rows.length, top };
      })
      .sort((a, b) => b.events - a.events || a.category.localeCompare(b.category));
  });
  const inGame = $derived(all.filter((t) => !game || gameOf(t) === game));
  const categories = $derived([...new Set(inGame.map(categoryOf).filter(Boolean))].sort());
  const inCategory = $derived(inGame.filter((t) => !category || categoryOf(t) === category));
  // Open first, then the rest A–Z
  const divisions = $derived(
    [...new Set(inCategory.map(divisionOf))].sort((a, b) => Number(b === OPEN) - Number(a === OPEN) || a.localeCompare(b)),
  );
  const tiers = $derived((['major', 'semi', 'small'] as Tier[]).filter((x) => inGame.some((t) => tierOf(t) === x)));
  const years = $derived([...new Set(all.map((t) => new Date(t.createdAt).getFullYear()))].sort((a, b) => b - a));
  $effect(() => {
    if (!data) return; // a category from the link stays until there's something to check it against
    if (category && !categories.includes(category)) category = '';
    if (division && !divisions.includes(division)) division = '';
    if (tier && !tiers.includes(tier)) tier = '';
  });

  const scope = $derived(data ? filterTournaments(data.tournaments, { game, category, division, tier, year: year || undefined }) : []);
  const anyVerified = $derived(!!data?.players.some((p) => p.account));
  const list = $derived.by(() => {
    if (!data) return [];
    const table = rankings(scope, data.players);
    // with no filter, players with an account show up before their first match too (not ranked yet)
    if (!game && !category && !division && !tier && !year) {
      for (const p of data.players) if (p.account && !table.has(p.id)) table.set(p.id, emptyRow(p));
    }
    const rows = ranked(table.values(), by);
    // "verified only" hides the others but keeps everyone's real place in the whole ranking
    return verifiedOnly ? rows.filter((r) => app.verified.has(r.player.id)) : rows;
  });
  // players who chose "hide my name in the rankings" keep their place but show as Anonymous (to everyone but themselves)
  const anon = (r: Ranked) => !!r.player.unranked && r.player.id !== myId;
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((r) => !anon(r) && r.player.name.toLowerCase().includes(needle)) : list;
  });
  const podium = $derived(q.trim() ? [] : list.filter((r) => r.rank !== null && r.rank <= 3).slice(0, 3));
  const firstUnranked = $derived(shown.findIndex((r) => r.rank === null));
  const hasMajors = $derived(scope.some((t) => tierOf(t) === 'major'));
  const officialCount = $derived(scope.filter(isOfficial).length);
  const myId = $derived(app.account?.playerId ?? '');
  const mine = $derived(myId ? list.find((r) => r.player.id === myId) : undefined);

  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const value = (r: Ranked) => (by === 'rating' ? Math.round(r.rating) : by === 'confirmed' ? Math.round(r.confirmed) : r.points);
  const unit = $derived(by === 'points' ? 'pts' : by === 'confirmed' ? 'confirmed' : 'rating');
  const BY: [RankBy, string][] = [['rating', 'Rating'], ['confirmed', 'Confirmed'], ['points', 'Points']];
  const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
  function jumpToMe() {
    q = '';
    requestAnimationFrame(() => document.getElementById(`r-${myId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
</script>

{#snippet mini(top: Ranked[])}
    {#if top.length}
      <ol class="mini">
        {#each top as r (r.player.id)}
          <li class:me={r.player.id === myId}>
            <span class="mrank">{r.rank ?? '–'}</span>
            <span class="mname">
              {#if anon(r)}<span class="anon">Anonymous</span>{:else}<a href="#/p/{r.player.id}">{r.player.name}</a><Verified id={r.player.id} />{/if}
            </span>
            <span class="mval" class:prov={r.rank === null}>{value(r)}</span>
          </li>
        {/each}
      </ol>
      {#if top[0].rank === null}<p class="small muted settle">Nobody ranked yet: grey numbers are still settling ({PROVISIONAL} matches needed).</p>{/if}
    {:else}
      <p class="small muted">
        {by === 'points' ? 'No points yet: points come from finished tournaments.' : by === 'confirmed' ? 'No official tournaments here yet.' : `Nobody ranked yet: players need ${PROVISIONAL} rated matches.`}
      </p>
    {/if}
  {/snippet}

<div class="wrap page">
  <h1>Rankings{#if showOverview}<span class="game">&nbsp;· every game</span>{:else if game || category}<span class="game">&nbsp;· {[game, category].filter(Boolean).join(' · ')}</span>{/if}</h1>
  <p class="muted intro">
    Each game has its own ranking: a rating in one game says nothing about another.
  </p>
  {#if data && !games.length}
    <div class="start">
      <p>
        <b>No tournaments with a game have been played yet</b>, so there's nothing to rank. As soon as one has results,
        its game gets a ranking here, with an overview of every game and of each category (like Esports) across its games.
      </p>
      {#if canCreate}<a class="btn primary" href="#/new">New tournament</a>{/if}
    </div>
  {/if}

  {#if games.length > 1}
    <div class="chips games" role="tablist" aria-label="Game">
      <button role="tab" class="allg" class:on={showOverview} aria-selected={showOverview} onclick={pickOverview}>Overview</button>
      {#each games as g}
        <button role="tab" class:on={game === g} aria-selected={game === g} onclick={() => pickGame(g)}>{g}</button>
      {/each}
      <button role="tab" class="allg" class:on={!game && !showOverview} aria-selected={!game && !showOverview} onclick={() => pickGame('')}>All games together</button>
    </div>
  {/if}
  {#if categories.length > 1 && !showOverview}
    <div class="chips cats" role="tablist" aria-label="Category">
      <button role="tab" class:on={!category} aria-selected={!category} onclick={() => pickCategory('')}>All categories</button>
      {#each categories as c}
        <button role="tab" class:on={category === c} aria-selected={category === c} onclick={() => pickCategory(c)}>{c}</button>
      {/each}
    </div>
  {/if}

  {#if !showOverview}
  <div class="controls">
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
  {/if}

  <div class="bar">
    <div class="by" role="tablist" aria-label="Rank by">
      {#each BY as [k, label]}
        <button class:on={by === k} role="tab" aria-selected={by === k} onclick={() => (by = k)}>{label}</button>
      {/each}
    </div>
    {#if anyVerified}
      <label class="check small"><input type="checkbox" bind:checked={verifiedOnly} /> Verified players only</label>
    {/if}
    {#if showOverview}
      <!-- the overview has no "you" row: open a game for that -->
    {:else if mine}
      <button class="small ghost me-btn" onclick={jumpToMe}>
        You: {mine.rank ? `#${mine.rank}` : 'not ranked yet'}
      </button>
    {:else if myId && data}
      <span class="small muted me-btn">You haven't played {game || 'here'} yet</span>
    {/if}
  </div>
  {#if by === 'confirmed'}
    <p class="small muted byline">
      Only matches in <b>official tournaments</b> count here: tournaments staff checked.
      {officialCount ? `${officialCount} official tournament${officialCount === 1 ? '' : 's'} so far.` : 'There are none here yet.'}
    </p>
  {/if}

  {#if error}
    <p class="notice">Couldn't load: {error}</p>
  {:else if !data}
    <p class="muted">Loading…</p>
  {:else if showOverview}
    <div class="board">
      {#each board as b (b.game)}
        <section class="card">
          <h2><button class="link gname" onclick={() => pickGame(b.game)}>{b.game}</button></h2>
          <p class="small muted sub">{b.events} tournament{b.events === 1 ? '' : 's'} · {b.players} player{b.players === 1 ? '' : 's'}</p>
          {@render mini(b.top)}
          <div class="foot">
            <button class="link small" onclick={() => pickGame(b.game)}>Full ranking →</button>
            {#if b.cats.length > 1}
              <span class="small muted">By category:</span>
              {#each b.cats as c}<button class="link small" onclick={() => pickGame(b.game, c)}>{c}</button>{/each}
            {/if}
          </div>
        </section>
      {/each}
    </div>
    {#if catBoard.length}
      <h2 class="bycat">By category <span class="small muted">· players across every game in it</span></h2>
      <div class="board">
        {#each catBoard as b (b.category)}
          <section class="card">
            <h2><button class="link gname" onclick={() => pickGame('', b.category)}>{b.category}</button></h2>
            <p class="small muted sub">{b.games.join(', ')} · {b.events} tournament{b.events === 1 ? '' : 's'} · {b.players} player{b.players === 1 ? '' : 's'}</p>
            {@render mini(b.top)}
            <div class="foot">
              <button class="link small" onclick={() => pickGame('', b.category)}>Full ranking →</button>
            </div>
          </section>
        {/each}
      </div>
    {/if}
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
            <span class="pn">{#if anon(r)}<span class="pname anon">Anonymous</span>{:else}<a class="pname" href="#/p/{r.player.id}">{r.player.name}</a><Verified id={r.player.id} />{/if}</span>
            <span class="pval">{value(r)} <small>{unit}</small></span>
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
            <th class="num" class:sorted={by === 'confirmed'} class:hide-xs={by !== 'confirmed'} title="Rating from official tournaments only">Confirmed</th>
            <th class="num" class:sorted={by === 'points'} class:hide-xs={by !== 'points'}>Points</th>
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
                <td colspan="9">
                  {by === 'rating'
                    ? `Not ranked yet: fewer than ${PROVISIONAL} rated matches`
                    : by === 'confirmed'
                      ? `No confirmed rating yet: fewer than ${PROVISIONAL} matches in official tournaments`
                      : 'No points yet: points come from finished tournaments'}
                </td>
              </tr>
            {/if}
            <tr id={anon(r) ? undefined : `r-${r.player.id}`} class:top={r.rank === 1} class:me={r.player.id === myId}>
              <td class="num rank">{r.rank ?? '–'}</td>
              <td class="name">
                {#if anon(r)}
                  <span class="anon">Anonymous</span>
                {:else}
                  <a href="#/p/{r.player.id}">{r.player.name}</a><Verified id={r.player.id} />
                {/if}
                {#if r.player.id === myId}<span class="you">You{r.player.unranked ? ' · shown as Anonymous' : ''}</span>{/if}
              </td>
              <td class="num" class:sorted={by === 'rating'}>
                <span class="val" class:prov={r.rated < PROVISIONAL}>{Math.round(r.rating)}</span>
                {#if Math.round(r.change)}
                  <span class="chg" class:up={r.change > 0}>{sign(Math.round(r.change))}</span>
                {/if}
              </td>
              <td class="num" class:sorted={by === 'confirmed'} class:hide-xs={by !== 'confirmed'}>
                {#if r.confirmedRated}
                  <span class="val" class:prov={r.confirmedRated < PROVISIONAL}>{Math.round(r.confirmed)}</span>
                  {#if by === 'confirmed' && Math.round(r.confirmedChange)}
                    <span class="chg" class:up={r.confirmedChange > 0}>{sign(Math.round(r.confirmedChange))}</span>
                  {/if}
                {:else}<span class="muted">–</span>{/if}
              </td>
              <td class="num" class:sorted={by === 'points'} class:hide-xs={by !== 'points'}><span class="val">{r.points}</span></td>
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
      <b>Confirmed</b>: the same rating, from official tournaments only (checked by staff), so it can't be pumped up with
      made-up events. Grey numbers are still settling (fewer than {PROVISIONAL} matches).
      <b>Points</b>: 100 for 1st, 70 for 2nd, 50 for 3rd, 40 for 4th, 25 for top 8, 15 for top 16, 10 for taking part;
      ×{TIER_WEIGHT.major} at majors, ×{TIER_WEIGHT.semi} at semi-majors.
      {#if anyVerified}<b>Verified</b> <Verified id={data.players.find((p) => p.account)?.id} />: the name belongs to the player's own account.{/if}
    </p>
  {/if}
</div>

<style>
  .page { padding-top: 28px; }
  h1 { margin-bottom: 4px; }
  .intro { margin-bottom: 14px; }
  h1 .game { color: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .chips button {
    min-height: 34px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: transparent;
    font: 600 15px var(--font-cond); letter-spacing: 0.04em; color: var(--ink-2);
  }
  .chips button.on { background: var(--ink); border-color: var(--ink); color: var(--paper); }
  .chips.games button { font-size: 16px; }
  .chips .allg { border-style: dashed; }
  .chips.cats button { min-height: 30px; font-size: 14px; }
  .chips.cats { margin-bottom: 14px; }
  .byline { margin: -6px 0 14px; }
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
  .anon { color: var(--muted); font-style: italic; }
  .you { margin-left: 6px; font: 700 11px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  th.sorted { color: var(--ink); }
  td.sorted .val { font: 700 18px var(--font-cond); }
  .val.prov { color: var(--muted); }
  .chg { display: inline-block; min-width: 30px; font-size: 12px; color: var(--muted); margin-left: 4px; text-align: left; }
  .chg.up { color: var(--ok); }
  .medals { white-space: nowrap; color: var(--ink-2); }
  .divider td { padding-top: 18px; font: 600 13px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); border-bottom: 2px solid var(--line-strong); }
  .note { margin-top: 12px; max-width: 640px; }

  button.link {
    background: none; border: 0; padding: 0; min-height: 0; color: var(--ink-2); cursor: pointer;
    text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px;
  }
  button.link:hover { color: var(--ink); text-decoration-color: currentColor; }
  .card h2 button.link { text-decoration: none; color: var(--ink); }
  .card h2 button.link:hover { text-decoration: underline; }
  .start { border: 1px solid var(--line-strong); padding: 14px 16px; margin: 0 0 22px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .start p { margin: 0; flex: 1 1 320px; }
  .bycat { margin: 26px 0 10px; font-size: 20px; }
  .board { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 14px; }
  .card { border: 1px solid var(--line-strong); border-top: 3px solid var(--ink); border-radius: var(--radius); background: var(--card); padding: 12px 14px; min-width: 0; }
  .card h2 { margin: 0; font-size: 24px; border: 0; padding: 0; }
  .gname { font: inherit; text-transform: inherit; color: var(--ink); text-align: left; }
  .sub { margin: 0 0 8px; }
  .mini { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .mini li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: baseline; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); }
  .mini li:first-child .mrank { color: var(--accent); }
  .mini li.me { box-shadow: inset 3px 0 0 var(--accent); padding-left: 6px; }
  .mrank { font: 700 17px var(--font-cond); color: var(--muted); }
  .mname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mname a { font-weight: 600; text-decoration: none; }
  .mname a:hover { text-decoration: underline; }
  .mval { font: 700 17px var(--font-cond); font-variant-numeric: tabular-nums; }
  .mval.prov { color: var(--muted); }
  .settle { margin: 6px 0 0; }
  .foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-top: 10px; }
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

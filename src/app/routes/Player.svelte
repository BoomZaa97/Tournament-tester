<script lang="ts">
  import RatingChart from '../components/RatingChart.svelte';
  import TierTag from '../components/TierTag.svelte';
  import Verified from '../components/Verified.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import { buildHistory, winRate } from '../lib/history';
  import type { PlayerStats } from '../lib/history';
  import { squarePhoto } from '../lib/photo';
  import { TIER_LABEL, TIERS } from '../lib/model';
  import type { Tier } from '../lib/model';
  import { PROVISIONAL, ranked, rankings } from '../lib/ranking';
  import type { AllData, Profile } from '../lib/store';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  let stats = $state<PlayerStats | null>(null);
  let data = $state<AllData | null>(null);
  let names = $state(new Map<string, string>());
  let error = $state('');
  let renaming = $state(false);
  let newName = $state('');

  function show(d: AllData) {
    data = d;
    app.noteVerified(d.players);
    const all = buildHistory(d.tournaments, d.players);
    names = new Map([...all.values()].map((s) => [s.player.id, s.player.name]));
    // a player with no matches yet (e.g. a new account) still has a page
    const known = d.players.find((p) => p.id === id);
    stats = all.get(id) ?? (known ? { player: known, matches: [], wins: 0, losses: 0, draws: 0, tournaments: [], titles: 0 } : null);
  }

  // ---- photo, bio, links
  let profile = $state<Profile | null>(null);
  app.store.profile(id).then((p) => (profile = p), () => {});
  const canEditProfile = $derived.by(() => {
    void app.account; // logging in or out changes this
    return app.store.canEditProfile(id);
  });
  let editing = $state(false);
  let draft = $state<Profile>({ photo: '', bio: '', links: [] });
  let busy = $state(false);
  function startEdit() {
    draft = { photo: profile?.photo ?? '', bio: profile?.bio ?? '', links: [...(profile?.links ?? []), '', '', ''].slice(0, 3) };
    editing = true;
  }
  async function pickPhoto(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      draft.photo = await squarePhoto(file);
    } catch (err) {
      app.notify(errorText(err), 'error');
    }
  }
  async function saveProfile(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      profile = await app.store.saveProfile(id, {
        photo: draft.photo,
        bio: draft.bio.trim(),
        links: draft.links.map((l) => l.trim()).filter(Boolean).map((l) => (/^https?:\/\//i.test(l) ? l : `https://${l}`)),
      });
      editing = false;
      app.notify('Profile saved');
    } catch (err) {
      app.notify(errorText(err), 'error');
    } finally {
      busy = false;
    }
  }
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  // ---- rank in each game this player has played, and in each category of it they played in
  const gameCards = $derived.by(() => {
    if (!data || !stats) return [];
    const d = data;
    const mine = new Set(stats.tournaments.map((t) => t.id));
    const scopes: { game: string; category: string }[] = [];
    for (const game of [...new Set(stats.tournaments.map((t) => t.game))].sort()) {
      scopes.push({ game, category: '' });
      const inGame = d.tournaments.filter((t) => t.game === game);
      const cats = new Set(inGame.filter((t) => mine.has(t.id)).map((t) => t.category ?? '').filter(Boolean));
      // a category card only says something new when the game has other tournaments too
      for (const category of [...cats].sort()) if (inGame.some((t) => (t.category ?? '') !== category)) scopes.push({ game, category });
    }
    return scopes.map(({ game, category }) => {
      const ts = d.tournaments.filter((t) => t.game === game && (!category || t.category === category));
      const list = ranked(rankings(ts, d.players).values(), 'rating');
      const me = list.find((r) => r.player.id === id)!;
      return {
        key: `${game}|${category}`,
        label: (game || 'No game set') + (category ? ` · ${category}` : ''),
        me,
        list,
        of: list.filter((r) => r.rank !== null).length,
        pointsRank: ranked(list, 'points').find((r) => r.player.id === id)?.rank ?? null,
      };
    });
  });
  let chartKey = $state<string | null>(null);
  const chartCard = $derived(gameCards.find((c) => c.key === chartKey) ?? gameCards.find((c) => c.me.history.length));
  /** The leaderboard around this player in the chosen game: two above, two below. */
  const around = $derived.by(() => {
    const c = chartCard;
    if (!c || c.me.rank === null) return [];
    const rankedOnly = c.list.filter((r) => r.rank !== null);
    const i = rankedOnly.findIndex((r) => r.player.id === id);
    const from = Math.max(0, Math.min(i - 2, rankedOnly.length - 5));
    return rankedOnly.slice(from, from + 5);
  });

  // ---- by event size (major / semi-major / small)
  let tierFilter = $state<Tier | ''>('');
  const honours = $derived.by(() => {
    const ts = stats?.tournaments ?? [];
    return TIERS.filter((t) => ts.some((x) => x.tier === t)).map((tier) => {
      const mine = ts.filter((x) => x.tier === tier);
      const done = mine.filter((x) => x.finished && x.place);
      const best = done.length ? Math.min(...done.map((x) => x.place!)) : null;
      return {
        tier,
        events: mine.length,
        medals: [1, 2, 3].map((p) => done.filter((x) => x.place === p).length),
        best,
        points: mine.reduce((s, x) => s + x.points, 0),
      };
    });
  });
  const majorTitles = $derived(honours.find((h) => h.tier === 'major')?.medals[0] ?? 0);
  const tournamentsShown = $derived((stats?.tournaments ?? []).filter((t) => !tierFilter || t.tier === tierFilter));
  let allMatches = $state(false);
  let allH2h = $state(false);

  const medals = $derived(
    [1, 2, 3].map((p) => stats?.tournaments.filter((t) => t.finished && t.place === p).length ?? 0),
  );
  const form = $derived(stats?.matches.slice(0, 10) ?? []);
  const streak = $derived.by(() => {
    const ms = stats?.matches ?? [];
    if (!ms.length) return '';
    const n = ms.findIndex((m) => m.outcome !== ms[0].outcome);
    const count = n < 0 ? ms.length : n;
    if (count < 2) return '';
    const word = { W: 'wins', L: 'losses', D: 'draws' }[ms[0].outcome];
    return `${count} ${word} in a row`;
  });

  async function load() {
    // what this device saw last time, until the sheet answers
    const seen = app.store.peekAll();
    if (seen) show(seen);
    try {
      show(await app.store.loadAll());
      if (!stats) error = 'Player not found.';
    } catch (e) {
      if (!stats) error = errorText(e);
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

  async function deleteAccount() {
    if (!stats || !confirm(`Remove ${stats.player.name}'s account? They're logged out everywhere and lose the verified mark. Their results stay.`)) return;
    try {
      await app.store.deleteAccount!(id);
      app.verified.delete(id);
      stats = { ...stats, player: { ...stats.player, account: undefined } };
      app.notify('Account removed');
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
  <a class="back small" href="#/players">← Rankings</a>
  {#if error}
    <p class="notice">{error}</p>
  {:else if !stats}
    <p class="muted">Loading…</p>
  {:else}
    <div class="head">
    {#if profile?.photo}<img class="photo" src={profile.photo} alt="" width="96" height="96" />{/if}
    <div class="who">
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
          {#if stats.player.account && app.store.deleteAccount}
            <button class="small ghost danger" onclick={deleteAccount}>Remove account</button>
          {/if}
        {/if}
        {#if canEditProfile && !editing}
          <button class="small ghost" onclick={startEdit}>Edit profile</button>
        {/if}
      {/if}
    </div>
    {#if stats.player.account}<p class="acct"><Verified id={stats.player.id} label /> <span class="small muted">This name belongs to the player's own account. Nobody else can use it.</span></p>{/if}
    {#if profile?.bio}<p class="bio">{profile.bio}</p>{/if}
    {#if profile?.links.length}
      <ul class="links">
        {#each profile.links as l}<li><a href={l} target="_blank" rel="noopener noreferrer nofollow">{host(l)}</a></li>{/each}
      </ul>
    {/if}
    </div>
    </div>

    {#if editing}
      <form class="panel editor" onsubmit={saveProfile}>
        <div class="photo-edit">
          {#if draft.photo}
            <img class="photo" src={draft.photo} alt="" width="96" height="96" />
          {:else}
            <div class="photo none" aria-hidden="true"></div>
          {/if}
          <div class="row">
            <label class="btn small">
              {draft.photo ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/*" onchange={pickPhoto} hidden />
            </label>
            {#if draft.photo}<button type="button" class="small ghost" onclick={() => (draft.photo = '')}>Remove</button>{/if}
          </div>
        </div>
        <label class="field">
          <span>Bio <span class="muted">({280 - draft.bio.length} left)</span></span>
          <textarea bind:value={draft.bio} maxlength="280" rows="3" placeholder="Main character, team, where you play…"></textarea>
        </label>
        <div class="field">
          <span>Links <span class="muted">(up to 3: socials, stream, team page)</span></span>
          {#each draft.links as _, i}
            <input bind:value={draft.links[i]} placeholder="https://" inputmode="url" aria-label="Link {i + 1}" />
          {/each}
        </div>
        <div class="row">
          <button class="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
          <button type="button" class="ghost" onclick={() => (editing = false)}>Cancel</button>
          {#if app.store.kind === 'sheets' && !app.store.isAdmin}
            <span class="small muted">Everyone can see this.</span>
          {/if}
        </div>
      </form>
    {/if}
    {#if reset}
      <p class="notice">
        New password for <b>{reset.username}</b>: <b class="pw">{reset.password}</b>. Give it to them; they can change it on their
        Account page. Their other devices are logged out.
      </p>
    {/if}

    <dl class="stats">
      <div><dt class="label">Titles</dt><dd>{stats.titles}{#if majorTitles}<small class="sub">{majorTitles} major</small>{/if}</dd></div>
      <div>
        <dt class="label" title="1st / 2nd / 3rd places">Medals</dt>
        <dd class="medals"><span>{medals[0]}</span><i>/</i><span>{medals[1]}</span><i>/</i><span>{medals[2]}</span></dd>
      </div>
      <div><dt class="label">Record</dt><dd>{stats.wins}–{stats.losses}{stats.draws ? `–${stats.draws}` : ''}</dd></div>
      <div><dt class="label">Win rate</dt><dd>{winRate(stats)}</dd></div>
      <div><dt class="label">Events</dt><dd>{stats.tournaments.length}</dd></div>
    </dl>

    {#if gameCards.length}
      <section class="ranks">
        <h2>Rankings</h2>
        <div class="cards">
          {#each gameCards as c (c.key)}
            <button class="gcard" class:on={chartCard?.key === c.key} onclick={() => (chartKey = c.key)} disabled={!c.me.history.length}>
              <span class="label">{c.label}</span>
              <span class="big">
                {#if c.me.rank}#{c.me.rank} <small class="muted">of {c.of}</small>{:else}<span class="muted">Unranked</span>{/if}
              </span>
              <span class="small">
                Rating <b>{Math.round(c.me.rating)}</b>
                {#if c.me.rated < PROVISIONAL}<span class="muted">({c.me.rated} of {PROVISIONAL} matches)</span>
                {:else}<span class="muted">· peak {Math.round(c.me.peak)}</span>{/if}
              </span>
              <span class="small">
                {c.me.points} pts{#if c.pointsRank}<span class="muted">&nbsp;· #{c.pointsRank} on points</span>{/if}
                {#if c.me.best}<span class="muted">&nbsp;· best {ordinal(c.me.best)}</span>{/if}
              </span>
            </button>
          {/each}
        </div>
        {#if chartCard?.me.history.length}
          <h3 class="charthead">Rating{gameCards.length > 1 ? ` · ${chartCard.label}` : ''}</h3>
          <RatingChart points={chartCard.me.history} />
        {/if}
        {#if around.length > 1}
          <h3 class="charthead">Leaderboard{gameCards.length > 1 ? ` · ${chartCard!.label}` : ''}</h3>
          <table class="around">
            <tbody>
              {#each around as r (r.player.id)}
                <tr class:self={r.player.id === id}>
                  <td class="num rk">{r.rank}</td>
                  <td class="nm">
                    {#if r.player.id === id}<b>{r.player.name}</b>{:else}<a href="#/p/{r.player.id}">{r.player.name}</a>{/if}<Verified id={r.player.id} />
                  </td>
                  <td class="num">{Math.round(r.rating)}</td>
                  <td class="num muted hide-xs">{r.points} pts</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <a class="small" href="#/players">Full rankings →</a>
        {/if}
      </section>
    {/if}

    {#if honours.length}
      <section class="honours">
        <h2>By event size</h2>
        <table>
          <thead>
            <tr>
              <th>Events</th><th class="num">Played</th><th class="num">1st</th><th class="num">2nd</th><th class="num">3rd</th>
              <th class="num">Best</th><th class="num hide-xs">Points</th>
            </tr>
          </thead>
          <tbody>
            {#each honours as h (h.tier)}
              <tr>
                <td>{#if h.tier === 'small'}Small events{:else}<TierTag tier={h.tier} />{/if}</td>
                <td class="num">{h.events}</td>
                <td class="num" class:gold={h.medals[0] > 0}>{h.medals[0] || '–'}</td>
                <td class="num">{h.medals[1] || '–'}</td>
                <td class="num">{h.medals[2] || '–'}</td>
                <td class="num">{h.best ? ordinal(h.best) : '–'}</td>
                <td class="num hide-xs">{h.points}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    <div class="cols">
      <section>
        <div class="h2row">
          <h2>Tournaments</h2>
          {#if honours.length > 1}
            <div class="chips" role="tablist" aria-label="Event size">
              <button role="tab" class:on={!tierFilter} aria-selected={!tierFilter} onclick={() => (tierFilter = '')}>All</button>
              {#each honours as h (h.tier)}
                <button role="tab" class:on={tierFilter === h.tier} aria-selected={tierFilter === h.tier} onclick={() => (tierFilter = h.tier)}>
                  {h.tier === 'small' ? 'Small' : TIER_LABEL[h.tier]}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        {#if !stats.tournaments.length}<p class="muted">No tournaments yet.</p>{/if}
        <ul class="plain">
          {#each tournamentsShown as t (t.id)}
            <li>
              <span class="place" class:gold={t.place === 1 && t.finished}>{t.place ? ordinal(t.place) : '–'}</span>
              <span class="tbody">
                <span><a href="#/t/{t.id}">{t.name}</a> <TierTag tier={t.tier} /></span>
                <span class="muted small">
                  {[t.game, t.category, `${t.entrants} entrants`].filter(Boolean).join(' · ')}{#if !t.finished}&nbsp;· in progress{/if}
                </span>
              </span>
              {#if t.points}<span class="pts small">+{t.points}</span>{/if}
            </li>
          {/each}
        </ul>

        <h2 class="mt">Head-to-head</h2>
        {#if h2h.length}
          <table>
            <thead><tr><th>Opponent</th><th class="num">W</th><th class="num">L</th>{#if h2h.some((r) => r.d)}<th class="num">D</th>{/if}</tr></thead>
            <tbody>
              {#each allH2h ? h2h : h2h.slice(0, 8) as r (r.opp)}
                <tr>
                  <td><a href="#/p/{r.opp}">{names.get(r.opp) ?? '?'}</a><Verified id={r.opp} /></td>
                  <td class="num" class:lead={r.w > r.l}>{r.w}</td>
                  <td class="num">{r.l}</td>
                  {#if h2h.some((x) => x.d)}<td class="num">{r.d}</td>{/if}
                </tr>
              {/each}
            </tbody>
          </table>
          {#if h2h.length > 8}
            <button class="small ghost more" onclick={() => (allH2h = !allH2h)}>{allH2h ? 'Show fewer' : `Show all ${h2h.length} opponents`}</button>
          {/if}
        {:else}
          <p class="muted">No matches played yet.</p>
        {/if}
      </section>

      <section>
        <h2>Match history</h2>
        {#if form.length}
          <div class="form">
            <span class="label">Recent form</span>
            <span class="boxes" aria-label="Last {form.length} results, newest first">
              {#each form as m, i (i)}<span class="res r-{m.outcome}" title="vs {names.get(m.opponent) ?? '?'}">{m.outcome}</span>{/each}
            </span>
            {#if streak}<span class="small muted">{streak}</span>{/if}
          </div>
        {/if}
        {#if stats.matches.length}
          <ul class="plain matches">
            {#each allMatches ? stats.matches : stats.matches.slice(0, 15) as m, i (i)}
              <li>
                <span class="res r-{m.outcome}">{m.outcome}</span>
                <span class="mbody">
                  <span>vs <a href="#/p/{m.opponent}">{names.get(m.opponent) ?? '?'}</a><Verified id={m.opponent} /> <b class="sc">{m.score}</b></span>
                  <span class="small muted"><a href="#/t/{m.tournamentId}">{m.tournamentName}</a> · {m.round}</span>
                </span>
              </li>
            {/each}
          </ul>
          {#if stats.matches.length > 15}
            <button class="small ghost more" onclick={() => (allMatches = !allMatches)}>{allMatches ? 'Show fewer' : `Show all ${stats.matches.length} matches`}</button>
          {/if}
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
  .head { display: flex; gap: 18px; align-items: flex-start; }
  .who { min-width: 0; flex: 1; }
  .photo { width: 96px; height: 96px; flex: none; object-fit: cover; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--card); }
  .photo.none { border-style: dashed; }
  .bio { margin: 8px 0 0; max-width: 620px; white-space: pre-line; color: var(--ink-2); }
  .links { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 0; margin: 6px 0 0; }
  .links a { font-weight: 600; text-decoration-color: var(--accent); text-underline-offset: 3px; }
  .editor { display: grid; gap: 14px; padding: 16px; margin-top: 16px; max-width: 560px; }
  .editor .field { gap: 6px; }
  .photo-edit { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .btn.small { min-height: 32px; padding: 0 10px; font-size: 14px; }
  .stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 20px 0 28px; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--line); }
  .stats div { padding: 12px 4px; }
  .stats div + div { border-left: 1px solid var(--line); padding-left: 14px; }
  dd { margin: 2px 0 0; font: 700 30px/1 var(--font-cond); }
  .medals i { font-style: normal; color: var(--line-strong); margin: 0 3px; font-weight: 400; }
  .medals span:first-child { color: var(--accent); }
  .ranks { margin-bottom: 32px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; margin-top: 12px; }
  .gcard {
    all: unset; box-sizing: border-box; display: grid; gap: 4px; padding: 12px 14px; cursor: pointer;
    background: var(--card); border: 1px solid var(--line-strong); border-radius: var(--radius);
  }
  .gcard:hover:not(:disabled) { border-color: var(--ink); }
  .gcard:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .gcard:disabled { cursor: default; }
  .gcard.on { border-color: var(--ink); box-shadow: inset 3px 0 0 var(--accent); }
  .big { font: 700 28px/1.1 var(--font-cond); }
  .big small { font-size: 16px; font-weight: 500; }
  .charthead { margin: 20px 0 6px; }
  .form { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .boxes { display: flex; gap: 3px; }
  .boxes .res { width: 24px; height: 24px; flex: 0 0 24px; font-size: 13px; }
  .r-D { color: var(--ink-2); background: var(--line); }
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
  .sub { display: block; margin-top: 3px; font: 600 12px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
  .around { margin-bottom: 6px; }
  .around .rk { width: 36px; font: 700 16px var(--font-cond); color: var(--muted); }
  .around .nm { width: 100%; }
  .around .num { white-space: nowrap; }
  .around .nm a { font-weight: 600; }
  .around tr.self td { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .around tr.self td:first-child { box-shadow: inset 3px 0 0 var(--accent); color: var(--accent); }
  .honours { margin-bottom: 32px; }
  .honours table { margin-top: 8px; }
  .honours .gold { color: var(--accent); font-weight: 700; }
  .h2row { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; border-bottom: 2px solid var(--ink); margin-bottom: 0; }
  .h2row h2 { border-bottom: 0; margin-bottom: 0; }
  .chips { display: flex; gap: 4px; padding-bottom: 6px; flex-wrap: wrap; }
  .chips button { min-height: 28px; padding: 0 10px; font: 600 13px var(--font-cond); letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); background: transparent; border: 1px solid var(--line-strong); }
  .chips button.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .tbody { display: grid; min-width: 0; flex: 1; }
  .pts { font-family: var(--font-cond); font-weight: 700; color: var(--ink-2); white-space: nowrap; }
  .more { margin-top: 8px; }
  td a { text-decoration: none; }
  @media (max-width: 760px) {
    .cols { grid-template-columns: minmax(0, 1fr); }
    .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .stats div { border-bottom: 1px solid var(--line); }
    .stats div:nth-child(4) { border-left: 0; padding-left: 4px; }
    .head { gap: 12px; }
    .head > .photo { width: 72px; height: 72px; }
  }
  @media (max-width: 420px) { .hide-xs { display: none; } }
</style>

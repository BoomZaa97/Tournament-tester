<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import TierTag from '../components/TierTag.svelte';
  import OfficialTag from '../components/OfficialTag.svelte';
  import Verified from '../components/Verified.svelte';
  import { categoryOf, FORMAT_LABEL, STATUS_LABEL, summaryOf, tierOf } from '../lib/model';
  import type { Player, TournamentDoc } from '../lib/model';
  import { ranked, rankings } from '../lib/ranking';
  import { siteSettings } from '../lib/store';
  import type { NewsItem, NewsPost } from '../lib/store';

  const newestFirst = (list: TournamentDoc[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // what this device saw last time, until the sheet answers
  const seen = app.store.peekAll();
  let tournaments = $state<TournamentDoc[] | null>(seen ? newestFirst(seen.tournaments) : null);
  let players = $state<Player[]>(seen?.players ?? []);
  let news = $state<NewsItem[]>(siteSettings().news ?? []);
  let error = $state('');
  let filter = $state<'all' | 'running' | 'setup' | 'finished' | 'official'>('all');

  app.store
    .loadAll()
    .then((d) => {
      tournaments = newestFirst(d.tournaments);
      players = d.players;
      news = siteSettings().news ?? [];
      app.noteVerified(d.players);
      error = '';
    })
    .catch((e) => (error = errorText(e)));

  let q = $state('');
  const PAGE = 30;
  let shown = $state(PAGE);
  // worked out once per load, not on every keystroke in the search box
  const summaries = $derived((tournaments ?? []).map((t) => ({ t, ...summaryOf(t) })));
  const matches = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return summaries
      .filter((r) => filter === 'all' || (filter === 'official' ? r.t.official === 'yes' : r.status === filter))
      .filter(({ t }) => !needle || [t.name, t.game, t.category, t.code].some((s) => s?.toLowerCase().includes(needle)));
  });
  const rows = $derived(matches.slice(0, shown));

  // ---- front page
  const live = $derived(summaries.filter((r) => r.status === 'running').slice(0, 5));
  const openSignup = $derived(summaries.filter((r) => r.status === 'setup' && r.t.signup).slice(0, 5));
  const results = $derived(summaries.filter((r) => r.champion).slice(0, 5));
  const officials = $derived(summaries.filter((r) => r.t.official === 'yes'));
  const counts = $derived({
    tournaments: summaries.length,
    running: summaries.filter((r) => r.status === 'running').length,
    players: players.length,
  });
  // top players of the most played game (a rating only means something within one game)
  const topGame = $derived.by(() => {
    const count = new Map<string, number>();
    for (const t of tournaments ?? []) if (t.game) count.set(t.game, (count.get(t.game) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
  });
  const top = $derived.by(() => {
    if (!tournaments?.length) return [];
    const me = app.account?.playerId;
    return ranked(rankings(tournaments.filter((t) => !topGame || t.game === topGame), players).values(), 'rating')
      .filter((r) => r.rank !== null)
      .slice(0, 5)
      .map((r) => ({ ...r, anon: !!r.player.unranked && r.player.id !== me }));
  });
  const shared = app.store.kind === 'sheets';

  // ---- join code
  let code = $state('');
  let joinError = $state('');
  let joining = $state(false);
  async function join() {
    if (!code.trim()) return;
    joining = true;
    joinError = '';
    try {
      const t = await app.store.findByCode(code);
      app.go(`j/${t.id}`);
    } catch (e) {
      joinError = errorText(e);
    } finally {
      joining = false;
    }
  }

  // ---- notices (staff write them)
  const canPost = $derived((void app.account, app.store.can('tournaments')));
  const NEWS_SHOWN = 3;
  let allNews = $state(false);
  let draft = $state<NewsPost | null>(null);
  let posting = $state(false);
  const blank = (): NewsPost => ({ title: '', text: '', link: '', important: false });
  async function saveNews() {
    if (!draft) return;
    posting = true;
    try {
      news = (await app.store.setNews({ post: draft })).news ?? [];
      app.notify(draft.id ? 'Notice updated' : 'Notice posted');
      draft = null;
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      posting = false;
    }
  }
  async function removeNews(n: NewsItem) {
    if (!confirm(`Remove the notice "${n.title}"?`)) return;
    try {
      news = (await app.store.setNews({ remove: n.id })).news ?? [];
      app.notify('Notice removed');
    } catch (e) {
      app.notify(errorText(e), 'error');
    }
  }
  const external = (link: string) => /^https?:/.test(link);

  // "only organizers can create" (site security setting); re-read when the account changes
  const canCreate = $derived((void app.account, app.store.can('create')));

  function showOfficial() {
    filter = 'official';
    shown = PAGE;
    requestAnimationFrame(() => document.getElementById('all-tournaments')?.scrollIntoView({ behavior: 'smooth' }));
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const short = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
</script>

<div class="wrap page">
  <header class="mast">
    <div class="title">
      <p class="dateline num">{today}</p>
      <h1>Tournaments &amp; results</h1>
      <p class="sub">
        {#if counts.tournaments}
          {plural(counts.tournaments, 'tournament')}, {plural(counts.players, 'player')}{#if counts.running}, <b>{counts.running} on now</b>{/if}.
        {:else}
          Brackets, scores and rankings for any game.
        {/if}
      </p>
    </div>
    <div class="mast-actions">
      {#if canCreate}<a class="btn primary" href="#/new">New tournament</a>{/if}
      {#if shared && !app.account}<a class="btn" href="#/account">Log in</a>{/if}
    </div>
  </header>

  <div class="front">
    <!-- right column on wide screens; first on phones -->
    <aside class="side top-side">
      <form class="joinbox" onsubmit={(e) => { e.preventDefault(); join(); }}>
        <label for="join-code" class="sec-label">Join with a code</label>
        <div class="row">
          <input id="join-code" bind:value={code} placeholder="K7QM2X" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          <button class="primary" type="submit" disabled={!code.trim() || joining}>{joining ? 'Looking…' : 'Join'}</button>
        </div>
        {#if joinError}<p class="small err">{joinError}</p>{/if}
        <p class="small muted">The 6-letter code is on the poster or in the organizer's message.</p>
      </form>

      {#if news.length || canPost}
        <section class="sec notices">
          <div class="sec-head">
            <h2>Notices</h2>
            {#if canPost && !draft}<button class="small ghost" onclick={() => (draft = blank())}>+ Post</button>{/if}
          </div>
          {#if draft}
            <form class="draft" onsubmit={(e) => { e.preventDefault(); saveNews(); }}>
              <label class="field"><span>Title</span><input bind:value={draft.title} maxlength="80" required /></label>
              <label class="field"><span>Text <span class="muted">(optional)</span></span><textarea bind:value={draft.text} maxlength="400" rows="3"></textarea></label>
              <label class="field"><span>Link <span class="muted">(optional: https://… or #/t/…)</span></span><input bind:value={draft.link} maxlength="300" /></label>
              <label class="check small"><input type="checkbox" bind:checked={draft.important} /> Important (shown in orange)</label>
              <div class="row">
                <button class="primary small" type="submit" disabled={posting || !draft.title.trim()}>{posting ? 'Saving…' : draft.id ? 'Save' : 'Post'}</button>
                <button class="ghost small" type="button" onclick={() => (draft = null)} disabled={posting}>Cancel</button>
              </div>
            </form>
          {/if}
          {#if !news.length && !draft}<p class="small muted none">No notices. Staff can post news here: dates, rule changes, results.</p>{/if}
          <ul>
            {#each allNews ? news : news.slice(0, NEWS_SHOWN) as n (n.id)}
              <li class:important={n.important}>
                <span class="when num">{short(n.at)}</span>
                <div class="what">
                  <b>{n.title}</b>
                  {#if n.text}<p>{n.text}</p>{/if}
                  {#if n.link}
                    <a class="small" href={n.link} target={external(n.link) ? '_blank' : undefined} rel={external(n.link) ? 'noopener noreferrer' : undefined}>
                      {external(n.link) ? 'Open link' : 'Go there'} →
                    </a>
                  {/if}
                  {#if canPost}
                    <span class="staff">
                      <button class="link small" onclick={() => (draft = { id: n.id, title: n.title, text: n.text, link: n.link, important: n.important })}>Edit</button>
                      <button class="link small danger" onclick={() => removeNews(n)}>Remove</button>
                    </span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
          {#if news.length > NEWS_SHOWN}
            <button class="link small" onclick={() => (allNews = !allNews)}>{allNews ? 'Show fewer' : `All ${news.length} notices`}</button>
          {/if}
        </section>
      {/if}
    </aside>

    <div class="main">
      {#if live.length}
        <section class="sec">
          <h2><span class="dot" aria-hidden="true"></span>On now</h2>
          <ul class="lines">
            {#each live as r (r.t.id)}
              <li>
                <a class="tname" href="#/t/{r.t.id}">{r.t.name}</a>
                <span class="small muted">{[r.t.game, FORMAT_LABEL[r.t.format]].filter(Boolean).join(' · ')}</span>
                <span class="prog small num">
                  <span class="bar" aria-hidden="true"><span style="width: {r.total ? (100 * r.played) / r.total : 0}%"></span></span>
                  {r.played}/{r.total}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if openSignup.length}
        <section class="sec">
          <h2>Taking sign-ups</h2>
          <ul class="lines">
            {#each openSignup as r (r.t.id)}
              <li>
                <a class="tname" href="#/j/{r.t.id}">{r.t.name}</a>
                <span class="small muted">
                  {[r.t.game, `${r.t.entrants.length}${r.t.maxPlayers ? ` of ${r.t.maxPlayers}` : ''} signed up`].filter(Boolean).join(' · ')}
                </span>
                <a class="btn small" href="#/j/{r.t.id}">Sign up</a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if results.length}
        <section class="sec">
          <h2>Latest results</h2>
          <ul class="lines">
            {#each results as r (r.t.id)}
              <li>
                <span><b class="champ">{r.champion}</b> won <a href="#/t/{r.t.id}">{r.t.name}</a></span>
                <span class="small muted">{[r.t.game, plural(r.t.entrants.length, 'player'), short(r.t.updatedAt)].filter(Boolean).join(' · ')}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if !summaries.length && tournaments !== null}
        <section class="sec start">
          <h2>Nothing here yet</h2>
          <p>
            <b>Organizers:</b> make a tournament, pick the format and share its join code. Players can sign up themselves.
            Results can be changed at any time and the bracket follows.
          </p>
          <p><b>Players:</b> type the code from the organizer in the box, sign up and report your own scores with your PIN.</p>
          {#if canCreate}<a class="btn primary" href="#/new">Make the first tournament</a>{/if}
        </section>
      {/if}
    </div>

    <aside class="side low-side">
      {#if top.length}
        <section class="sec">
          <h2>Top players{#if topGame}<span class="g">&nbsp;· {topGame}</span>{/if}</h2>
          <ol class="top">
            {#each top as r (r.player.id)}
              <li>
                <span class="rk num">{r.rank}</span>
                <span class="pl">{#if r.anon}<span class="muted">Anonymous</span>{:else}<a href="#/p/{r.player.id}">{r.player.name}</a><Verified id={r.player.id} />{/if}</span>
                <span class="num rt">{Math.round(r.rating)}</span>
              </li>
            {/each}
          </ol>
          <a class="small more-link" href={topGame ? `#/players/${encodeURIComponent(topGame)}` : '#/players'}>Full rankings →</a>
        </section>
      {/if}

      {#if officials.length}
        <section class="sec">
          <h2>Official</h2>
          <ul class="lines tight">
            {#each officials.slice(0, 4) as r (r.t.id)}
              <li>
                <a href="#/t/{r.t.id}">{r.t.name}</a>
                <span class="small muted">{[r.t.game, STATUS_LABEL[r.status]].filter(Boolean).join(' · ')}</span>
              </li>
            {/each}
          </ul>
          <p class="small muted">Checked by staff; these count towards the confirmed rating.</p>
          {#if officials.length > 4}<button class="link small" onclick={showOfficial}>All {officials.length} →</button>{/if}
        </section>
      {/if}
    </aside>
  </div>

  {#if summaries.length || error || tournaments === null}
    <div class="head">
      <h2 class="listhead" id="all-tournaments">All tournaments</h2>
    </div>
  {/if}

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
  {:else if tournaments.length}
    <div class="filters" role="tablist">
      {#each [['all', 'All'], ['running', 'In progress'], ['setup', 'Not started'], ['finished', 'Finished']] as [k, label]}
        <button class="ghost small" class:on={filter === k} onclick={() => ((filter = k as typeof filter), (shown = PAGE))}>{label}</button>
      {/each}
      {#if officials.length}
        <button class="ghost small" class:on={filter === 'official'} onclick={() => ((filter = 'official'), (shown = PAGE))}>Official</button>
      {/if}
      {#if tournaments.length > 8}
        <input class="search" type="search" placeholder="Search name, game or code" bind:value={q} oninput={() => (shown = PAGE)} aria-label="Search tournaments" />
      {/if}
    </div>
    <ul class="list">
      {#each rows as { t, status, played, total, champion } (t.id)}
        <li>
          <a href="#/t/{t.id}">
            <span class="name">{t.name || 'Untitled'}</span>
            <span class="meta">
              {#if t.game}<span>{t.game}</span>{/if}
              {#if categoryOf(t)}<span>{categoryOf(t)}</span>{/if}
              {#if t.official === 'yes'}<span><OfficialTag official={t.official} /></span>{/if}
              {#if tierOf(t) !== 'small'}<span><TierTag tier={t.tier} /></span>{/if}
              <span>{FORMAT_LABEL[t.format]}</span>
              <span>{t.entrants.length} entrants</span>
              <span>{date(t.createdAt)}</span>
            </span>
            {#if champion}
              <span class="extra"><span class="label">Champion</span> <b>{champion}</b></span>
            {:else if status === 'running' && total}
              <span class="extra">
                <span class="bar" aria-hidden="true"><span style="width: {(100 * played) / total}%"></span></span>
                {played} of {total} matches played
              </span>
            {/if}
            <span class="status s-{status}">{STATUS_LABEL[status]}</span>
          </a>
        </li>
      {:else}
        <li class="muted small none">{q.trim() ? `Nothing matches “${q.trim()}”.` : 'Nothing here.'}</li>
      {/each}
    </ul>
    {#if matches.length > shown}
      <div class="more">
        <button class="ghost" onclick={() => (shown += PAGE)}>Show more</button>
        <span class="small muted">{shown} of {matches.length}</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .page { padding-top: 24px; }

  /* masthead: like the top of a printed results sheet */
  .mast { display: flex; justify-content: space-between; align-items: end; gap: 12px 24px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 3px solid var(--ink); }
  .dateline { margin: 0 0 2px; font: 600 13px var(--font-cond); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .mast h1 { margin: 0; font-size: clamp(32px, 5vw, 46px); line-height: 1; }
  .sub { margin: 6px 0 0; color: var(--ink-2); }
  .sub b { color: var(--accent); font-weight: 600; }
  .mast-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  /* main on the left; join + notices, then rankings, on the right */
  .front { display: grid; grid-template-columns: minmax(0, 1fr) 320px; column-gap: 36px; margin: 22px 0 34px; }
  .main { grid-column: 1; grid-row: 1 / span 2; min-width: 0; display: grid; gap: 22px; align-content: start; }
  .top-side { grid-column: 2; grid-row: 1; }
  .low-side { grid-column: 2; grid-row: 2; margin-top: 22px; }
  .side { display: grid; gap: 22px; align-content: start; min-width: 0; }

  .sec h2, .sec-label {
    display: flex; align-items: center; gap: 8px; margin: 0; padding: 6px 0;
    font: 700 15px var(--font-cond); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink);
  }
  .sec h2 { border-bottom: 1px solid var(--ink); }
  .sec h2 .g { color: var(--muted); letter-spacing: 0.04em; }
  .sec-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--ink); }
  .sec-head h2 { border-bottom: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }

  .joinbox { display: grid; gap: 6px; padding: 12px 14px 14px; border: 2px solid var(--ink); border-radius: var(--radius); background: var(--card); }
  .joinbox .sec-label { padding: 0; }
  .joinbox p { margin: 0; }
  .joinbox .row { flex-wrap: nowrap; }
  .joinbox input { flex: 1; min-width: 0; font: 700 20px var(--font-cond); letter-spacing: 0.16em; text-transform: uppercase; }
  .joinbox input::placeholder { color: var(--line-strong); }

  .lines, .notices ul, .top { list-style: none; margin: 0; padding: 0; }
  .lines li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 14px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .lines li > :nth-child(2) { grid-column: 1; }
  .lines li > :nth-child(3) { grid-column: 2; grid-row: 1 / span 2; }
  .lines.tight li { padding: 7px 0; }
  .lines a:not(.btn) { font-weight: 600; text-decoration: none; }
  .lines a:not(.btn):hover { text-decoration: underline; }
  .lines a.tname { font: 700 19px/1.15 var(--font-cond); text-transform: uppercase; }
  .champ { font: 700 17px var(--font-cond); text-transform: uppercase; }
  .prog { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-2); }

  .notices li { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .notices li.important { box-shadow: inset 3px 0 0 var(--accent); padding-left: 10px; }
  .notices li.important b { color: var(--accent); }
  .when { font: 600 14px var(--font-cond); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); padding-top: 1px; }
  .what { display: grid; gap: 3px; justify-items: start; min-width: 0; }
  .what p { margin: 0; white-space: pre-line; color: var(--ink-2); font-size: 15px; overflow-wrap: anywhere; }
  .what b { overflow-wrap: anywhere; }
  .staff { display: flex; gap: 12px; }
  .none { margin: 10px 0 0; }
  .draft { display: grid; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  button.link { background: none; border: 0; padding: 0; min-height: 0; color: var(--ink); text-decoration: underline; font-weight: 400; cursor: pointer; justify-self: start; }
  button.link.danger { color: var(--danger); }
  .notices > button.link { margin-top: 8px; }

  .top li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); }
  .top .pl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .top .pl a { font-weight: 600; text-decoration: none; }
  .top .rk { font: 700 17px var(--font-cond); color: var(--muted); }
  .top li:first-child .rk { color: var(--accent); }
  .top .rt { font-weight: 600; }
  .more-link { display: inline-block; margin-top: 8px; }
  .sec > p.small { margin: 8px 0 4px; }

  .start p { margin: 10px 0; max-width: 560px; color: var(--ink-2); }
  .start b { color: var(--ink); }

  @media (max-width: 860px) {
    .front { grid-template-columns: minmax(0, 1fr); }
    .main, .top-side, .low-side { grid-column: 1; grid-row: auto; }
    .main:not(:empty) { margin-top: 22px; }
  }

  /* all tournaments */
  .head { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .listhead { margin: 0; font-size: 26px; }
  .filters { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
  .filters .on { border-color: var(--ink); }
  .search { margin-left: auto; flex: 0 1 260px; min-width: 0; }
  .more { display: flex; align-items: center; gap: 12px; padding-top: 14px; }
  @media (max-width: 520px) { .search { margin-left: 0; flex: 1 1 100%; } }
  .list { list-style: none; margin: 0; padding: 0; border-top: 2px solid var(--ink); }
  .list li { border-bottom: 1px solid var(--line); }
  .list a {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 12px;
    padding: 14px 4px;
    text-decoration: none;
  }
  .list a:hover .name { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
  .name { font-family: var(--font-cond); font-weight: 700; font-size: 22px; text-transform: uppercase; line-height: 1.1; }
  .meta { grid-column: 1; display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--muted); font-size: 14px; }
  .extra { grid-column: 1; display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--ink-2); margin-top: 2px; }
  .extra .label { color: var(--accent); }
  .extra b { color: var(--ink); }
  .bar { width: 64px; height: 5px; background: var(--line); border-radius: 1px; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--accent); }
  .status {
    grid-column: 2; grid-row: 1 / span 3; align-self: center;
    font: 600 13px/1 var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase;
    padding: 6px 8px; border: 1px solid var(--line-strong); border-radius: var(--radius);
  }
  .s-running { border-color: var(--accent); color: var(--accent); }
  .s-finished { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .list .none { padding: 14px 4px; }
  .notice { margin-bottom: 20px; }
  .err { color: var(--danger); margin: 0; }
</style>

<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import TierTag from '../components/TierTag.svelte';
  import Verified from '../components/Verified.svelte';
  import { categoryOf, FORMAT_LABEL, STATUS_LABEL, summaryOf, tierOf } from '../lib/model';
  import type { Player, TournamentDoc } from '../lib/model';
  import { ranked, rankings } from '../lib/ranking';

  const newestFirst = (list: TournamentDoc[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // what this device saw last time, until the sheet answers
  const seen = app.store.peekAll();
  let tournaments = $state<TournamentDoc[] | null>(seen ? newestFirst(seen.tournaments) : null);
  let players = $state<Player[]>(seen?.players ?? []);
  let error = $state('');
  let filter = $state<'all' | 'running' | 'setup' | 'finished'>('all');

  app.store
    .loadAll()
    .then((d) => {
      tournaments = newestFirst(d.tournaments);
      players = d.players;
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
      .filter((r) => filter === 'all' || r.status === filter)
      .filter(({ t }) => !needle || [t.name, t.game, t.category, t.code].some((s) => s?.toLowerCase().includes(needle)));
  });
  const rows = $derived(matches.slice(0, shown));

  // ---- front page: what's on now, sign-ups, champions, top players
  const live = $derived(summaries.filter((r) => r.status === 'running').slice(0, 4));
  const openSignup = $derived(summaries.filter((r) => r.status === 'setup' && r.t.signup).slice(0, 4));
  const champions = $derived(summaries.filter((r) => r.champion).slice(0, 4));
  const counts = $derived({
    tournaments: summaries.length,
    running: summaries.filter((r) => r.status === 'running').length,
    players: players.length,
  });
  const top = $derived.by(() => {
    if (!tournaments?.length) return [];
    const me = app.account?.playerId;
    return ranked(rankings(tournaments, players).values(), 'rating')
      .filter((r) => r.rank !== null)
      .slice(0, 5)
      .map((r) => ({ ...r, anon: !!r.player.unranked && r.player.id !== me }));
  });
  const shared = app.store.kind === 'sheets';

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

  // "only organizers can create" (site security setting); re-read when the account changes
  const canCreate = $derived((void app.account, app.store.can('create')));

  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<div class="wrap page">
  <section class="hero">
    <div class="pitch">
      <p class="kicker">Free brackets for any game</p>
      <h1>Run the bracket.<br /><span class="hl">Fix any result.</span></h1>
      <p class="lede">
        Single and double elimination, round robin, Swiss, groups and finals. Players join with a code, report their own
        scores and climb the rankings. Wrong score? Change it and everything after it updates.
      </p>
      <div class="ctas">
        {#if canCreate}<a class="btn primary big" href="#/new">+ New tournament</a>{/if}
        <a class="btn big" href="#/players">See the rankings</a>
        {#if shared && !app.account}<a class="small acct" href="#/account">Log in or make an account</a>{/if}
      </div>
    </div>

    <form class="join panel" onsubmit={(e) => { e.preventDefault(); join(); }}>
      <label class="field">
        <span class="jlabel">Got a join code?</span>
        <span class="row">
          <input bind:value={code} placeholder="e.g. K7QM2X" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          <button class="primary" type="submit" disabled={!code.trim() || joining}>{joining ? 'Looking…' : 'Join'}</button>
        </span>
      </label>
      {#if joinError}<p class="small err">{joinError}</p>{/if}
      <p class="small muted">It's on the poster at the venue or in the organizer's message. You'll get a PIN to report your scores.</p>
    </form>
  </section>

  {#if counts.tournaments}
    <div class="stats" aria-label="On this site">
      <div><b class="num">{counts.tournaments}</b><span>tournaments</span></div>
      <div><b class="num">{counts.running}</b><span>live now</span></div>
      <div><b class="num">{counts.players}</b><span>players</span></div>
    </div>
  {/if}

  {#if live.length || openSignup.length || champions.length || top.length}
    <div class="board">
      {#if live.length}
        <section class="box">
          <h2><span class="dot" aria-hidden="true"></span>Live now</h2>
          <ul>
            {#each live as r (r.t.id)}
              <li>
                <a href="#/t/{r.t.id}">{r.t.name}</a>
                <span class="small muted">{r.t.game || FORMAT_LABEL[r.t.format]} · {r.played} of {r.total} matches</span>
                <span class="bar" aria-hidden="true"><span style="width: {r.total ? (100 * r.played) / r.total : 0}%"></span></span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if openSignup.length}
        <section class="box">
          <h2>Sign-up open</h2>
          <ul>
            {#each openSignup as r (r.t.id)}
              <li class="withbtn">
                <a href="#/j/{r.t.id}">{r.t.name}</a>
                <span class="small muted">
                  {[r.t.game, r.t.entrants.length + (r.t.maxPlayers ? ' / ' + r.t.maxPlayers : '') + ' joined'].filter(Boolean).join(' · ')}
                </span>
                <a class="btn small joinbtn" href="#/j/{r.t.id}">Join</a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if champions.length}
        <section class="box">
          <h2>Latest champions</h2>
          <ul>
            {#each champions as r (r.t.id)}
              <li>
                <b class="champ">{r.champion}</b>
                <span class="small muted">won <a href="#/t/{r.t.id}">{r.t.name}</a></span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if top.length}
        <section class="box">
          <h2>Top players</h2>
          <ol class="top">
            {#each top as r (r.player.id)}
              <li>
                <span class="rk num">{r.rank}</span>
                <span class="pl">{#if r.anon}<span class="muted">Anonymous</span>{:else}<a href="#/p/{r.player.id}">{r.player.name}</a><Verified id={r.player.id} />{/if}</span>
                <span class="num rt">{Math.round(r.rating)}</span>
              </li>
            {/each}
          </ol>
          <a class="small" href="#/players">Full rankings →</a>
        </section>
      {/if}
    </div>
  {/if}

  {#if (tournaments?.length ?? 0) < 6}
    <section class="how">
      <h2>How it works</h2>
      <ol>
        <li><b>Make a tournament.</b> Pick the format and scoring. Adding players is optional.</li>
        <li><b>Share the join code.</b> Print the QR poster or send the link. Players sign up and get a PIN.</li>
        <li><b>Play.</b> Players report scores, opponents confirm, and the bracket fills in by itself.</li>
        <li><b>Fix anything.</b> Change a result, a player or even the format; every change can be undone.</li>
      </ol>
    </section>
  {/if}

  <div class="head">
    <h2 class="listhead">All tournaments</h2>
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
  {:else if tournaments.length === 0}
    <div class="empty">
      <p>No tournaments yet. Be the first.</p>
      {#if canCreate}<a class="btn primary" href="#/new">Make a bracket</a>{/if}
    </div>
  {:else}
    <div class="filters" role="tablist">
      {#each [['all', 'All'], ['running', 'In progress'], ['setup', 'Not started'], ['finished', 'Finished']] as [k, label]}
        <button class="ghost small" class:on={filter === k} onclick={() => ((filter = k as typeof filter), (shown = PAGE))}>{label}</button>
      {/each}
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
  .page { padding-top: 28px; }
  .hero { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 32px; align-items: center; padding-bottom: 28px; border-bottom: 2px solid var(--ink); }
  .kicker { margin: 0 0 6px; font: 600 14px var(--font-cond); letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .hero h1 { font-size: clamp(40px, 7vw, 68px); line-height: 0.95; margin: 0 0 14px; }
  .hl { color: var(--accent); }
  .lede { margin: 0 0 20px; max-width: 560px; font-size: 17px; color: var(--ink-2); }
  .ctas { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .big { min-height: 48px; padding: 0 20px; font-size: 16px; display: inline-flex; align-items: center; }
  .acct { margin-left: 4px; }
  .join.panel { padding: 18px; display: grid; gap: 8px; border-color: var(--ink); }
  .join.panel p { margin: 0; }
  .jlabel { font: 700 20px var(--font-cond); text-transform: uppercase; letter-spacing: 0.02em; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--line); margin-bottom: 26px; }
  .stats > div { display: flex; align-items: baseline; gap: 8px; padding: 12px 4px; }
  .stats b { font: 700 30px var(--font-cond); }
  .stats span { color: var(--muted); font-size: 14px; }
  .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px 24px; margin: 26px 0 30px; }
  .box h2 { display: flex; align-items: center; gap: 8px; font-size: 20px; margin: 0 0 6px; padding-bottom: 6px; border-bottom: 2px solid var(--ink); }
  .box ul, .box ol { list-style: none; margin: 0 0 8px; padding: 0; }
  .box li { display: grid; gap: 2px; padding: 9px 0; border-bottom: 1px solid var(--line); position: relative; }
  .box li a:not(.btn) { font-weight: 600; text-decoration: none; }
  .box li a:not(.btn):hover { text-decoration: underline; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
  .withbtn { padding-right: 64px !important; }
  .joinbtn { position: absolute; right: 0; top: 50%; transform: translateY(-50%); min-height: 30px; padding: 0 10px; }
  .champ { font: 700 18px var(--font-cond); text-transform: uppercase; overflow-wrap: anywhere; }
  .top li { grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  .top .pl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .top .rk { font: 700 18px var(--font-cond); color: var(--muted); }
  .top li:first-child .rk { color: var(--accent); }
  .top .rt { font-weight: 600; }
  .how { margin: 26px 0 30px; }
  .how h2 { font-size: 20px; margin: 0 0 10px; }
  .how ol { margin: 0; padding: 0; list-style: none; counter-reset: step; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px 20px; }
  .how li { counter-increment: step; padding-top: 8px; border-top: 1px solid var(--line-strong); color: var(--ink-2); font-size: 15px; }
  .how li::before { content: counter(step, decimal-leading-zero); display: block; font: 700 26px var(--font-cond); color: var(--accent); }
  .how b { color: var(--ink); }
  .listhead { margin: 0; font-size: 26px; }
  @media (max-width: 760px) {
    .hero { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  }
  @media (max-width: 520px) {
    .stats b { font-size: 24px; }
    .stats > div { flex-direction: column; gap: 0; }
  }
  .head { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
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
  .none { padding: 14px 4px; }
  .notice { margin-bottom: 20px; }
  .join .row { flex-wrap: nowrap; }
  .join input { flex: 1; min-width: 0; font: 700 18px var(--font-cond); letter-spacing: 0.14em; text-transform: uppercase; }
  .join input::placeholder { letter-spacing: 0.05em; font-weight: 500; text-transform: none; }
  .err { color: var(--danger); margin: 6px 0 0; }
</style>

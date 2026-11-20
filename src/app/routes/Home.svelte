<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import TournamentRows from '../components/TournamentRows.svelte';
  import Verified from '../components/Verified.svelte';
  import { FORMAT_LABEL, STATUS_LABEL, summaryOf } from '../lib/model';
  import type { Player, TournamentDoc } from '../lib/model';
  import { ranked, rankings } from '../lib/ranking';

  const newestFirst = (list: TournamentDoc[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // what this device saw last time, until the sheet answers
  const seen = app.store.peekAll();
  let tournaments = $state<TournamentDoc[] | null>(seen ? newestFirst(seen.tournaments) : null);
  let players = $state<Player[]>(seen?.players ?? []);
  let error = $state('');

  app.store
    .loadAll()
    .then((d) => {
      tournaments = newestFirst(d.tournaments);
      players = d.players;
      app.noteVerified(d.players);
      error = '';
    })
    .catch((e) => (error = errorText(e)));

  const summaries = $derived((tournaments ?? []).map((t) => ({ t, ...summaryOf(t) })));
  const recent = $derived(summaries.slice(0, 6));

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
    const rows = ranked(rankings(tournaments.filter((t) => !topGame || t.game === topGame), players).values(), 'rating');
    // nobody has enough matches yet (a new site): show the leaders anyway, marked as still settling
    const anyRanked = rows.some((r) => r.rank !== null);
    return rows
      .filter((r) => r.rank !== null || (!anyRanked && r.rated > 0))
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

  // "only organizers can create" (site security setting); re-read when the account changes
  const canCreate = $derived((void app.account, app.store.can('create')));

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
                  {r.played} of {r.total}
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
                <span class="rk num">{r.rank ?? '–'}</span>
                <span class="pl">{#if r.anon}<span class="muted">Anonymous</span>{:else}<a href="#/p/{r.player.id}">{r.player.name}</a><Verified id={r.player.id} />{/if}</span>
                <span class="num rt" class:settling={r.rank === null}>{Math.round(r.rating)}</span>
              </li>
            {/each}
          </ol>
          {#if top[0].rank === null}<p class="small muted settle">Nobody is ranked yet: grey ratings are still settling.</p>{/if}
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
          {#if officials.length > 4}<a class="small more-link" href="#/tournaments">All {officials.length} official tournaments →</a>{/if}
        </section>
      {/if}
    </aside>
  </div>

  {#if error && tournaments}
    <p class="notice small">Can't reach the sheet ({error}). Showing what this device saw last time.</p>
  {:else if error}
    <p class="notice">Couldn't load tournaments: {error}</p>
  {/if}
  {#if app.store.kind === 'local'}
    <p class="notice small">
      Saved in this browser only. To share brackets with other people, connect a Google Sheet in
      <a href="#/admin">Admin settings</a>.
    </p>
  {/if}

  {#if recent.length}
    <section class="recent">
      <div class="head">
        <h2 class="listhead">Recent tournaments</h2>
        <a class="small" href="#/tournaments">All {summaries.length} tournaments, with filters →</a>
      </div>
      <TournamentRows rows={recent} />
    </section>
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
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }

  .joinbox { display: grid; gap: 6px; padding: 12px 14px 14px; border: 2px solid var(--ink); border-radius: var(--radius); background: var(--card); }
  .joinbox .sec-label { padding: 0; }
  .joinbox p { margin: 0; }
  .joinbox .row { flex-wrap: nowrap; }
  .joinbox input { flex: 1; min-width: 0; font: 700 20px var(--font-cond); letter-spacing: 0.16em; text-transform: uppercase; }
  .joinbox input::placeholder { color: var(--line-strong); }

  .lines, .top { list-style: none; margin: 0; padding: 0; }
  .lines li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 14px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .lines li > :nth-child(2) { grid-column: 1; }
  .lines li > :nth-child(3) { grid-column: 2; grid-row: 1 / span 2; }
  .lines.tight li { padding: 7px 0; }
  .lines a:not(.btn) { font-weight: 600; text-decoration: none; }
  .lines a:not(.btn):hover { text-decoration: underline; }
  .lines a.tname { font: 700 19px/1.15 var(--font-cond); text-transform: uppercase; }
  .champ { font: 700 17px var(--font-cond); text-transform: uppercase; }
  .prog { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-2); white-space: nowrap; }
  .bar { width: 48px; height: 5px; background: var(--line); border-radius: 1px; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--accent); }

  .top li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); }
  .top .pl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .top .pl a { font-weight: 600; text-decoration: none; }
  .top .rk { font: 700 17px var(--font-cond); color: var(--muted); }
  .top li:first-child .rk { color: var(--accent); }
  .top .rt { font-weight: 600; }
  .top .rt.settling { color: var(--muted); }
  .settle { margin: 6px 0 0; }
  .more-link { display: inline-block; margin-top: 8px; }
  .sec > p.small { margin: 8px 0 4px; }

  .start p { margin: 10px 0; max-width: 560px; color: var(--ink-2); }
  .start b { color: var(--ink); }

  @media (max-width: 860px) {
    .front { grid-template-columns: minmax(0, 1fr); }
    .main, .top-side, .low-side { grid-column: 1; grid-row: auto; }
    .main:not(:empty) { margin-top: 22px; }
  }

  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .listhead { margin: 0; font-size: 26px; }
  .notice { margin-bottom: 20px; }
  .err { color: var(--danger); margin: 0; }
</style>

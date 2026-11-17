<script lang="ts">
  import { onDestroy } from 'svelte';
  import { resolve } from '../../core';
  import type { ResolvedMatch } from '../../core';
  import { app, errorText } from '../lib/app.svelte';
  import { describeResult, FORMAT_LABEL, matchNumbers, nameMap, roundName, statusOf, toState } from '../lib/model';
  import type { TournamentDoc } from '../lib/model';
  import { myPin } from '../lib/store';

  /**
   * The page the door poster's QR code and the join code open, made for a phone in one hand:
   * sign up with just a name, then see your PIN, your waitlist place, check in, and your next match.
   * People with nothing to do here (sign-up closed, no check-in, not playing) go straight to the bracket.
   */
  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  let doc = $state<TournamentDoc | null>(null);
  let error = $state('');
  let missing = $state(false);

  async function load() {
    try {
      const r = await app.store.open(id, doc?.updatedAt);
      const d = r === 'same' ? doc : r.tournament;
      if (!d) missing = true;
      else if (!doc || d.version !== doc.version || d.updatedAt !== doc.updatedAt) doc = d;
      error = '';
    } catch (e) {
      error = errorText(e);
    }
  }
  load();
  let busy = $state(false);
  const poll = app.store.kind === 'sheets' ? setInterval(() => !busy && load(), 20000) : undefined;
  onDestroy(() => clearInterval(poll));

  const bracket = `#/t/${id}`;
  // re-read when the doc changes: signing up or checking in remembers the PIN on this device
  const mine = $derived.by(() => {
    void doc?.updatedAt;
    void app.accountSync; // logging in brings this player's PINs
    return myPin(id);
  });
  const results = $derived(doc ? Object.keys(doc.results).length : 0);
  const names = $derived(doc ? nameMap(doc) : new Map<string, string>());
  const entrant = $derived(!!doc && !!mine && doc.entrants.some((e) => e.id === mine.playerId));
  const waitPlace = $derived(doc && mine ? (doc.waitlist ?? []).findIndex((w) => w.id === mine.playerId) + 1 : 0);
  const open = $derived(!!doc?.signup && !!app.store.signup && results === 0);
  const checkInOpen = $derived(!!doc?.checkIn && !!app.store.checkin && results === 0);
  const here = $derived(!!mine && !!doc?.checkedIn?.includes(mine.playerId));
  const full = $derived(!!doc?.maxPlayers && (doc.entrants.length >= doc.maxPlayers || (doc.waitlist?.length ?? 0) > 0));
  const waiting = $derived(doc?.waitlist?.length ?? 0);
  const dropped = $derived(
    !!doc && entrant && (doc.options.dropped ?? []).includes(doc.entrants.findIndex((e) => e.id === mine!.playerId) + 1),
  );

  // nothing to do here: go to the bracket (a spectator scanning the poster after sign-up closed)
  $effect(() => {
    if (doc && !entrant && !waitPlace && !open && !checkInOpen) location.replace(bracket);
  });

  // ---- my matches (once the bracket exists)
  const resolved = $derived(doc && doc.entrants.length >= 2 ? resolve(toState(doc)) : new Map<string, ResolvedMatch>());
  const numbers = $derived(matchNumbers(resolved));
  const templates = $derived([...resolved.values()].map((m) => m.template));
  const myMatches = $derived(
    entrant ? [...resolved.values()].filter((m) => m.p1 === mine!.playerId || m.p2 === mine!.playerId) : [],
  );
  const finished = $derived(!!doc && statusOf(doc) === 'finished');
  /** The opponent reported a score and is waiting for me to confirm it. */
  const toConfirm = $derived(
    myMatches.filter((m) => m.status === 'done' && m.result?.status === 'reported' && m.result.reportedBy !== mine!.playerId),
  );
  const next = $derived(
    finished || dropped
      ? undefined
      : myMatches
          .filter((m) => m.status === 'ready')
          .sort((a, b) => (numbers.get(a.template.id) ?? 0) - (numbers.get(b.template.id) ?? 0))[0],
  );
  /** Swiss: sitting out the round being played now. */
  const byeNow = $derived.by(() => {
    if (next || doc?.format !== 'swiss') return false;
    const paired = [...resolved.values()].filter((m) => m.template.side === 'SW' && m.p1 !== null);
    const round = Math.max(0, ...paired.map((m) => m.template.round));
    return myMatches.some((m) => m.template.round === round && m.status === 'bye' && !m.walkover);
  });
  const opponent = (m: ResolvedMatch) => names.get((m.p1 === mine!.playerId ? m.p2 : m.p1) ?? '') ?? 'TBD';
  const what = (m: ResolvedMatch) =>
    `Match ${numbers.get(m.template.id)} · ${roundName(m.template, templates, doc!.format)}`;

  // ---- actions
  let name = $state('');
  let pin = $state('');
  let havePin = $state(false);
  /** Logged in, but signing up someone else by name. */
  let byName = $state(false);
  let actionError = $state('');

  async function act(fn: () => Promise<TournamentDoc>, done?: string) {
    busy = true;
    actionError = '';
    try {
      doc = await fn();
      if (done) app.notify(done);
    } catch (e) {
      actionError = errorText(e);
    } finally {
      busy = false;
    }
  }
  /** Sign up by name, or (no name) as the logged-in account. */
  function join(asAccount = false) {
    if ((!asAccount && !name.trim()) || !app.store.signup) return;
    act(async () => {
      const r = await app.store.signup!(id, asAccount ? undefined : name.trim());
      app.notify(r.waitlisted ? "You're on the waitlist" : "You're in");
      return r.tournament;
    });
  }
  const checkIn = (who: { pin: string }, arrived: boolean) =>
    act(() => app.store.checkin!(id, who, arrived), arrived ? "You're checked in" : 'Check-in undone');
</script>

{#snippet nextCard(m: ResolvedMatch)}
  <section class="card act">
    <div class="label">{results ? 'Your next match' : 'Your first match'} · {what(m)}</div>
    <div class="who">vs {opponent(m)}</div>
    <a class="btn primary big" href="#/t/{id}/matches/{m.template.id}">Report the result</a>
  </section>
{/snippet}

<div class="wrap page">
  {#if missing}
    <p class="empty">This tournament doesn't exist (or was deleted). <a href="#/">See all tournaments</a></p>
  {:else if error && !doc}
    <p class="notice">Couldn't load: {error}</p>
  {:else if !doc}
    <p class="muted">Loading…</p>
  {:else}
    <header>
      <div class="label">{[doc.game, FORMAT_LABEL[doc.format]].filter(Boolean).join(' · ')}</div>
      <h1>{doc.name}</h1>
      <p class="spots">
        {#if results}
          {finished ? 'Finished' : 'In progress'} · {doc.entrants.length} players
        {:else if doc.maxPlayers}
          {#if doc.entrants.length < doc.maxPlayers && !waiting}
            <b>{doc.maxPlayers - doc.entrants.length}</b> of {doc.maxPlayers} spots left
          {:else}
            <b>Full</b> · {waiting} on the waitlist
          {/if}
        {:else if !doc.entrants.length}
          No one has signed up yet
        {:else}
          <b>{doc.entrants.length}</b> {doc.entrants.length === 1 ? 'player' : 'players'} signed up
        {/if}
      </p>
    </header>

    {#if entrant || waitPlace}
      <!-- once play starts, what to do next comes first -->
      {#each toConfirm as m (m.template.id)}
        <section class="card act">
          <div class="label">{what(m)}</div>
          <p>
            {names.get(m.result!.reportedBy!) ?? 'Your opponent'} reported <b>{describeResult(m.result, names)}</b>. Is that right?
          </p>
          <a class="btn primary big" href="#/t/{id}/matches/{m.template.id}">Check it</a>
        </section>
      {/each}
      {#if next && results > 0}
        {@render nextCard(next)}
      {/if}

      {#if results > 0}
        <section class="card">
          {#if entrant}
            <p>Playing as <b>{names.get(mine!.playerId)}</b>. Your PIN is <b class="pinsm">{mine!.pin}</b>.</p>
          {:else}
            <p>
              On the waitlist as <b>{doc.waitlist![waitPlace - 1].name}</b> (number {waitPlace}). Your PIN is
              <b class="pinsm">{mine!.pin}</b>. The tournament has started, so no more spots open up.
            </p>
          {/if}
          {#if dropped}<p class="small"><b>You dropped out.</b> Your results stay in the standings.</p>{/if}
          {#if !next && !toConfirm.length && !dropped && entrant}
            <p class="small muted">{finished
              ? 'The tournament is over. Thanks for playing!'
              : byeNow
                ? 'You have a bye this round: it counts as a win. Your next match shows here once it\'s paired.'
                : 'No match for you right now. Your next one shows here when it\'s ready.'}</p>
          {/if}
        </section>
      {:else}
      <section class="card you">
        {#if entrant}
          <div class="label">You're in</div>
          <div class="who">{names.get(mine!.playerId)}</div>
        {:else}
          <div class="label">You're on the waitlist</div>
          <div class="who">{doc.waitlist![waitPlace - 1].name} <span class="place">number {waitPlace}</span></div>
          <p class="small muted">If a spot opens, the organizer moves people up in order.</p>
        {/if}
        <div class="pinline">
          <span class="small">Your PIN</span>
          <span class="pin">{mine!.pin}</span>
        </div>
        <p class="small muted">
          You need it to report your scores. {app.account ? 'Your account keeps it: log in on any phone to get it back.' : 'This phone remembers it; write it down in case you switch phones.'}
        </p>
      </section>
      {/if}

      {#if checkInOpen}
        <section class="card">
          {#if here}
            <p class="done">You're checked in.</p>
            <button class="ghost small" disabled={busy} onclick={() => checkIn({ pin: mine!.pin }, false)}>Undo</button>
          {:else}
            <p class="small">Check in when you get there so the organizer knows you came.</p>
            <button class="accent big" disabled={busy} onclick={() => checkIn({ pin: mine!.pin }, true)}>I'm here</button>
          {/if}
        </section>
      {/if}

      {#if next && results === 0}
        {@render nextCard(next)}
      {/if}
    {:else if open && app.account && !byName}
      <section class="card">
        <button class="primary big" disabled={busy} onclick={() => join(true)}>
          {busy ? 'Joining…' : `${full ? 'Join the waitlist' : 'Join'} as ${app.account.name}`}
        </button>
        {#if full}<p class="small muted">All spots are taken. You'll get a place on the waitlist.</p>{/if}
        <button class="ghost small linkish" onclick={() => (byName = true)}>Join under another name or as a team</button>
      </section>
    {:else if open}
      <form class="card" onsubmit={(e) => { e.preventDefault(); join(); }}>
        <label class="field">
          <span>Your name or team</span>
          <input class="big" bind:value={name} maxlength="60" autocomplete="name" enterkeyhint="go" />
        </label>
        <button class="primary big" type="submit" disabled={!name.trim() || busy}>
          {busy ? 'Joining…' : full ? 'Join the waitlist' : 'Join'}
        </button>
        {#if full}<p class="small muted">All spots are taken. You'll get a PIN and a place on the waitlist.</p>{/if}
        {#if app.store.login && !app.account}
          <p class="small muted">Have an account? <a href="#/account/j/{id}">Log in</a> to join with one tap.</p>
        {/if}
      </form>
    {/if}

    {#if !entrant && !waitPlace && checkInOpen && open && !havePin}
      <button class="ghost small linkish" onclick={() => (havePin = true)}>Already signed up on another phone?</button>
    {:else if !entrant && !waitPlace && checkInOpen}
      <form class="card" onsubmit={(e) => { e.preventDefault(); checkIn({ pin: pin.trim() }, true); }}>
        <label class="field">
          <span>{open ? 'Already signed up? Check in with your PIN' : 'Check in with your PIN'}</span>
          <input class="big pinbox" bind:value={pin} inputmode="numeric" autocomplete="off" maxlength="6" placeholder="6 digits" />
        </label>
        <button class="accent big" type="submit" disabled={busy || !/^\d{6}$/.test(pin.trim())}>I'm here</button>
      </form>
    {/if}

    {#if actionError}<p class="err">{actionError}</p>{/if}

    <a class="btn big" href={bracket}>{results ? 'Bracket and standings' : 'See the tournament page'}</a>
  {/if}
</div>

<style>
  .page { padding-top: 20px; padding-bottom: 40px; max-width: 480px; display: grid; gap: 14px; }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 12px; }
  h1 { margin: 4px 0 6px; font-size: 34px; line-height: 1.05; overflow-wrap: anywhere; }
  .spots { margin: 0; font-size: 16px; }
  .spots b { font: 700 20px var(--font-cond); color: var(--accent); }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 16px;
    display: grid;
    gap: 12px;
  }
  .card p { margin: 0; }
  .you { border: 2px solid var(--ink); }
  .who { font: 700 24px/1.15 var(--font-cond); overflow-wrap: anywhere; }
  .place { font-weight: 500; color: var(--muted); font-size: 18px; }
  .pinline { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
  .pin { font: 700 40px/1 var(--font-cond); letter-spacing: 0.14em; color: var(--accent); font-variant-numeric: tabular-nums; }
  .big { min-height: 52px; font-size: 18px; width: 100%; }
  input.big { padding: 12px 14px; }
  .pinbox { letter-spacing: 0.2em; font-variant-numeric: tabular-nums; }
  .done { font-weight: 600; }
  .act { border-left: 3px solid var(--accent); }
  .pinsm { font: 700 20px var(--font-cond); letter-spacing: 0.12em; color: var(--accent); }
  .linkish { justify-self: start; text-decoration: underline; padding: 0 2px; }
  .err { color: var(--danger); margin: 0; }
</style>

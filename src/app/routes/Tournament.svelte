<script lang="ts">
  import { gameOf } from '../lib/games';
  import { onDestroy } from 'svelte';
  import { applyEdit, groupStandings, resolve, undo } from '../../core';
  import type { Decision, ResolvedMatch, ResultInput } from '../../core';
  import Bracket from '../components/Bracket.svelte';
  import EditTournament from '../components/EditTournament.svelte';
  import OfficialPanel from '../components/OfficialPanel.svelte';
  import type { OfficialState } from '../lib/store';
  import FinalsPanel from '../components/FinalsPanel.svelte';
  import Verified from '../components/Verified.svelte';
  import TierTag from '../components/TierTag.svelte';
  import OfficialTag from '../components/OfficialTag.svelte';
  import LogView from '../components/LogView.svelte';
  import MatchList from '../components/MatchList.svelte';
  import MatchSheet from '../components/MatchSheet.svelte';
  import SharePanel from '../components/SharePanel.svelte';
  import SignUp from '../components/SignUp.svelte';
  import Standings from '../components/Standings.svelte';
  import Waitlist from '../components/Waitlist.svelte';
  import CheckIn from '../components/CheckIn.svelte';
  import DropPanel from '../components/DropPanel.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import {
    categoryOf, championOf, describeResult, divisionOf, FORMAT_LABEL, OPEN, hasFinals, isTableFormat, logEntry, matchNumbers, nameMap, newId, pointsStageName,
    progressOf, restorePoint, roundName, standingOptions, STATUS_LABEL, statusOf, tierOf, toState, withEntrants,
  } from '../lib/model';
  import type { LogEntry, Player, TournamentDoc } from '../lib/model';
  import { createSaveQueue } from '../lib/saveQueue';
  import { announcements } from '../lib/announce';
  import { myPin, rememberOrgKey, VersionConflictError } from '../lib/store';

  interface Props {
    id: string;
    tab: string;
    /** Extra path part: the organizer key in a helper link (#/t/<id>/org/<key>). */
    arg?: string;
  }
  let { id, tab, arg }: Props = $props();

  // Helper link: keep the key on this device, then drop it from the address bar.
  if (tab === 'org' && arg) {
    rememberOrgKey(id, arg);
    location.replace(`#/t/${id}/edit`);
    app.notify('You can now edit this tournament on this device');
  }

  /** Organizer or helper of this tournament on this device, or the site admin. */
  const canEdit = $derived.by(() => {
    void app.accountSync; // the account brought a key, or this device lost one
    return app.store.canEdit(id);
  });

  // What this device saw last time: shown at once while the sheet answers (4–6 s).
  const cached = app.store.peek(id);
  let doc = $state<TournamentDoc | null>(cached?.tournament ?? null);
  /** The doc shown has its log (a copy from the tournament list doesn't, so asking "changed?" would never bring it). */
  let full = cached?.full ?? false;
  /** The sheet has answered since the page opened (local mode: always). */
  let fresh = $state(app.store.kind === 'local');
  /** When the sheet last answered (ms), for "updated 12 s ago". */
  let checkedAt = $state(0);
  // this device's PIN here; logging in (account sync) can bring one
  const myPinNow = $derived.by(() => {
    void app.accountSync;
    void doc?.updatedAt;
    return myPin(id);
  });
  let players = $state<Player[]>(cached?.players ?? []);
  app.noteVerified(players);
  let missing = $state(false);
  let error = $state('');
  // #/t/<id>/matches/<matchId> opens that match (links from the sign-up page)
  let openMatch = $state<string | null>(tab === 'matches' && arg ? arg : null);
  let saving = $state(false);
  /** Organizer saves still on their way to the sheet (the page already shows them). */
  let pendingSaves = $state(0);

  /** Add or update players by id (the page keeps every player it has been sent). */
  const withPlayers = (list: Player[]) => {
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const p of list) byId.set(p.id, p);
    players = [...byId.values()];
    app.noteVerified(list);
  };

  async function load() {
    try {
      // only this tournament, and nothing at all when it hasn't changed
      const r = await app.store.open(id, full ? doc?.updatedAt : undefined);
      if (r !== 'same') {
        withPlayers(r.players);
        const d = r.tournament;
        if (!d) missing = true;
        else {
          full = true;
          queue.confirmed = d;
          // don't undo changes the page shows that are still being saved
          // (check-ins change updatedAt but not the version: they don't touch the bracket)
          if (!queue.pending && (!doc || d.version !== doc.version || d.updatedAt !== doc.updatedAt)) doc = d;
        }
      } else if (doc && !queue.confirmed) queue.confirmed = doc;
      error = '';
      fresh = true;
      checkedAt = Date.now();
    } catch (e) {
      error = errorText(e);
    }
  }

  // Organizer changes show at once and go to the sheet in the background, one after another.
  const queue = createSaveQueue<TournamentDoc, { created: Player[]; announce: string[] }>({
    send: (d, m) => app.store.save(d, m?.created ?? [], m?.announce),
    onSaved: (saved, left) => {
      checkedAt = Date.now();
      if (!left) doc = saved;
    },
    onFailed: (e) => {
      // put back what the sheet has, then look for anything newer
      if (queue.confirmed) doc = queue.confirmed;
      app.notify(`Not saved: ${errorText(e)}`, 'error');
      load();
    },
    onPending: (n) => (pendingSaves = n),
  });
  const firstLoad = load();

  // The Edit tab matches typed names to people who played before: it needs every player.
  let allPlayers = false;
  $effect(() => {
    if (tab !== 'edit' || !canEdit || allPlayers) return;
    allPlayers = true;
    app.store.players().then(withPlayers, () => (allPlayers = false));
  });

  // Viewers of a shared sheet see updates without refreshing.
  const poll = app.store.kind === 'sheets' ? setInterval(() => !openMatch && !saving && !pendingSaves && tab !== 'edit' && load(), 20000) : undefined;
  onDestroy(() => clearInterval(poll));

  // "updated 12 s ago" keeps counting
  let now = $state(Date.now());
  const tick = app.store.kind === 'sheets' ? setInterval(() => (now = Date.now()), 5000) : undefined;
  onDestroy(() => clearInterval(tick));
  const ago = $derived.by(() => {
    const s = Math.max(0, Math.round((now - checkedAt) / 1000));
    return s < 10 ? 'just now' : s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
  });

  // A bracket needs 2 players; with sign-up open there may be fewer for a while.
  const tstate = $derived(doc && doc.entrants.length >= 2 ? toState(doc) : null);
  const resolved = $derived(tstate ? resolve(tstate) : new Map<string, ResolvedMatch>());
  const names = $derived(doc ? nameMap(doc, players) : new Map<string, string>());
  const seeds = $derived(new Map((doc?.entrants ?? []).map((e, i) => [e.id, i + 1])));
  const numbers = $derived(matchNumbers(resolved));
  const status = $derived(doc ? statusOf(doc) : 'setup');
  const conflicts = $derived([...resolved.values()].filter((m) => m.status === 'conflict').length);
  const disputed = $derived([...resolved.values()].filter((m) => m.status === 'done' && m.result?.status === 'disputed'));
  const champion = $derived.by(() => {
    if (!tstate || !doc || status !== 'finished') return null;
    // only a clear winner, not a tie for first
    return championOf(doc, tstate);
  });
  const progress = $derived(progressOf(resolved));
  /** Groups format: each group's table, shown next to its rounds. */
  const groupTables = $derived(doc?.format === 'groups' && tstate ? groupStandings(tstate, standingOptions(doc)) : undefined);
  const draws = $derived(Object.values(doc?.results ?? {}).some((r) => r.winner === 'draw'));

  // phones: keep the open tab in view when the tab row scrolls
  let tabRow = $state<HTMLElement>();
  $effect(() => {
    void tab;
    tabRow?.querySelector<HTMLElement>('a.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  const titleOf = (m: ResolvedMatch) => (tstate && doc ? roundName(m.template, tstate.structure.matches, doc.format) : '');

  /**
   * Show a change at once and save it in the background. True = accepted (if the sheet then
   * refuses it, the page goes back to the sheet's copy and says so).
   */
  /** Lines for the tournament's Discord channel about this change (none if it has no channel). */
  function news(prev: TournamentDoc | null, next: TournamentDoc): string[] {
    if (!prev?.discord || app.store.kind !== 'sheets') return [];
    try {
      return announcements(prev, next, `${location.href.split('#')[0]}#/t/${next.id}`, players);
    } catch {
      return []; // never let an announcement stop a save
    }
  }

  async function persist(next: TournamentDoc, created: Player[] = []): Promise<boolean> {
    const announce = news(doc, next);
    doc = next;
    if (created.length) withPlayers(created);
    // changes made on a copy this device had saved wait until the sheet has answered once
    void queue.push(next, firstLoad, { created, announce });
    return true;
  }

  /** Organizer connects (or, with '', disconnects) a Discord channel. */
  async function setOfficial(fn: () => Promise<OfficialState>, done: string) {
    if (!doc) return false;
    try {
      await queue.idle();
      const r = await fn();
      doc = { ...doc, ...r };
      if (queue.confirmed) queue.confirmed = { ...queue.confirmed, ...r };
      app.notify(done);
      return true;
    } catch (e) {
      app.notify(errorText(e), 'error');
      return false;
    }
  }

  async function setDiscord(url: string) {
    if (!doc || !app.store.discord) return false;
    try {
      await queue.idle();
      const on = await app.store.discord(id, url);
      doc = { ...doc, discord: on };
      if (queue.confirmed) queue.confirmed = { ...queue.confirmed, discord: on };
      app.notify(on ? 'Discord connected: a test message was posted in the channel' : 'Discord disconnected');
      return true;
    } catch (e) {
      app.notify(errorText(e), 'error');
      return false;
    }
  }

  /** A tournament the sheet just sent back after a player's action: it's now the sheet's copy. */
  function fromSheet(d: TournamentDoc) {
    queue.confirmed = d;
    doc = d;
    checkedAt = Date.now();
  }

  async function saveResult(matchId: string, input: ResultInput | null, decisions: Record<string, Decision>) {
    if (!doc || !tstate) return false;
    const out = applyEdit(tstate, matchId, input && { ...input, at: new Date().toISOString() }, decisions);
    if (!out.changes.length) return true;
    const main = out.changes.find((c) => c.matchId === matchId);
    const extra = out.changes.length - (main ? 1 : 0);
    const summary =
      `Match ${numbers.get(matchId)}: ` +
      (input ? describeResult(main?.after ?? out.results[matchId], names) : 'result cleared') +
      (extra ? ` (+${extra} later match${extra === 1 ? '' : 'es'} updated)` : '');
    const entry: LogEntry = { id: newId(), time: new Date().toISOString(), summary, changes: out.changes };
    const ok = await persist({ ...doc, results: out.results, options: out.options, log: [...doc.log, entry] });
    // shared mode: the header says when it has reached the sheet
    if (ok && app.store.kind === 'local') app.notify('Saved');
    return ok;
  }

  /** A player reports their own match (shared mode). The sheet checks the PIN. */
  async function reportResult(matchId: string, input: ResultInput, pin: string) {
    if (!doc || !tstate || !app.store.report) return false;
    const m = resolved.get(matchId);
    if (!m || typeof m.p1 !== 'string' || typeof m.p2 !== 'string') return false;
    saving = true;
    try {
      await queue.idle();
      const { winner, score1, score2 } = input;
      fromSheet(await app.store.report(id, matchId, pin, { winner, score1, score2, p1: m.p1, p2: m.p2 }, numbers.get(matchId)));
      app.notify('Result reported');
      return true;
    } catch (e) {
      app.notify(errorText(e), 'error');
      if (e instanceof VersionConflictError) await load();
      return false;
    } finally {
      saving = false;
    }
  }

  /** The opponent confirms or disputes a reported result (shared mode). The sheet checks the PIN. */
  async function confirmReport(matchId: string, ok: boolean, pin: string) {
    if (!app.store.confirm) return false;
    saving = true;
    try {
      await queue.idle();
      const r0 = doc?.results[matchId];
      const announce = ok && doc && r0 ? news(doc, { ...doc, results: { ...doc.results, [matchId]: { ...r0, status: 'confirmed' } } }) : [];
      fromSheet(await app.store.confirm(id, matchId, pin, ok, numbers.get(matchId), announce));
      app.notify(ok ? 'Result confirmed' : 'Result disputed: the organizer will settle it');
      return true;
    } catch (e) {
      app.notify(errorText(e), 'error');
      if (e instanceof VersionConflictError) await load();
      return false;
    } finally {
      saving = false;
    }
  }

  async function setSignup(open: boolean) {
    if (!doc) return false;
    const entry: LogEntry = { id: newId(), time: new Date().toISOString(), summary: open ? 'Sign-up opened' : 'Sign-up closed', changes: [] };
    const ok = await persist({ ...doc, signup: open, log: [...doc.log, entry] });
    if (ok) app.notify(open ? 'Sign-up is open' : 'Sign-up is closed');
    return ok;
  }

  /** Organizer sets the most players self sign-up lets in (0 = no limit). */
  async function setMaxPlayers(max: number) {
    if (!doc) return false;
    const summary = max ? `Player limit set to ${max}` : 'Player limit removed';
    const ok = await persist({ ...doc, maxPlayers: max || undefined, log: [...doc.log, logEntry(summary)] });
    if (ok) app.notify(summary);
    return ok;
  }

  /** Organizer moves someone up from the waitlist: they become the last seed. Undoable from the log. */
  async function promote(p: Player) {
    if (!doc) return false;
    const entry = logEntry(`${p.name} moved up from the waitlist`, { restore: restorePoint(doc) });
    const ok = await persist({ ...doc, ...withEntrants(doc, [...doc.entrants, p]), log: [...doc.log, entry] });
    if (ok) app.notify(`${p.name} is in`);
    return ok;
  }

  async function setCheckIn(on: boolean) {
    if (!doc) return false;
    const summary = on ? 'Check-in opened' : 'Check-in closed';
    const ok = await persist({ ...doc, checkIn: on, log: [...doc.log, logEntry(summary)] });
    if (ok) app.notify(summary);
    return ok;
  }

  /** Organizer, before round 1: everyone who hasn't checked in leaves the bracket. Undoable from the log. */
  async function removeNoShows() {
    if (!doc) return false;
    const here = new Set(doc.checkedIn ?? []);
    const gone = doc.entrants.filter((e) => !here.has(e.id));
    if (!gone.length) return true;
    const summary = `Removed ${gone.length} no-show${gone.length === 1 ? '' : 's'}: ${gone.map((e) => names.get(e.id) ?? e.name).join(', ')}`;
    const entry = logEntry(summary, { restore: restorePoint(doc) });
    const ok = await persist({ ...doc, ...withEntrants(doc, doc.entrants.filter((e) => here.has(e.id))), log: [...doc.log, entry] });
    if (ok) app.notify(`${gone.length} removed`);
    return ok;
  }

  /** Organizer drops a player (or brings them back). Only options.dropped changes. Undoable from the log. */
  async function setDropped(playerId: string, out: boolean) {
    if (!doc) return false;
    const seed = doc.entrants.findIndex((e) => e.id === playerId) + 1;
    const now = new Set(doc.options.dropped ?? []);
    if (out) now.add(seed);
    else now.delete(seed);
    // from tstate: includes any swiss round a player reported into that isn't stored as frozen yet
    const { dropped: _, ...rest } = tstate?.options ?? doc.options;
    const options = now.size ? { ...rest, dropped: [...now].sort((a, b) => a - b) } : rest;
    const name = names.get(playerId) ?? '?';
    const entry = logEntry(out ? `${name} dropped out (by the organizer)` : `${name} is back in`, { restore: restorePoint(doc) });
    const ok = await persist({ ...doc, options, log: [...doc.log, entry] });
    if (ok) app.notify(out ? `${name} dropped` : `${name} is back in`);
    return ok;
  }

  /** Organizer confirms who goes to the finals (or clears them to pick again). Undoable from the log. */
  async function setFinalists(qualified: number[] | null) {
    if (!doc?.options.finals) return false;
    const { qualified: _old, ...finals } = doc.options.finals;
    const next = { ...doc, options: { ...doc.options, finals: qualified ? { ...finals, qualified } : finals } };
    const { name, game, format, options, scoring, entrants, results } = doc;
    const category = doc.category ?? '';
    const division = doc.division ?? '';
    const tier = tierOf(doc);
    const summary = qualified
      ? `Finals started: ${qualified.map((s) => names.get(doc!.entrants[s - 1].id)).join(', ')}`
      : 'Finalists cleared';
    const entry: LogEntry = {
      id: newId(), time: new Date().toISOString(), summary, changes: [],
      restore: { name, game, category, division, tier, format, options, scoring, entrants, results },
    };
    const ok = await persist({ ...next, log: [...doc.log, entry] });
    if (ok) app.notify(qualified ? 'Finals started' : 'Pick the finalists again');
    return ok;
  }

  async function undoEntry(entry: LogEntry) {
    if (!doc || !tstate) return;
    const later = doc.log.slice(doc.log.findIndex((e) => e.id === entry.id) + 1).filter((e) => !e.undone);
    const warn = later.length ? `\n\n${later.length} newer change(s) exist. Matches that depended on this will be reset.` : '';
    if (!confirm(`Undo "${entry.summary}"?${warn}`)) return;

    let next: TournamentDoc;
    let changes: LogEntry['changes'] = [];
    if (entry.restore) {
      next = { ...doc, ...entry.restore };
    } else {
      const out = undo(tstate, entry.changes);
      changes = out.changes;
      next = { ...doc, results: out.results, options: out.options };
    }
    const log = doc.log.map((e) => (e.id === entry.id ? { ...e, undone: true } : e));
    log.push({ id: newId(), time: new Date().toISOString(), summary: `Undo: ${entry.summary}`, changes });
    if (await persist({ ...next, log })) app.notify('Undone');
  }

  async function applyEditTournament(next: TournamentDoc, created: Player[], entry: LogEntry) {
    const ok = await persist({ ...next, log: [...next.log, entry] }, created);
    if (ok) {
      app.notify('Tournament updated');
      app.go(`t/${id}`);
    }
    return ok;
  }

  async function remove() {
    if (!doc || !confirm(`Delete "${doc.name}"? Its matches disappear from player history too. This can't be undone.`)) return;
    try {
      await app.store.remove(doc.id);
      app.notify('Deleted');
      app.go('tournaments');
    } catch (e) {
      app.notify(errorText(e), 'error');
    }
  }

  async function share() {
    const url = location.href.split('#')[0] + `#/t/${id}`;
    try {
      if (navigator.share) await navigator.share({ title: doc?.name, url });
      else {
        await navigator.clipboard.writeText(url);
        app.notify('Link copied');
      }
    } catch {
      /* cancelled */
    }
  }

  const tabs = $derived([
    ['bracket', doc && isTableFormat(doc.format) ? pointsStageName(doc.format) : 'Bracket'],
    ...(doc && hasFinals(doc) ? [['finals', 'Finals']] : []),
    ['matches', 'Matches'],
    ['standings', 'Standings'],
    ['log', 'Log'],
    ...(canEdit ? [['edit', 'Edit']] : []),
  ]);
</script>

{#if missing}
  <div class="wrap page"><div class="empty">This tournament doesn't exist (or was deleted). <a href="#/tournaments">Back to list</a></div></div>
{:else if error && !doc}
  <div class="wrap page"><p class="notice">Couldn't load: {error}</p></div>
{:else if !doc}
  <div class="wrap page"><p class="muted">Loading…</p></div>
{:else}
  <div class="wrap page">
    <div class="titlebar">
      <div class="label">
        <OfficialTag official={doc.official} />
        <TierTag tier={doc.tier} />
        {[
          gameOf(doc),
          categoryOf(doc),
          divisionOf(doc) === OPEN ? '' : divisionOf(doc),
          FORMAT_LABEL[doc.format],
          `${doc.entrants.length}${doc.maxPlayers ? ` / ${doc.maxPlayers}` : ''} ${doc.entrants.length === 1 && !doc.maxPlayers ? 'entrant' : 'entrants'}`,
        ].filter(Boolean).join(' · ')}
      </div>
      <div class="actions no-print">
        <button class="small" onclick={share}>Share</button>
        <button class="small print" onclick={() => print()}>Print</button>
      </div>
    </div>
    <h1>{doc.name}</h1>
    <div class="row meta">
      <span class="status s-{status}">{STATUS_LABEL[status]}</span>
      {#if status === 'running' && progress.total}
        <span class="progress small" title="Matches played">
          <span class="bar" aria-hidden="true"><span style="width: {(100 * progress.played) / progress.total}%"></span></span>
          <span><b>{progress.played}</b> of {progress.total} matches played</span>
        </span>
      {/if}
      {#if doc.code && app.store.kind === 'sheets'}<span class="small muted">Code <b class="jcode">{doc.code}</b></span>{/if}
      {#if champion}<span class="champ"><span class="label">Champion</span> <a class="champname" href="#/p/{champion}"><b>{names.get(champion)}</b></a><Verified id={champion} /></span>{/if}
      {#if saving || pendingSaves}
        <span class="live small saving">Saving…</span>
      {:else if app.store.kind === 'sheets'}
        <span class="live small muted" title="This page checks the sheet for changes every 20 seconds">
          {#if !fresh}{error ? "Can't reach the sheet: showing this device's copy" : 'Updating…'}
          {:else if error}Can't reach the sheet · last updated {ago}
          {:else}Live · updated {ago}{/if}
        </span>
      {/if}
    </div>

    {#if conflicts}
      <p class="notice">
        {conflicts} match{conflicts === 1 ? ' needs' : 'es need'} checking: the players changed after the result was entered
        (probably edited directly in the sheet). Open {conflicts === 1 ? 'it' : 'them'} from the Matches tab.
      </p>
    {/if}

    {#if disputed.length}
      <p class="notice">
        {disputed.length} result{disputed.length === 1 ? ' is' : 's are'} disputed:
        {disputed.map((m) => `match ${numbers.get(m.template.id)}`).join(', ')}.
        {canEdit ? 'Check with the players, then open it from the Matches tab and save the right result.' : 'The organizer will settle it.'}
      </p>
    {/if}

    <SignUp {doc} {names} finished={status === 'finished'} onjoined={fromSheet} />
    {#if doc.checkIn && app.store.checkin && status === 'setup' && Object.keys(doc.results).length === 0 && doc.entrants.length}
      <CheckIn {doc} {names} {canEdit} onchange={fromSheet} onnoshows={removeNoShows} />
    {/if}
    <Waitlist {doc} {canEdit} onpromote={promote} />

    <nav class="tabs no-print" bind:this={tabRow}>
      {#each tabs as [key, label] (key)}
        <a href="#/t/{id}{key === 'bracket' ? '' : '/' + key}" class:on={tab === key}>{label}</a>
      {/each}
    </nav>

    <div class="body">
      {#if tab === 'edit' && canEdit}
        {#if app.store.kind === 'sheets'}<SharePanel {doc} {names} onsignup={setSignup} onmax={setMaxPlayers} oncheckin={setCheckIn} ondiscord={setDiscord} />{/if}
        {#if status !== 'setup' && tstate}<DropPanel {doc} {names} ondrop={setDropped} />{/if}
        <OfficialPanel {doc} onchange={setOfficial} />
        {#key doc.version}
          <EditTournament {doc} known={players} {names} onapply={applyEditTournament} ondelete={remove} />
        {/key}
      {:else if tab === 'log'}
        <LogView log={doc.log} {names} {numbers} {canEdit} onundo={undoEntry} />
      {:else if !tstate}
        <div class="empty">
          Waiting for players: {doc.entrants.length} so far. The {isTableFormat(doc.format) ? 'rounds appear' : 'bracket appears'} once there are 2.
        </div>
      {:else if tab === 'matches'}
        <MatchList {resolved} {names} {numbers} {titleOf} onselect={(m) => (openMatch = m)} />
      {:else if tab === 'standings'}
        <Standings {doc} {tstate} {names} />
      {:else if tab === 'finals' && hasFinals(doc)}
        {#key doc.version}
          <FinalsPanel {doc} {tstate} {names} {canEdit} onset={setFinalists} />
        {/key}
        <Bracket format={doc.format} stage="finals" {resolved} {names} {seeds} {numbers} onselect={(m) => (openMatch = m)} />
      {:else}
        {#if canEdit && status === 'setup'}
          <p class="small muted hint no-print">Tap a match to enter its result.</p>
        {:else if !canEdit && app.store.report && status !== 'finished'}
          <p class="small muted hint no-print">Playing? Tap your match to report the result with your PIN.</p>
        {/if}
        <Bracket
          format={doc.format}
          {resolved}
          {names}
          {seeds}
          {numbers}
          {groupTables}
          {draws}
          cut={hasFinals(doc) ? (doc.options.finals?.advance ?? 0) : 0}
          onselect={(m) => (openMatch = m)}
        />
      {/if}
    </div>
  </div>

  {#if openMatch && tstate && resolved.get(openMatch)}
    {@const m = resolved.get(openMatch)!}
    {#key openMatch}
      <MatchSheet
        {m}
        {tstate}
        title={titleOf(m)}
        {names}
        {numbers}
        scoring={doc.scoring}
        {canEdit}
        canReport={!!app.store.report}
        me={myPinNow}
        onsave={(input, decisions) => saveResult(openMatch!, input, decisions)}
        onreport={(input, pin) => reportResult(openMatch!, input, pin)}
        onconfirm={(ok, pin) => confirmReport(openMatch!, ok, pin)}
        onclose={() => (openMatch = null)}
      />
    {/key}
  {/if}
{/if}

<style>
  .page { padding-top: 22px; }
  .titlebar { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 32px; }
  .titlebar .label { min-width: 0; }
  .actions { display: flex; gap: 6px; flex: none; }
  h1 { margin: 2px 0 10px; overflow-wrap: anywhere; }
  .meta { gap: 8px 16px; }
  .progress { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-2); }
  .progress b { color: var(--ink); }
  .bar { width: 72px; height: 6px; background: var(--line); border-radius: 1px; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--accent); }
  .champ { display: inline-flex; align-items: baseline; gap: 8px; font-size: 17px; }
  .champ .label { color: var(--accent); }
  .champ .champname { color: inherit; text-decoration: none; }
  .champ .champname:hover { text-decoration: underline; }
  .champ :global(.vf) { margin-left: -4px; }
  .saving { color: var(--ink-2); }
  @media (max-width: 520px) {
    .print { display: none; }
  }
  .status {
    font: 600 13px/1 var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase;
    padding: 5px 7px; border: 1px solid var(--line-strong); border-radius: var(--radius);
  }
  .s-running { border-color: var(--accent); color: var(--accent); }
  .s-finished { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .jcode { font: 700 16px var(--font-cond); letter-spacing: 0.12em; color: var(--ink); }
  .notice { margin-top: 16px; }
  .tabs {
    display: flex;
    gap: 2px;
    margin: 18px 0 18px;
    border-bottom: 1px solid var(--line-strong);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs a {
    padding: 10px 12px;
    text-decoration: none;
    font: 600 16px var(--font-cond);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
  }
  .tabs a.on { color: var(--ink); border-bottom-color: var(--accent); }
  @media (max-width: 520px) {
    .tabs { margin-left: -16px; margin-right: -16px; padding: 0 8px; }
    .tabs a { padding: 10px 8px; font-size: 15px; letter-spacing: 0.03em; }
  }
  .hint { margin-bottom: 10px; }
</style>

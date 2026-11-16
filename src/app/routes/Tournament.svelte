<script lang="ts">
  import { onDestroy } from 'svelte';
  import { applyEdit, resolve, undo } from '../../core';
  import type { Decision, ResolvedMatch, ResultInput } from '../../core';
  import Bracket from '../components/Bracket.svelte';
  import EditTournament from '../components/EditTournament.svelte';
  import FinalsPanel from '../components/FinalsPanel.svelte';
  import LogView from '../components/LogView.svelte';
  import MatchList from '../components/MatchList.svelte';
  import MatchSheet from '../components/MatchSheet.svelte';
  import SharePanel from '../components/SharePanel.svelte';
  import SignUp from '../components/SignUp.svelte';
  import Standings from '../components/Standings.svelte';
  import Waitlist from '../components/Waitlist.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import {
    describeResult, finalPlaces, FORMAT_LABEL, hasFinals, isTableFormat, logEntry, matchNumbers, nameMap, newId, pointsStageName,
    restorePoint, roundName, STATUS_LABEL, statusOf, toState, withEntrants,
  } from '../lib/model';
  import type { LogEntry, Player, TournamentDoc } from '../lib/model';
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
  const canEdit = $derived(app.store.canEdit(id));

  let doc = $state<TournamentDoc | null>(null);
  let players = $state<Player[]>([]);
  let missing = $state(false);
  let error = $state('');
  let openMatch = $state<string | null>(null);
  let saving = $state(false);

  async function load() {
    try {
      const [d, all] = await Promise.all([app.store.get(id), app.store.loadAll()]);
      players = all.players;
      if (!d) missing = true;
      // check-ins change updatedAt but not the version (they don't touch the bracket)
      else if (!doc || d.version !== doc.version || d.updatedAt !== doc.updatedAt) doc = d;
      error = '';
    } catch (e) {
      error = errorText(e);
    }
  }
  load();

  // Viewers of a shared sheet see updates without refreshing.
  const poll = app.store.kind === 'sheets' ? setInterval(() => !openMatch && !saving && tab !== 'edit' && load(), 20000) : undefined;
  onDestroy(() => clearInterval(poll));

  // A bracket needs 2 players; with sign-up open there may be fewer for a while.
  const tstate = $derived(doc && doc.entrants.length >= 2 ? toState(doc) : null);
  const resolved = $derived(tstate ? resolve(tstate) : new Map<string, ResolvedMatch>());
  const names = $derived(doc ? nameMap(doc, players) : new Map<string, string>());
  const seeds = $derived(new Map((doc?.entrants ?? []).map((e, i) => [e.id, i + 1])));
  const numbers = $derived(matchNumbers(resolved));
  const status = $derived(doc ? statusOf(doc) : 'setup');
  const conflicts = $derived([...resolved.values()].filter((m) => m.status === 'conflict').length);
  const champion = $derived.by(() => {
    if (!tstate || !doc || status !== 'finished') return null;
    // only a clear winner, not a tie for first
    const firsts = [...finalPlaces(doc, tstate)].filter(([, place]) => place === 1);
    return firsts.length === 1 ? names.get(firsts[0][0]) : null;
  });

  const titleOf = (m: ResolvedMatch) => (tstate && doc ? roundName(m.template, tstate.structure.matches, doc.format) : '');

  async function persist(next: TournamentDoc, created: Player[] = []): Promise<boolean> {
    saving = true;
    try {
      doc = await app.store.save(next, created);
      if (created.length) players = [...players, ...created];
      return true;
    } catch (e) {
      if (e instanceof VersionConflictError) {
        doc = null;
        await load();
      }
      app.notify(errorText(e), 'error');
      return false;
    } finally {
      saving = false;
    }
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
    if (ok) app.notify('Saved');
    return ok;
  }

  /** A player reports their own match (shared mode). The sheet checks the PIN. */
  async function reportResult(matchId: string, input: ResultInput, pin: string) {
    if (!doc || !tstate || !app.store.report) return false;
    const m = resolved.get(matchId);
    if (!m || typeof m.p1 !== 'string' || typeof m.p2 !== 'string') return false;
    saving = true;
    try {
      const { winner, score1, score2 } = input;
      doc = await app.store.report(id, matchId, pin, { winner, score1, score2, p1: m.p1, p2: m.p2 }, numbers.get(matchId));
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

  /** Organizer confirms who goes to the finals (or clears them to pick again). Undoable from the log. */
  async function setFinalists(qualified: number[] | null) {
    if (!doc?.options.finals) return false;
    const { qualified: _old, ...finals } = doc.options.finals;
    const next = { ...doc, options: { ...doc.options, finals: qualified ? { ...finals, qualified } : finals } };
    const { name, game, format, options, scoring, entrants, results } = doc;
    const summary = qualified
      ? `Finals started: ${qualified.map((s) => names.get(doc!.entrants[s - 1].id)).join(', ')}`
      : 'Finalists cleared';
    const entry: LogEntry = {
      id: newId(), time: new Date().toISOString(), summary, changes: [],
      restore: { name, game, format, options, scoring, entrants, results },
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
      app.go('');
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
  <div class="wrap page"><div class="empty">This tournament doesn't exist (or was deleted). <a href="#/">Back to list</a></div></div>
{:else if error && !doc}
  <div class="wrap page"><p class="notice">Couldn't load: {error}</p></div>
{:else if !doc}
  <div class="wrap page"><p class="muted">Loading…</p></div>
{:else}
  <div class="wrap page">
    <div class="titlebar">
      <div>
        <div class="label">
          {[
            doc.game,
            FORMAT_LABEL[doc.format],
            `${doc.entrants.length}${doc.maxPlayers ? ` / ${doc.maxPlayers}` : ''} ${doc.entrants.length === 1 && !doc.maxPlayers ? 'entrant' : 'entrants'}`,
          ].filter(Boolean).join(' · ')}
        </div>
        <h1>{doc.name}</h1>
        <div class="row meta">
          <span class="status s-{status}">{STATUS_LABEL[status]}</span>
          {#if doc.code && app.store.kind === 'sheets'}<span class="small muted">Code <b class="jcode">{doc.code}</b></span>{/if}
          {#if champion}<span class="champ">Champion: <b>{champion}</b></span>{/if}
          {#if saving}<span class="muted small">Saving…</span>{/if}
        </div>
      </div>
      <div class="row no-print">
        <button class="small" onclick={share}>Share</button>
        <button class="small" onclick={() => print()}>Print</button>
      </div>
    </div>

    {#if conflicts}
      <p class="notice">
        {conflicts} match{conflicts === 1 ? ' needs' : 'es need'} checking: the players changed after the result was entered
        (probably edited directly in the sheet). Open {conflicts === 1 ? 'it' : 'them'} from the Matches tab.
      </p>
    {/if}

    <SignUp {doc} {names} onjoined={(d) => (doc = d)} />
    <Waitlist {doc} {canEdit} onpromote={promote} />

    <nav class="tabs no-print">
      {#each tabs as [key, label] (key)}
        <a href="#/t/{id}{key === 'bracket' ? '' : '/' + key}" class:on={tab === key}>{label}</a>
      {/each}
    </nav>

    <div class="body">
      {#if tab === 'edit' && canEdit}
        {#if app.store.kind === 'sheets'}<SharePanel {doc} {names} onsignup={setSignup} onmax={setMaxPlayers} />{/if}
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
        <Bracket format={doc.format} {resolved} {names} {seeds} {numbers} onselect={(m) => (openMatch = m)} />
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
        me={myPin(id)}
        onsave={(input, decisions) => saveResult(openMatch!, input, decisions)}
        onreport={(input, pin) => reportResult(openMatch!, input, pin)}
        onclose={() => (openMatch = null)}
      />
    {/key}
  {/if}
{/if}

<style>
  .page { padding-top: 22px; }
  .titlebar { display: flex; justify-content: space-between; align-items: start; gap: 12px; flex-wrap: wrap; }
  h1 { margin: 4px 0 8px; overflow-wrap: anywhere; }
  .meta { gap: 12px; }
  .status {
    font: 600 13px/1 var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase;
    padding: 5px 7px; border: 1px solid var(--line-strong); border-radius: var(--radius);
  }
  .s-running { border-color: var(--accent); color: var(--accent); }
  .s-finished { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .champ { font-size: 16px; }
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
  .hint { margin-bottom: 10px; }
</style>

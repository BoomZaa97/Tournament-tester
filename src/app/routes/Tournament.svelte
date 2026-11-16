<script lang="ts">
  import { onDestroy } from 'svelte';
  import { applyEdit, eliminationPlacements, resolve, undo } from '../../core';
  import type { Decision, ResolvedMatch, ResultInput } from '../../core';
  import Bracket from '../components/Bracket.svelte';
  import EditTournament from '../components/EditTournament.svelte';
  import LogView from '../components/LogView.svelte';
  import MatchList from '../components/MatchList.svelte';
  import MatchSheet from '../components/MatchSheet.svelte';
  import Standings from '../components/Standings.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import {
    describeResult, FORMAT_LABEL, matchNumbers, nameMap, newId, roundName, STATUS_LABEL, statusOf, toState,
  } from '../lib/model';
  import type { LogEntry, Player, TournamentDoc } from '../lib/model';
  import { VersionConflictError } from '../lib/store';

  interface Props {
    id: string;
    tab: string;
  }
  let { id, tab }: Props = $props();

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
      else if (!doc || d.version !== doc.version) doc = d;
      error = '';
    } catch (e) {
      error = errorText(e);
    }
  }
  load();

  // Viewers of a shared sheet see updates without refreshing.
  const poll = app.store.kind === 'sheets' ? setInterval(() => !openMatch && !saving && tab !== 'edit' && load(), 20000) : undefined;
  onDestroy(() => clearInterval(poll));

  const tstate = $derived(doc ? toState(doc) : null);
  const resolved = $derived(tstate ? resolve(tstate) : new Map<string, ResolvedMatch>());
  const names = $derived(doc ? nameMap(doc, players) : new Map<string, string>());
  const seeds = $derived(new Map((doc?.entrants ?? []).map((e, i) => [e.id, i + 1])));
  const numbers = $derived(matchNumbers(resolved));
  const status = $derived(doc ? statusOf(doc) : 'setup');
  const conflicts = $derived([...resolved.values()].filter((m) => m.status === 'conflict').length);
  const champion = $derived.by(() => {
    if (!tstate || status !== 'finished' || doc?.format === 'round_robin') return null;
    const first = eliminationPlacements(tstate).find((p) => p.place === 1);
    return first ? names.get(first.entrant) : null;
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
    const ok = await persist({ ...doc, results: out.results, log: [...doc.log, entry] });
    if (ok) app.notify('Saved');
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
      next = { ...doc, results: out.results };
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
    ['bracket', doc?.format === 'round_robin' ? 'Rounds' : 'Bracket'],
    ['matches', 'Matches'],
    ['standings', 'Standings'],
    ['log', 'Log'],
    ...(app.store.canEdit ? [['edit', 'Edit']] : []),
  ]);
</script>

{#if missing}
  <div class="wrap page"><div class="empty">This tournament doesn't exist (or was deleted). <a href="#/">Back to list</a></div></div>
{:else if error && !doc}
  <div class="wrap page"><p class="notice">Couldn't load: {error}</p></div>
{:else if !doc || !tstate}
  <div class="wrap page"><p class="muted">Loading…</p></div>
{:else}
  <div class="wrap page">
    <div class="titlebar">
      <div>
        <div class="label">
          {[doc.game, FORMAT_LABEL[doc.format], `${doc.entrants.length} entrants`].filter(Boolean).join(' · ')}
        </div>
        <h1>{doc.name}</h1>
        <div class="row meta">
          <span class="status s-{status}">{STATUS_LABEL[status]}</span>
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

    <nav class="tabs no-print">
      {#each tabs as [key, label] (key)}
        <a href="#/t/{id}{key === 'bracket' ? '' : '/' + key}" class:on={tab === key}>{label}</a>
      {/each}
    </nav>

    <div class="body">
      {#if tab === 'matches'}
        <MatchList {resolved} {names} {numbers} {titleOf} onselect={(m) => (openMatch = m)} />
      {:else if tab === 'standings'}
        <Standings {tstate} {names} scoring={doc.scoring} />
      {:else if tab === 'log'}
        <LogView log={doc.log} {names} {numbers} canEdit={app.store.canEdit} onundo={undoEntry} />
      {:else if tab === 'edit' && app.store.canEdit}
        {#key doc.version}
          <EditTournament {doc} known={players} {names} onapply={applyEditTournament} ondelete={remove} />
        {/key}
      {:else}
        {#if app.store.canEdit && status === 'setup'}
          <p class="small muted hint no-print">Tap a match to enter its result.</p>
        {/if}
        <Bracket format={doc.format} {resolved} {names} {seeds} {numbers} onselect={(m) => (openMatch = m)} />
      {/if}
    </div>
  </div>

  {#if openMatch && resolved.get(openMatch)}
    {@const m = resolved.get(openMatch)!}
    {#key openMatch}
      <MatchSheet
        {m}
        {tstate}
        title={titleOf(m)}
        {names}
        {numbers}
        scoring={doc.scoring}
        canEdit={app.store.canEdit}
        onsave={(input, decisions) => saveResult(openMatch!, input, decisions)}
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

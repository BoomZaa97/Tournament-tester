<script lang="ts">
  import { replaceEntrant, restructure } from '../../core';
  import type { Format, FormatOptions } from '../../core';
  import { describeResult, FORMAT_LABEL, newId, toState } from '../lib/model';
  import type { LogEntry, Player, Row, Scoring, TournamentDoc } from '../lib/model';
  import EntrantEditor from './EntrantEditor.svelte';
  import FormatFields from './FormatFields.svelte';

  interface Props {
    doc: TournamentDoc;
    known: Player[];
    names: Map<string, string>;
    onapply: (next: TournamentDoc, created: Player[], entry: LogEntry) => Promise<boolean>;
    ondelete: () => void;
  }
  let { doc, known, names, onapply, ondelete }: Props = $props();

  let name = $state(doc.name);
  let game = $state(doc.game);
  let format = $state<Format>(doc.format);
  let options = $state<FormatOptions>({ ...doc.options });
  let scoring = $state<Scoring>({ ...doc.scoring });
  let rows = $state<Row[]>(doc.entrants.map((e) => ({ key: e.id, name: names.get(e.id) ?? e.name, origId: e.id })));
  let busy = $state(false);

  const plan = $derived.by(() => {
    const live = rows.filter((r) => r.name.trim());
    const lower = live.map((r) => r.name.trim().toLowerCase());
    if (live.length < 2) return { error: 'A tournament needs at least 2 entrants.' };
    if (new Set(lower).size !== lower.length) return { error: 'Two entrants have the same name.' };

    const byName = new Map(known.map((p) => [p.name.trim().toLowerCase(), p]));
    const created: Player[] = [];
    const notes: string[] = [];
    const oldIds = new Set(doc.entrants.map((e) => e.id));
    let tstate = toState(doc);

    const entrants: Player[] = live.map((r) => {
      const nm = r.name.trim();
      const orig = r.origId ? doc.entrants.find((e) => e.id === r.origId) : undefined;
      const origName = r.origId ? (names.get(r.origId) ?? orig?.name) : undefined;
      if (orig && origName === nm) return { id: orig.id, name: nm };
      let p = byName.get(nm.toLowerCase());
      if (!p) {
        p = { id: newId(), name: nm };
        byName.set(nm.toLowerCase(), p);
        created.push(p);
      }
      // Name changed on an existing slot = a sub takes over that slot and its results.
      if (orig && !oldIds.has(p.id)) {
        tstate = replaceEntrant(tstate, orig.id, p.id);
        notes.push(`${origName} replaced by ${nm}`);
      }
      return p;
    });

    const ids = entrants.map((e) => e.id);
    const added = entrants.filter((e) => !tstate.entrants.includes(e.id)).map((e) => e.name);
    const removed = tstate.entrants.filter((id) => !ids.includes(id)).map((id) => names.get(id) ?? id);
    if (added.length) notes.push(`added ${added.join(', ')}`);
    if (removed.length) notes.push(`removed ${removed.join(', ')}`);

    const sameOrder = ids.length === tstate.entrants.length && ids.every((id, i) => id === tstate.entrants[i]);
    const sameSet = ids.length === tstate.entrants.length && ids.every((id) => tstate.entrants.includes(id));
    if (!sameOrder && sameSet) notes.push('reseeded');
    if (format !== doc.format) notes.push(`format → ${FORMAT_LABEL[format]}`);
    if (JSON.stringify(options) !== JSON.stringify(doc.options)) notes.push('options changed');
    if (JSON.stringify(scoring) !== JSON.stringify(doc.scoring)) notes.push('scoring changed');
    if (name.trim() !== doc.name) notes.push('renamed');
    if (game.trim() !== doc.game) notes.push('game changed');

    const out = restructure(tstate, { format, entrants: ids, options });
    return { entrants, created, notes, results: out.state.results, dropped: out.dropped, kept: out.kept.length };
  });

  async function apply() {
    if ('error' in plan || !plan.notes.length) return;
    if (plan.dropped.length && !confirm(`${plan.dropped.length} result(s) will be removed. Continue?`)) return;
    busy = true;
    const entry: LogEntry = {
      id: newId(),
      time: new Date().toISOString(),
      summary: `Edited tournament: ${plan.notes.join('; ')}`,
      changes: [],
      restore: {
        name: doc.name, game: doc.game, format: doc.format, options: doc.options,
        scoring: doc.scoring, entrants: doc.entrants, results: doc.results,
      },
    };
    const next: TournamentDoc = {
      ...doc,
      name: name.trim(),
      game: game.trim(),
      format,
      options,
      scoring,
      entrants: plan.entrants,
      results: plan.results,
    };
    await onapply(next, plan.created, entry);
    busy = false;
  }
</script>

<div class="edit">
  <div class="cols">
    <div class="col">
      <label class="field"><span>Name</span><input bind:value={name} /></label>
      <label class="field"><span>Game</span><input bind:value={game} /></label>
      <FormatFields bind:format bind:options bind:scoring />
    </div>
    <div class="col">
      <div class="label">Entrants</div>
      <p class="small muted hint">
        Rename a slot to put a sub in (they take over that slot's results). Add or remove people, or change the order to reseed.
        Results that still make sense are kept.
      </p>
      <EntrantEditor bind:rows {known} />
    </div>
  </div>

  <div class="summary panel">
    {#if 'error' in plan}
      <p class="err">{plan.error}</p>
    {:else if !plan.notes.length}
      <p class="muted">No changes yet.</p>
    {:else}
      <p><b>Changes:</b> {plan.notes.join('; ')}.</p>
      <p class="small">
        {plan.kept} result{plan.kept === 1 ? '' : 's'} kept{#if plan.dropped.length}, <b class="err">{plan.dropped.length} removed</b>{/if}.
      </p>
      {#if plan.dropped.length}
        <ul class="small dropped">
          {#each plan.dropped as d (d.matchId)}<li>{describeResult(d.result, names)}</li>{/each}
        </ul>
      {/if}
    {/if}
    <div class="row">
      <button class="primary" onclick={apply} disabled={'error' in plan || !plan.notes.length || busy}>Apply changes</button>
      <span class="small muted">Can be undone from the Log tab.</span>
    </div>
  </div>

  <hr class="rule" />
  <div class="row">
    <button class="danger" onclick={ondelete}>Delete tournament</button>
  </div>
</div>

<style>
  .edit { display: grid; gap: 20px; }
  .cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; }
  .col { display: grid; gap: 14px; align-content: start; }
  .hint { margin: 0; }
  .summary { padding: 14px; display: grid; gap: 6px; }
  .summary p { margin: 0; }
  .err { color: var(--danger); }
  .dropped { margin: 0; padding-left: 18px; color: var(--muted); }
  @media (max-width: 760px) { .cols { grid-template-columns: minmax(0, 1fr); } }
</style>

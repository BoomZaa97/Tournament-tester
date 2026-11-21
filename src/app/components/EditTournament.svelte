<script lang="ts">
  import { replaceEntrant, restructure } from '../../core';
  import type { Format, FormatOptions } from '../../core';
  import {
    CATEGORY_SUGGESTIONS, categoryOf, cleanDivision, describeResult, DIVISION_SUGGESTIONS, divisionOf, FORMAT_LABEL, newId, OPEN, TIER_LABEL,
    tierOf, toState,
  } from '../lib/model';
  import type { LogEntry, Player, Row, Scoring, Tier, TournamentDoc } from '../lib/model';
  import TierPicker from './TierPicker.svelte';
  import { nameKey } from '../lib/players';
  import EntrantEditor from './EntrantEditor.svelte';
  import FormatFields from './FormatFields.svelte';
  import GamePicker from './GamePicker.svelte';
  import { app } from '../lib/app.svelte';
  import { gameOf, usedGames } from '../lib/games';

  interface Props {
    doc: TournamentDoc;
    known: Player[];
    names: Map<string, string>;
    onapply: (next: TournamentDoc, created: Player[], entry: LogEntry) => Promise<boolean>;
    ondelete: () => void;
  }
  let { doc, known, names, onapply, ondelete }: Props = $props();

  let name = $state(doc.name);
  let game = $state(gameOf(doc));
  const used = usedGames(app.store.peekAll()?.tournaments ?? []);
  // an old "Category: U18" shows up as the division here, and moves there when saved
  let category = $state(categoryOf(doc));
  let division = $state(divisionOf(doc) === OPEN ? '' : divisionOf(doc));
  let tier = $state<Tier>(tierOf(doc));
  let format = $state<Format>(doc.format);
  let options = $state<FormatOptions>({ ...doc.options });
  let scoring = $state<Scoring>({ ...doc.scoring });
  let rows = $state<Row[]>(doc.entrants.map((e) => ({ key: e.id, name: names.get(e.id) ?? e.name, origId: e.id })));
  let busy = $state(false);

  const plan = $derived.by(() => {
    const live = rows.filter((r) => r.name.trim());
    const lower = live.map((r) => nameKey(r.name));
    if (!game) return { error: 'Pick the game: each game has its own ranking.' };
    if (live.length < 2) return { error: 'A tournament needs at least 2 entrants.' };
    if (new Set(lower).size !== lower.length) return { error: 'Two entrants have the same name.' };

    const byName = new Map(known.map((p) => [nameKey(p.name), p]));
    const created: Player[] = [];
    const notes: string[] = [];
    const oldIds = new Set(doc.entrants.map((e) => e.id));
    let tstate = toState(doc);

    const entrants: Player[] = live.map((r) => {
      const nm = r.name.replace(/\s+/g, ' ').trim();
      const orig = r.origId ? doc.entrants.find((e) => e.id === r.origId) : undefined;
      const origName = r.origId ? (names.get(r.origId) ?? orig?.name) : undefined;
      if (orig && origName === nm) return { id: orig.id, name: nm };
      let p = byName.get(nameKey(nm));
      if (!p) {
        p = { id: newId(), name: nm };
        byName.set(nameKey(nm), p);
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
    if (game !== gameOf(doc)) notes.push(`game → ${game}`);
    if (category.trim() !== categoryOf(doc)) notes.push('category changed');
    if ((cleanDivision(division) ?? OPEN) !== divisionOf(doc)) notes.push(`division → ${cleanDivision(division) ?? OPEN}`);
    if (tier !== tierOf(doc)) notes.push(`now a ${TIER_LABEL[tier].toLowerCase()}`);

    const out = restructure(tstate, { format, entrants: ids, options });
    // options from the rebuilt state: swiss rounds already played are carried over there
    return { entrants, created, notes, options: out.state.options ?? options, results: out.state.results, dropped: out.dropped, kept: out.kept.length };
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
        name: doc.name, game: doc.game, category: doc.category ?? '', division: doc.division ?? '', tier: tierOf(doc), format: doc.format, options: doc.options,
        scoring: doc.scoring, entrants: doc.entrants, results: doc.results,
      },
    };
    const next: TournamentDoc = {
      ...doc,
      name: name.trim(),
      game,
      category: category.trim() || undefined,
      division: cleanDivision(division),
      tier,
      format,
      options: plan.options,
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
      <div class="field"><label for="edit-game">Game</label><GamePicker bind:game {used} id="edit-game" /></div>
      <label class="field">
        <span>Category <span class="muted">(optional: Esports, Sports…)</span></span>
        <input bind:value={category} placeholder="None" maxlength="40" list="edit-categories" />
        <datalist id="edit-categories">{#each CATEGORY_SUGGESTIONS as c}<option value={c}></option>{/each}</datalist>
      </label>
      <label class="field">
        <span>Division <span class="muted">(optional: U18, Women…)</span></span>
        <input bind:value={division} placeholder="Open" maxlength="40" list="edit-divisions" />
        <datalist id="edit-divisions">{#each DIVISION_SUGGESTIONS as d}<option value={d}></option>{/each}</datalist>
      </label>
      <TierPicker bind:tier />
      <FormatFields bind:format bind:options bind:scoring entrantCount={rows.filter((r) => r.name.trim()).length} />
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

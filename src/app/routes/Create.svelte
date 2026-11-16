<script lang="ts">
  import { createTournament, FINALS_PREFIX, resolve } from '../../core';
  import type { Format, FormatOptions } from '../../core';
  import Bracket from '../components/Bracket.svelte';
  import EntrantEditor from '../components/EntrantEditor.svelte';
  import FormatFields from '../components/FormatFields.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import { emptyDoc, isByeMatch, matchNumbers } from '../lib/model';
  import type { Player, Row, Scoring } from '../lib/model';
  import { rowsToPlayers } from '../lib/players';

  let name = $state('');
  let game = $state('');
  let format = $state<Format>('single_elim');
  let options = $state<FormatOptions>({});
  let scoring = $state<Scoring>({});
  let rows = $state<Row[]>([]);
  /** Shared mode: players can add themselves from the tournament page. */
  let signup = $state(false);
  const shared = app.store.kind === 'sheets';
  let known = $state<Player[]>([]);
  let games = $state<string[]>([]);
  let saving = $state(false);

  app.store.loadAll().then((d) => {
    known = d.players;
    games = [...new Set(d.tournaments.map((t) => t.game).filter(Boolean))];
  });

  const names = $derived(rows.map((r) => r.name.trim()).filter(Boolean));
  const hasDupes = $derived(new Set(names.map((n) => n.toLowerCase())).size !== names.length);

  // Live preview: row keys stand in for player ids until we save.
  const preview = $derived.by(() => {
    const live = rows.filter((r) => r.name.trim());
    if (live.length < 2) return null;
    const tstate = createTournament(format, live.map((r) => r.key), options);
    const resolved = resolve(tstate);
    return {
      resolved,
      names: new Map(live.map((r) => [r.key, r.name.trim()])),
      seeds: new Map(live.map((r, i) => [r.key, i + 1])),
      numbers: matchNumbers(resolved),
      count: [...resolved.values()].filter((m) => !isByeMatch(m)).length,
    };
  });

  const problem = $derived(
    !name.trim()
      ? 'Give it a name.'
      : names.length < 2 && !signup
        ? 'Add at least 2 entrants, or let players sign up.'
        : hasDupes
          ? 'Two entrants have the same name.'
          : '',
  );

  async function create() {
    if (problem) return;
    saving = true;
    try {
      const { entrants, created } = rowsToPlayers(rows, known);
      const doc = { ...emptyDoc(), name: name.trim(), game: game.trim(), format, options, scoring, entrants, signup: shared && signup };
      const saved = await app.store.save(doc, created);
      app.notify(shared ? 'Tournament created. You are its organizer on this device.' : 'Tournament created');
      app.go(`t/${saved.id}`);
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      saving = false;
    }
  }
</script>

<div class="wrap page">
  <a class="back small" href="#/">← Tournaments</a>
  <h1>New tournament</h1>

  {#if shared}
    <p class="small muted intro">
      You'll be the organizer: this device can edit the tournament. You can give helpers a link to edit it too.
    </p>
  {/if}
    <div class="grid">
      <form class="side" onsubmit={(e) => { e.preventDefault(); create(); }}>
        <label class="field">
          <span>Name</span>
          <input bind:value={name} placeholder="Friday Night #12" required />
        </label>
        <label class="field">
          <span>Game <span class="muted">(optional)</span></span>
          <input bind:value={game} placeholder="Any game" list="known-games" />
          <datalist id="known-games">{#each games as g}<option value={g}></option>{/each}</datalist>
        </label>

        <FormatFields bind:format bind:options bind:scoring entrantCount={names.length} />

        <hr class="rule" />
        <div class="label">Entrants <span class="muted">— top of the list is seed 1</span></div>
        <EntrantEditor bind:rows {known} />
        {#if shared}
          <label class="check">
            <input type="checkbox" bind:checked={signup} />
            Let players sign up themselves (they get a PIN to report their own scores)
          </label>
        {/if}

        <div class="submit">
          <button class="primary" type="submit" disabled={!!problem || saving}>
            {saving ? 'Creating…' : 'Create tournament'}
          </button>
          {#if problem && (name || rows.length)}<span class="small muted">{problem}</span>{/if}
        </div>
      </form>

      <section class="preview">
        <div class="row ph">
          <h2>Preview</h2>
          {#if preview}<span class="muted small">{preview.count} matches</span>{/if}
        </div>
        {#if preview}
          <Bracket {format} resolved={preview.resolved} names={preview.names} seeds={preview.seeds} numbers={preview.numbers} />
          {#if options.finals && [...preview.resolved.keys()].some((k) => k.startsWith(FINALS_PREFIX))}
            <h3 class="finalshead">Finals</h3>
            <Bracket {format} stage="finals" resolved={preview.resolved} names={preview.names} seeds={preview.seeds} numbers={preview.numbers} />
          {/if}
        {:else}
          <div class="empty">Add two or more entrants and the bracket appears here.</div>
        {/if}
      </section>
    </div>
</div>

<style>
  .page { padding-top: 20px; }
  .back { display: inline-block; margin-bottom: 8px; color: var(--muted); text-decoration: none; }
  h1 { margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: minmax(0, 360px) minmax(0, 1fr); gap: 32px; align-items: start; }
  .side { display: grid; gap: 14px; }
  .preview { min-width: 0; position: sticky; top: 76px; }
  .finalshead { margin: 24px 0 4px; }
  .ph { justify-content: space-between; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid var(--ink); }
  .intro { margin: -12px 0 18px; max-width: 640px; }
  .submit { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
  .submit .primary { min-height: 48px; padding: 0 22px; font-size: 16px; }
  @media (max-width: 820px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .preview { position: static; }
  }
</style>

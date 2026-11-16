<script lang="ts">
  import { newId } from '../lib/model';
  import type { Player, Row } from '../lib/model';

  interface Props {
    rows: Row[];
    known: Player[];
  }
  let { rows = $bindable(), known }: Props = $props();

  let adding = $state('');
  let bulk = $state(false);
  let bulkText = $state('');

  const dupes = $derived.by(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = r.name.trim().toLowerCase();
      if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  });

  function add(names: string[]) {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    rows = [...rows, ...clean.map((name) => ({ key: newId(), name }))];
  }

  function onAdd(e: SubmitEvent) {
    e.preventDefault();
    add([adding]);
    adding = '';
  }

  function onBulk() {
    // accepts one name per line, or comma separated; strips "1." / "1)" numbering
    add(bulkText.split(/\n|,/).map((s) => s.replace(/^\s*\d+[.)]\s*/, '')));
    bulkText = '';
    bulk = false;
  }

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    rows = next;
  }

  function shuffle() {
    const next = [...rows];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    rows = next;
  }
</script>

<div class="editor">
  <form class="row add" onsubmit={onAdd}>
    <input placeholder="Add a player or team" bind:value={adding} list="known-players" aria-label="Entrant name" />
    <button type="submit" disabled={!adding.trim()}>Add</button>
  </form>
  <datalist id="known-players">
    {#each known as p (p.id)}<option value={p.name}></option>{/each}
  </datalist>

  <div class="row tools">
    <button type="button" class="small ghost" onclick={() => (bulk = !bulk)}>{bulk ? 'Close paste' : 'Paste a list'}</button>
    <button type="button" class="small ghost" onclick={shuffle} disabled={rows.length < 2}>Shuffle seeds</button>
    <span class="spacer"></span>
    <span class="muted small">{rows.length} entrant{rows.length === 1 ? '' : 's'}</span>
  </div>

  {#if bulk}
    <div class="bulk">
      <textarea rows="6" bind:value={bulkText} placeholder={'One name per line\nAlice\nBob\nCharlie'}></textarea>
      <button type="button" class="primary" onclick={onBulk} disabled={!bulkText.trim()}>Add all</button>
    </div>
  {/if}

  {#if rows.length}
    <ol class="list">
      {#each rows as row, i (row.key)}
        <li class:dupe={dupes.has(row.name.trim().toLowerCase())}>
          <span class="seed">{i + 1}</span>
          <input bind:value={row.name} aria-label="Seed {i + 1} name" list="known-players" />
          <button type="button" class="ghost small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
          <button type="button" class="ghost small" onclick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
          <button type="button" class="ghost small danger" onclick={() => (rows = rows.filter((r) => r.key !== row.key))} aria-label="Remove">✕</button>
        </li>
      {/each}
    </ol>
    {#if dupes.size}<p class="small warn">Two entrants have the same name. Rename one so their history stays separate.</p>{/if}
  {/if}
</div>

<style>
  .editor { display: grid; gap: 10px; }
  .add input { flex: 1; min-width: 0; }
  .add { flex-wrap: nowrap; }
  .tools { gap: 4px; }
  .bulk { display: grid; gap: 8px; }
  .list { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--line); }
  .list li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0;
    border-bottom: 1px solid var(--line);
  }
  .list input { flex: 1; min-width: 0; border-color: transparent; background: transparent; min-height: 36px; padding: 6px 8px; }
  .list input:hover, .list input:focus { border-color: var(--line-strong); background: var(--card); }
  .seed { width: 28px; flex: 0 0 28px; text-align: center; font: 700 16px var(--font-cond); color: var(--muted); }
  .dupe .seed { color: var(--warn); }
  .warn { color: var(--warn); margin: 0; }
  .list button { min-width: 32px; padding: 0 6px; }
</style>

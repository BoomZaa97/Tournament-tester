<script lang="ts">
  import type { TournamentDoc } from '../lib/model';

  interface Props {
    doc: TournamentDoc;
    names: Map<string, string>;
    ondrop: (playerId: string, out: boolean) => Promise<boolean>;
  }
  let { doc, names, ondrop }: Props = $props();

  const out = $derived(new Set(doc.options.dropped ?? []));
  let busy = $state(false);

  async function toggle(playerId: string, drop: boolean) {
    const name = names.get(playerId) ?? '?';
    if (drop && !confirm(`Drop ${name}? They keep their results, but get no more matches: their opponents win them.`)) return;
    busy = true;
    await ondrop(playerId, drop);
    busy = false;
  }
</script>

<section class="panel drops">
  <h3>Drop-outs</h3>
  <p class="small muted">
    Someone leaving early keeps their results and their place in the standings. They aren't paired again, and any
    match they still had counts as a win for their opponent. Bring them back at any time, or undo from the Log tab.
  </p>
  <ul>
    {#each doc.entrants as e, i (e.id)}
      {@const dropped = out.has(i + 1)}
      <li class:dropped>
        <span class="name">{names.get(e.id) ?? e.name}</span>
        {#if dropped}<span class="small tag">Dropped</span>{/if}
        <button class="small" class:danger={!dropped} disabled={busy} onclick={() => toggle(e.id, !dropped)}>
          {dropped ? 'Bring back' : 'Drop'}
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .drops { padding: 14px; display: grid; gap: 8px; margin-bottom: 20px; }
  .drops p { margin: 0; max-width: 620px; }
  ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); max-height: 360px; overflow-y: auto; max-width: 560px; }
  li { display: flex; align-items: center; gap: 10px; padding: 4px 2px; border-bottom: 1px solid var(--line); min-height: 42px; }
  .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .dropped .name { color: var(--muted); text-decoration: line-through; }
  .tag { font-weight: 600; color: var(--muted); }
</style>

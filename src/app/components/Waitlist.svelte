<script lang="ts">
  import type { Player, TournamentDoc } from '../lib/model';

  interface Props {
    doc: TournamentDoc;
    canEdit: boolean;
    onpromote: (p: Player) => Promise<boolean>;
  }
  let { doc, canEdit, onpromote }: Props = $props();

  const list = $derived(doc.waitlist ?? []);
  const started = $derived(Object.keys(doc.results).length > 0);
  const spots = $derived(doc.maxPlayers ? Math.max(0, doc.maxPlayers - doc.entrants.length) : 0);
  let busy = $state(false);

  async function promote(p: Player) {
    busy = true;
    await onpromote(p);
    busy = false;
  }
</script>

{#if list.length}
  <section class="panel wl">
    <div class="head">
      <h3>Waitlist <span class="count">{list.length}</span></h3>
      {#if canEdit && !started}
        <span class="small muted">
          {spots ? `${spots} spot${spots === 1 ? '' : 's'} open: move people up in order.` : 'Full. Remove someone in Edit to open a spot.'}
        </span>
      {/if}
    </div>
    <ol>
      {#each list as p, i (p.id)}
        <li>
          <span class="n">{i + 1}</span>
          <span class="name">{p.name}</span>
          {#if canEdit && !started}
            <button class="small" class:primary={i === 0 && spots > 0} disabled={busy} onclick={() => promote(p)}>Move up</button>
          {/if}
        </li>
      {/each}
    </ol>
    <p class="small muted note">Not in the bracket yet. {canEdit ? 'Moving someone up adds them as the last seed (undo from the Log tab).' : 'The organizer moves people up in this order if a spot opens.'}</p>
  </section>
{/if}

<style>
  .wl { padding: 12px 14px; margin-top: 16px; max-width: 560px; display: grid; gap: 8px; }
  .head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
  .count { font-size: 13px; color: var(--muted); }
  ol { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  li { display: flex; align-items: center; gap: 10px; padding: 6px 2px; border-bottom: 1px solid var(--line); min-height: 44px; }
  .n { font: 700 16px var(--font-cond); color: var(--muted); width: 22px; text-align: right; }
  .name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 600; }
  .note { margin: 0; }
</style>

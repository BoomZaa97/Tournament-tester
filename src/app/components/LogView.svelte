<script lang="ts">
  import type { LogEntry } from '../lib/model';
  import { describeResult } from '../lib/model';

  interface Props {
    log: LogEntry[];
    names: Map<string, string>;
    numbers: Map<string, number>;
    canEdit: boolean;
    onundo: (entry: LogEntry) => void;
  }
  let { log, names, numbers, canEdit, onundo }: Props = $props();

  const time = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

{#if log.length === 0}
  <div class="empty">No changes yet. Every result you enter or edit shows up here, and can be undone.</div>
{:else}
  <ol class="log">
    {#each [...log].reverse() as e (e.id)}
      <li class:undone={e.undone}>
        <div class="head">
          <span class="when">{time(e.time)}</span>
          <span class="what">{e.summary}</span>
          {#if canEdit && !e.undone && e.changes.length}
            <button class="small" onclick={() => onundo(e)}>Undo</button>
          {/if}
          {#if e.undone}<span class="label">Undone</span>{/if}
        </div>
        {#if e.changes.length > 1 || (e.changes.length === 1 && e.changes[0].before)}
          <ul class="changes">
            {#each e.changes as c (c.matchId)}
              <li>
                <b>#{numbers.get(c.matchId) ?? c.matchId}</b>
                <span class="muted">{describeResult(c.before, names)}</span>
                <span aria-label="became">→</span>
                <span>{describeResult(c.after, names)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<style>
  .log { list-style: none; padding: 0; margin: 0; border-top: 2px solid var(--ink); }
  .log > li { padding: 10px 4px; border-bottom: 1px solid var(--line); }
  .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .when { font: 600 14px var(--font-cond); color: var(--muted); min-width: 110px; }
  .what { flex: 1; min-width: 180px; }
  .undone .what { text-decoration: line-through; color: var(--muted); }
  .changes { list-style: none; margin: 6px 0 0; padding: 0 0 0 122px; font-size: 14px; display: grid; gap: 2px; }
  .changes li { display: flex; gap: 8px; flex-wrap: wrap; }
  @media (max-width: 600px) { .changes { padding-left: 0; } .when { min-width: 0; } }
</style>

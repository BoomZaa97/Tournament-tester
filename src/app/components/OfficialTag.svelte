<script lang="ts">
  import type { Official } from '../lib/model';

  interface Props {
    official: Official | string | undefined;
    /** Also show "Waiting for review" (organizers and staff). */
    pending?: boolean;
  }
  let { official, pending = false }: Props = $props();
</script>

{#if official === 'yes'}
  <span class="off" title="Official tournament: checked by staff, counts towards the confirmed rating">
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6 9.6 3.6" /></svg>Official
  </span>
{:else if pending && official === 'pending'}
  <span class="off wait" title="The organizer asked staff to make this tournament official">Official? In review</span>
{/if}

<style>
  .off {
    display: inline-flex; align-items: center; gap: 3px; padding: 0 5px; border: 1px solid var(--ink); border-radius: var(--radius);
    vertical-align: 0.1em; line-height: 1.35; color: var(--ink);
    font: 700 11px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap;
  }
  .off svg { width: 10px; height: 10px; fill: none; stroke: var(--accent); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .wait { border-style: dashed; color: var(--ink-2); border-color: var(--ink-2); }
</style>

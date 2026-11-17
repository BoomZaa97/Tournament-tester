<script lang="ts">
  import { app } from '../lib/app.svelte';

  interface Props {
    /** Player id: the mark shows only if this player has an account. */
    id: string | null | undefined;
    /** Also write the word "Verified" next to the mark. */
    label?: boolean;
  }
  let { id, label = false }: Props = $props();
</script>

{#if id && app.verified.has(id)}
  <span class="vf" class:labelled={label} title="Verified: this name belongs to the player's own account">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" />
      <path d="M4.4 8.3l2.4 2.4 4.8-5" />
    </svg>
    {#if label}<span class="word">Verified</span>{:else}<span class="sr">verified</span>{/if}
  </span>
{/if}

<style>
  .vf {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 0.3em;
    vertical-align: -0.1em;
    line-height: 1;
    flex: none;
  }
  svg { width: 0.9em; height: 0.9em; min-width: 12px; min-height: 12px; }
  circle { fill: var(--accent); }
  path { fill: none; stroke: var(--paper); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .word { font: 600 12px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
  .labelled { margin-left: 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

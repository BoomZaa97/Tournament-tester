<script lang="ts">
  import { TIER_LABEL, tierOf } from '../lib/model';

  interface Props {
    tier: string | undefined;
  }
  let { tier }: Props = $props();
  const t = $derived(tierOf({ tier }));
</script>

{#if t !== 'small'}<span class="tier t-{t}">{TIER_LABEL[t]}</span>{/if}

<style>
  .tier {
    display: inline-block; padding: 1px 6px; border-radius: var(--radius); vertical-align: 0.1em; line-height: 1.35;
    font: 700 11px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap;
  }
  .t-major { background: var(--accent); color: var(--paper); }
  .t-semi { border: 1px solid var(--accent); color: var(--accent); padding: 0 5px; }
</style>

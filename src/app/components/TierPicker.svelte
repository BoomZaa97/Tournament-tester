<script lang="ts">
  import { TIER_LABEL, TIER_WEIGHT, TIERS } from '../lib/model';
  import type { Tier } from '../lib/model';

  interface Props {
    tier: Tier;
  }
  let { tier = $bindable() }: Props = $props();
  // smallest first, the way people think of it
  const order = [...TIERS].reverse();
</script>

<fieldset class="field tiers">
  <legend>Event size</legend>
  <div class="seg" role="radiogroup" aria-label="Event size">
    {#each order as t (t)}
      <label class:on={tier === t}>
        <input type="radio" name="tier" value={t} bind:group={tier} />
        {TIER_LABEL[t]}
      </label>
    {/each}
  </div>
  <span class="small muted">
    {tier === 'small' ? 'Normal ranking points.' : `Ranking points ×${TIER_WEIGHT[tier]}. Shown as a ${TIER_LABEL[tier].toLowerCase()} on players' profiles.`}
  </span>
</fieldset>

<style>
  .tiers { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 6px; }
  legend { padding: 0; margin-bottom: 6px; font-weight: 600; }
  .seg { display: flex; border: 1px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; }
  .seg label {
    flex: 1 1 0; min-width: 0; display: grid; place-items: center; min-height: 38px; padding: 0 6px; cursor: pointer;
    font: 600 15px var(--font-cond); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); text-align: center;
  }
  .seg label + label { border-left: 1px solid var(--line-strong); }
  .seg label.on { background: var(--ink); color: var(--paper); }
  .seg label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
  .seg label { position: relative; overflow: hidden; }
  .seg input { position: absolute; inset: 0; width: 1px; height: 1px; min-height: 0; margin: 0; padding: 0; opacity: 0; pointer-events: none; }
</style>

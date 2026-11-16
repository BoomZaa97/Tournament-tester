<script lang="ts">
  import type { Format, FormatOptions, Tiebreaker } from '../../core';
  import type { Scoring } from '../lib/model';

  interface Props {
    format: Format;
    options: FormatOptions;
    scoring: Scoring;
  }
  let { format = $bindable(), options = $bindable(), scoring = $bindable() }: Props = $props();

  const formats: { id: Format; name: string; blurb: string }[] = [
    { id: 'single_elim', name: 'Single elimination', blurb: 'Lose once and you are out.' },
    { id: 'double_elim', name: 'Double elimination', blurb: 'Out after two losses. Losers bracket included.' },
    { id: 'round_robin', name: 'Round robin', blurb: 'Everyone plays everyone. Best record wins.' },
  ];

  const TB_LABEL: Record<Tiebreaker, string> = {
    h2h: 'Head-to-head',
    diff: 'Score difference',
    for: 'Total score',
    wins: 'Wins',
  };
  const tiebreakers = $derived<Tiebreaker[]>(scoring.tiebreakers ?? ['h2h', 'diff', 'for']);
  const points = $derived(scoring.points ?? { win: 3, draw: 1, loss: 0 });

  function setPoints(k: 'win' | 'draw' | 'loss', v: number) {
    scoring = { ...scoring, points: { ...points, [k]: Number.isFinite(v) ? v : 0 } };
  }
  function moveTb(i: number) {
    const next = [...tiebreakers];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    scoring = { ...scoring, tiebreakers: next };
  }
</script>

<fieldset class="formats">
  <legend class="label">Format</legend>
  {#each formats as f (f.id)}
    <label class="fmt" class:on={format === f.id}>
      <input type="radio" name="format" value={f.id} bind:group={format} />
      <span class="fname">{f.name}</span>
      <span class="small muted">{f.blurb}</span>
    </label>
  {/each}
</fieldset>

<div class="opts">
  {#if format === 'single_elim'}
    <label class="check">
      <input type="checkbox" checked={!!options.thirdPlaceMatch} onchange={(e) => (options = { ...options, thirdPlaceMatch: e.currentTarget.checked })} />
      Play a 3rd place match
    </label>
  {:else if format === 'double_elim'}
    <label class="check">
      <input type="checkbox" checked={(options.grandFinal ?? 'reset') === 'reset'} onchange={(e) => (options = { ...options, grandFinal: e.currentTarget.checked ? 'reset' : 'single' })} />
      Grand final reset (losers-bracket player must win twice)
    </label>
  {:else}
    <label class="check">
      <input type="checkbox" checked={!!options.doubleRound} onchange={(e) => (options = { ...options, doubleRound: e.currentTarget.checked })} />
      Play everyone twice
    </label>
    <div class="pts">
      <span class="label">Points</span>
      {#each [['win', 'Win'], ['draw', 'Draw'], ['loss', 'Loss']] as [k, label]}
        <label class="pt">
          <span class="small">{label}</span>
          <input type="number" inputmode="numeric" value={points[k as 'win']} oninput={(e) => setPoints(k as 'win', e.currentTarget.valueAsNumber)} />
        </label>
      {/each}
    </div>
    <div>
      <span class="label">Tiebreakers, in order</span>
      <ol class="tbs">
        {#each tiebreakers as tb, i (tb)}
          <li>
            <span>{i + 1}. {TB_LABEL[tb]}</span>
            <button type="button" class="ghost small" disabled={i === 0} onclick={() => moveTb(i)} aria-label="Move up">↑</button>
          </li>
        {/each}
      </ol>
    </div>
  {/if}
  <label class="check">
    <input type="checkbox" checked={!!scoring.lowerWins} onchange={(e) => (scoring = { ...scoring, lowerWins: e.currentTarget.checked })} />
    Lower score wins (golf, racing times…)
  </label>
</div>

<style>
  .formats { border: 0; padding: 0; margin: 0; display: grid; gap: 6px; }
  .formats legend { margin-bottom: 6px; padding: 0; }
  .fmt {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--card);
    cursor: pointer;
  }
  .fmt.on { border-color: var(--ink); box-shadow: inset 3px 0 0 var(--accent); }
  .fmt input { grid-row: span 2; width: 18px; min-height: 0; accent-color: var(--accent); margin: 2px 0 0; }
  .fname { font-weight: 600; }
  .opts { display: grid; gap: 12px; margin-top: 14px; }
  .pts { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; }
  .pts .label { width: 100%; }
  .pt { display: grid; gap: 2px; width: 72px; }
  .tbs { list-style: none; padding: 0; margin: 4px 0 0; }
  .tbs li { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); padding: 2px 0; max-width: 320px; }
</style>

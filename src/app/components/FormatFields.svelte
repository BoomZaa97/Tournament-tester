<script lang="ts">
  import {
    defaultGroupCount, finalsSize, groupCount, maxGroups, swissDefaultRounds, swissMaxRounds, swissRoundCount,
  } from '../../core';
  import type { FinalsOptions, Format, FormatOptions, Tiebreaker } from '../../core';
  import { tiebreakersFor } from '../lib/model';
  import type { Scoring } from '../lib/model';

  interface Props {
    format: Format;
    options: FormatOptions;
    scoring: Scoring;
    /** Used for the swiss round count hint. */
    entrantCount?: number;
  }
  let { format = $bindable(), options = $bindable(), scoring = $bindable(), entrantCount = 0 }: Props = $props();

  const formats: { id: Format; name: string; blurb: string }[] = [
    { id: 'single_elim', name: 'Single elimination', blurb: 'Lose once and you are out.' },
    { id: 'double_elim', name: 'Double elimination', blurb: 'Out after two losses. Losers bracket included.' },
    { id: 'round_robin', name: 'Round robin', blurb: 'Everyone plays everyone. Best record wins.' },
    { id: 'swiss', name: 'Swiss', blurb: 'A set number of rounds. Each round you play someone on the same score. No one is knocked out.' },
    { id: 'groups', name: 'Groups', blurb: 'Players are split into small groups. Everyone plays everyone in their group, like the World Cup.' },
  ];

  const TB_LABEL: Record<Tiebreaker, string> = {
    h2h: 'Head-to-head',
    diff: 'Score difference',
    for: 'Total score',
    wins: 'Wins',
    buchholz: "Opponents' points (Buchholz)",
    omw: "Opponents' win % (OMW%)",
  };
  const tiebreakers = $derived<Tiebreaker[]>(tiebreakersFor(format, scoring));
  const n = $derived(Math.max(2, entrantCount));

  function setRounds(v: number) {
    const next = { ...options };
    if (Number.isFinite(v) && v > 0) next.swissRounds = Math.round(v);
    else delete next.swissRounds;
    options = next;
  }
  function setGroups(v: number) {
    const next = { ...options };
    if (Number.isFinite(v) && v > 0) next.groupCount = Math.round(v);
    else delete next.groupCount;
    options = next;
  }

  // ---- finals (top cut) after a points stage
  function setFinals(f: FinalsOptions | undefined) {
    const next = { ...options };
    if (f) next.finals = f;
    else delete next.finals;
    options = next;
  }
  const patchFinals = (p: Partial<FinalsOptions>) => setFinals({ ...options.finals!, ...p });
  const finalists = $derived(finalsSize(format, n, options));

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
    {#if format === 'swiss'}
      <label class="field rounds">
        <span>Rounds</span>
        <input
          type="number"
          inputmode="numeric"
          min="1"
          max={swissMaxRounds(n)}
          placeholder={String(swissDefaultRounds(n))}
          value={options.swissRounds ?? ''}
          oninput={(e) => setRounds(e.currentTarget.valueAsNumber)}
        />
      </label>
      <p class="small muted hint">
        {#if entrantCount >= 2}
          {swissDefaultRounds(n)} rounds finds a clear winner with {entrantCount} players (most possible: {swissMaxRounds(n)}).
          {#if options.swissRounds && swissRoundCount(n, options) !== options.swissRounds}Using {swissRoundCount(n, options)}.{/if}
        {:else}
          Leave blank to pick automatically from the number of players.
        {/if}
        Each round is paired when the one before it is finished.
      </p>
    {:else}
      {#if format === 'groups'}
        <label class="field rounds">
          <span>Groups</span>
          <input
            type="number"
            inputmode="numeric"
            min="1"
            max={maxGroups(n)}
            placeholder={String(defaultGroupCount(n))}
            value={options.groupCount ?? ''}
            oninput={(e) => setGroups(e.currentTarget.valueAsNumber)}
          />
        </label>
        <p class="small muted hint">
          {#if entrantCount >= 2}
            {groupCount(n, options)} groups of about {Math.round(n / groupCount(n, options))}. Leave blank for groups of about 4.
          {:else}
            Leave blank for groups of about 4.
          {/if}
          Seeds are spread so each group gets a fair mix.
        </p>
      {/if}
      <label class="check">
        <input type="checkbox" checked={!!options.doubleRound} onchange={(e) => (options = { ...options, doubleRound: e.currentTarget.checked })} />
        Play everyone {format === 'groups' ? 'in their group ' : ''}twice
      </label>
    {/if}
    <div class="finals">
      <label class="check">
        <input
          type="checkbox"
          checked={!!options.finals}
          onchange={(e) => setFinals(e.currentTarget.checked ? { format: 'single_elim', advance: format === 'groups' ? 2 : 4 } : undefined)}
        />
        Top players go on to a knockout final
      </label>
      {#if options.finals}
        <div class="finalsopts">
          <label class="field rounds">
            <span>{format === 'groups' ? 'From each group' : 'How many'}</span>
            <input
              type="number"
              inputmode="numeric"
              min="1"
              value={options.finals.advance}
              oninput={(e) => {
                const v = e.currentTarget.valueAsNumber;
                if (Number.isFinite(v) && v >= 1) patchFinals({ advance: Math.round(v) });
              }}
            />
          </label>
          <label class="field">
            <span>Finals format</span>
            <select value={options.finals.format} onchange={(e) => patchFinals({ format: e.currentTarget.value as FinalsOptions['format'] })}>
              <option value="single_elim">Single elimination</option>
              <option value="double_elim">Double elimination</option>
            </select>
          </label>
        </div>
        {#if options.finals.format === 'single_elim'}
          <label class="check">
            <input type="checkbox" checked={!!options.finals.thirdPlaceMatch} onchange={(e) => patchFinals({ thirdPlaceMatch: e.currentTarget.checked })} />
            Play a 3rd place match
          </label>
        {:else}
          <label class="check">
            <input
              type="checkbox"
              checked={(options.finals.grandFinal ?? 'reset') === 'reset'}
              onchange={(e) => patchFinals({ grandFinal: e.currentTarget.checked ? 'reset' : 'single' })}
            />
            Grand final reset
          </label>
        {/if}
        <p class="small muted hint">
          {#if entrantCount >= 2}{finalists} players go to the finals.{/if}
          When the {format === 'groups' ? 'groups are' : 'rounds are'} finished, you check who qualified (and settle any ties), then start the finals.
        </p>
      {/if}
    </div>
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
  .rounds { max-width: 120px; }
  .finals { display: grid; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .finalsopts { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
  .finalsopts .rounds { width: 120px; }
  .hint { margin: -6px 0 0; }
  .tbs li { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); padding: 2px 0; max-width: 320px; }
</style>

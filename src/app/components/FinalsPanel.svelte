<script lang="ts">
  import { finalsSize, isFinalsMatch, resolve, suggestFinalists } from '../../core';
  import type { EntrantId, TournamentState } from '../../core';
  import { standingOptions } from '../lib/model';
  import type { TournamentDoc } from '../lib/model';

  interface Props {
    doc: TournamentDoc;
    tstate: TournamentState;
    names: Map<string, string>;
    canEdit: boolean;
    /** Confirm the finalists (entrant seeds in finals seed order), or clear them with null. */
    onset: (qualified: number[] | null) => Promise<boolean>;
  }
  let { doc, tstate, names, canEdit, onset }: Props = $props();

  const finals = $derived(doc.options.finals!);
  const size = $derived(finalsSize(doc.format, doc.entrants.length, doc.options));
  const stageName = $derived(doc.format === 'groups' ? 'group stage' : 'rounds');
  const resolved = $derived([...resolve(tstate).values()]);
  const pointsDone = $derived(
    resolved.filter((m) => !isFinalsMatch(m.template)).every((m) => m.status === 'done' || m.status === 'bye'),
  );
  const finalsPlayed = $derived(resolved.some((m) => isFinalsMatch(m.template) && m.result));
  const suggestion = $derived(suggestFinalists(tstate, standingOptions(doc)));
  const confirmed = $derived(finals.qualified?.map((s) => doc.entrants[s - 1]?.id).filter(Boolean) ?? null);
  /** The standings would now pick someone else than the confirmed finalists. */
  const changed = $derived(
    !!confirmed && (confirmed.length !== suggestion.finalists.length || suggestion.finalists.some((e) => !confirmed.includes(e))),
  );

  const seedOf = (e: EntrantId) => doc.entrants.findIndex((x) => x.id === e) + 1;
  const name = (e: EntrantId) => names.get(e) ?? '?';
  const nameList = (list: EntrantId[]) => list.map(name).join(', ');

  // Organizer's working copy of the finalists, starting from the suggestion.
  let picked = $state<EntrantId[]>([]);
  $effect.pre(() => {
    if (!picked.length) picked = [...suggestion.finalists];
  });
  const dupes = $derived(new Set(picked).size !== picked.length);
  let busy = $state(false);

  function move(i: number, d: -1 | 1) {
    const next = [...picked];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    picked = next;
  }
  async function confirm(q: number[] | null) {
    busy = true;
    await onset(q);
    busy = false;
  }
</script>

<section class="panel fp">
  {#if confirmed}
    <p>
      <b>Finals:</b> {size} players, {finals.format === 'double_elim' ? 'double' : 'single'} elimination.
    </p>
    {#if changed}
      <p class="small warn">
        Not the same as the {stageName} standings, which would send
        <b>{nameList(suggestion.finalists.filter((e) => !confirmed.includes(e)))}</b> instead of
        <b>{nameList(confirmed.filter((e) => !suggestion.finalists.includes(e)))}</b>. That's fine if it was on purpose
        (a tiebreak game, a dropout); otherwise check the results.
      </p>
    {/if}
    {#if canEdit}
      {#if finalsPlayed}
        <p class="small muted">To change the finalists, clear the finals results first.</p>
      {:else}
        <button class="small" disabled={busy} onclick={() => confirm(null)}>Change finalists</button>
      {/if}
    {/if}
  {:else if !pointsDone}
    <p>
      The top {finals.advance}{doc.format === 'groups' ? ' of each group' : ''} go to the finals ({size} players). Right now that's:
    </p>
    <p class="small">{nameList(suggestion.finalists)}</p>
    <p class="small muted">The bracket fills in once the {stageName} {doc.format === 'groups' ? 'is' : 'are'} finished and the organizer confirms.</p>
  {:else if !canEdit}
    <p>The {stageName} {doc.format === 'groups' ? 'is' : 'are'} finished. Waiting for the organizer to confirm the finalists:</p>
    <p class="small">{nameList(suggestion.finalists)}</p>
  {:else}
    <h3>Confirm the finalists</h3>
    <p class="small muted">
      From the standings, in finals seed order (1 plays {size}, and so on). Swap or reorder anyone before you start.
    </p>
    {#if suggestion.tieAtCut}
      <p class="small warn">There's a tie at the cut line. Check the standings and swap in the right player if needed.</p>
    {/if}
    <ol class="picks">
      {#each picked as e, i (i)}
        <li>
          <span class="num seed">{i + 1}</span>
          <select value={e} onchange={(ev) => (picked[i] = ev.currentTarget.value)} aria-label="Finalist {i + 1}">
            {#each doc.entrants as x (x.id)}
              <option value={x.id}>{name(x.id)}</option>
            {/each}
          </select>
          <button class="ghost small" disabled={i === 0} onclick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button class="ghost small" disabled={i === picked.length - 1} onclick={() => move(i, 1)} aria-label="Move down">↓</button>
        </li>
      {/each}
    </ol>
    {#if dupes}<p class="small warn">Someone is in the list twice.</p>{/if}
    <div class="row">
      <button class="primary" disabled={busy || dupes || picked.length < 2} onclick={() => confirm(picked.map(seedOf))}>
        {busy ? 'Starting…' : 'Start finals'}
      </button>
      {#if picked.join() !== suggestion.finalists.join()}
        <button class="ghost small" onclick={() => (picked = [...suggestion.finalists])}>Back to the standings</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .fp { padding: 14px; display: grid; gap: 8px; margin-bottom: 20px; max-width: 560px; }
  .fp p, .fp h3 { margin: 0; }
  .warn { color: var(--accent); }
  .picks { list-style: none; padding: 0; margin: 4px 0; display: grid; gap: 6px; }
  .picks li { display: flex; gap: 8px; align-items: center; }
  .picks select { flex: 1; min-width: 0; }
  .seed { width: 22px; font: 700 17px var(--font-cond); }
</style>

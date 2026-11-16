<script lang="ts">
  import { BYE } from '../../core';
  import type { ResolvedMatch, Slot, Source } from '../../core';

  interface Props {
    m: ResolvedMatch;
    names: Map<string, string>;
    seeds: Map<string, number>;
    numbers: Map<string, number>;
    describe: (src: Source) => string;
    hover: string | null;
    onhover: (id: string | null) => void;
    onselect?: (id: string) => void;
  }
  let { m, names, seeds, numbers, describe, hover, onhover, onselect }: Props = $props();

  const r = $derived(m.status === 'done' ? m.result : undefined);
  const clickable = $derived(!!onselect && ['ready', 'done', 'conflict'].includes(m.status));


  function score(side: 'p1' | 'p2'): string {
    if (!r) return '';
    if (r.forfeit) return r.winner === side ? 'W' : 'FF';
    const s = side === 'p1' ? r.score1 : r.score2;
    if (s !== undefined) return String(s);
    return r.winner === side ? 'W' : r.winner === 'draw' ? 'D' : 'L';
  }

  const rows = $derived(
    (['p1', 'p2'] as const).map((side) => {
      const slot: Slot = m[side];
      const id = slot && slot !== BYE ? slot : null;
      return {
        side,
        id,
        name: id ? (names.get(id) ?? '?') : slot === BYE ? 'Bye' : describe(m.template[side]),
        seed: id ? seeds.get(id) : undefined,
        won: !!r && r.winner === side,
        lost: !!r && r.winner !== side && r.winner !== 'draw',
        tbd: !id,
      };
    }),
  );
</script>

<svelte:element
  this={clickable ? 'button' : 'div'}
  role={clickable ? undefined : 'group'}
  class="card st-{m.status}"
  class:clickable
  class:conditional={!!m.template.onlyIf}
  onclick={clickable ? () => onselect?.(m.template.id) : undefined}
  aria-label={clickable ? `Match ${numbers.get(m.template.id)}` : undefined}
>
  <span class="num">{numbers.get(m.template.id)}</span>
  <span class="rows">
    {#each rows as row (row.side)}
      <span
        class="slot"
        class:won={row.won}
        class:lost={row.lost}
        class:tbd={row.tbd}
        class:hl={row.id !== null && row.id === hover}
        onpointerenter={() => row.id && onhover(row.id)}
        onpointerleave={() => onhover(null)}
        role="presentation"
      >
        <span class="seed">{row.seed ?? ''}</span>
        <span class="name">{row.name}</span>
        <span class="score">{score(row.side)}</span>
      </span>
    {/each}
  </span>
  {#if m.status === 'skipped'}
    <span class="flag">Not needed</span>
  {:else if m.status === 'conflict'}
    <span class="flag warn">Check</span>
  {:else if m.template.onlyIf && m.status === 'waiting'}
    <span class="flag">If needed</span>
  {/if}
</svelte:element>

<style>
  .card {
    all: unset;
    box-sizing: border-box;
    position: relative;
    display: flex;
    width: var(--card-w, 210px);
    background: var(--card);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    font: 500 15px/1 var(--font);
    color: var(--ink);
    overflow: hidden;
  }
  .clickable { cursor: pointer; }
  .clickable:hover { border-color: var(--ink); }
  .clickable:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .st-ready { border-left: 4px solid var(--accent); }
  .st-conflict { border-color: var(--warn); border-left: 4px solid var(--warn); }
  .st-skipped, .st-bye { opacity: 0.5; border-style: dashed; }
  .conditional.st-waiting { border-style: dashed; }

  .num {
    flex: 0 0 22px;
    display: grid;
    place-items: center;
    font: 600 11px/1 var(--font-cond);
    color: var(--muted);
    border-right: 1px solid var(--line);
    background: var(--paper);
  }
  .rows { flex: 1; min-width: 0; display: grid; }
  .slot {
    display: grid;
    grid-template-columns: 20px 1fr auto;
    align-items: center;
    height: 30px;
    padding-right: 0;
  }
  .slot + .slot { border-top: 1px solid var(--line); }
  .seed { font-size: 11px; color: var(--muted); text-align: center; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px; }
  .score {
    min-width: 30px;
    height: 100%;
    display: grid;
    place-items: center;
    padding: 0 6px;
    font: 700 16px/1 var(--font-cond);
    border-left: 1px solid var(--line);
  }
  .won .name { font-weight: 700; }
  .won .score { background: var(--ink); color: var(--paper); border-left-color: var(--ink); }
  .lost .name, .lost .score { color: var(--muted); }
  .tbd .name { color: var(--muted); font-style: italic; font-weight: 400; font-size: 14px; }
  .hl { background: var(--accent-soft); }
  .hl .name { color: var(--ink); }

  .flag {
    position: absolute;
    top: -1px;
    right: 36px;
    font: 600 10px/1 var(--font-cond);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: var(--paper);
    color: var(--muted);
    padding: 3px 5px;
    border: 1px solid var(--line);
    border-top: 0;
  }
  .flag.warn { color: var(--warn); border-color: var(--warn); }
</style>

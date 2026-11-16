<script lang="ts">
  import { BYE } from '../../core';
  import type { MatchStatus, ResolvedMatch } from '../../core';
  import { isByeMatch } from '../lib/model';

  interface Props {
    resolved: Map<string, ResolvedMatch>;
    names: Map<string, string>;
    numbers: Map<string, number>;
    titleOf: (m: ResolvedMatch) => string;
    onselect: (id: string) => void;
  }
  let { resolved, names, numbers, titleOf, onselect }: Props = $props();

  let q = $state('');

  /** A result a player reported, by its confirmation state ('' = entered by the organizer or confirmed). */
  const check = (m: ResolvedMatch) => (m.status === 'done' && m.result?.status !== 'confirmed' ? (m.result?.status ?? '') : '');
  const is = (s: MatchStatus) => (m: ResolvedMatch) => m.status === s;

  const groups: { test: (m: ResolvedMatch) => boolean; title: string }[] = [
    { test: is('conflict'), title: 'Needs checking' },
    { test: (m) => check(m) === 'disputed', title: 'Disputed: the organizer settles these' },
    { test: is('ready'), title: 'Up next' },
    { test: is('waiting'), title: 'Waiting for earlier matches' },
    { test: (m) => check(m) === 'reported', title: 'Reported, waiting for the opponent to confirm' },
    { test: (m) => m.status === 'done' && !check(m), title: 'Completed' },
    // the only 'bye' matches listed: real byes are filtered out below, walkovers have two players
    { test: is('bye'), title: 'Walkovers (a player dropped out)' },
  ];

  const nm = (s: string | null) => (s && s !== BYE ? (names.get(s) ?? '?') : 'TBD');

  const filtered = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    // bye slots are never played (and have no number), even while still waiting for a player
    return [...resolved.values()].filter(
      (m) => !isByeMatch(m) && (!needle || [m.p1, m.p2].some((s) => nm(s).toLowerCase().includes(needle))),
    );
  });

  function score(m: ResolvedMatch) {
    if (m.walkover) return 'W/O';
    const r = m.result;
    if (!r || m.status !== 'done') return '';
    if (r.forfeit) return 'FF';
    if (r.score1 === undefined) return r.winner === 'draw' ? 'Draw' : '';
    return `${r.score1}–${r.score2}`;
  }
</script>

<div class="search">
  <input type="search" placeholder="Find a player…" bind:value={q} aria-label="Find a player" />
</div>

{#each groups as g (g.title)}
  {@const list = filtered.filter(g.test)}
  {#if list.length}
    <section>
      <h3>{g.title} <span class="count">{list.length}</span></h3>
      <ul>
        {#each list as m (m.template.id)}
          {@const r = m.status === 'done' ? m.result : m.walkover ? { winner: m.winner === m.p1 ? 'p1' : 'p2' } : undefined}
          <li>
            <button class="item st-{m.status}" onclick={() => onselect(m.template.id)} disabled={m.status === 'waiting' || m.status === 'bye'}>
              <span class="num">{numbers.get(m.template.id)}</span>
              <span class="body">
                <span class="label">{titleOf(m)}</span>
                <span class="players">
                  <span class:w={r?.winner === 'p1'} class:l={r && r.winner === 'p2'}>{nm(m.p1)}</span>
                  <span class="vs">vs</span>
                  <span class:w={r?.winner === 'p2'} class:l={r && r.winner === 'p1'}>{nm(m.p2)}</span>
                </span>
              </span>
              <span class="score">{score(m)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/each}

<style>
  .search { margin-bottom: 16px; max-width: 360px; }
  section + section { margin-top: 22px; }
  h3 { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 2px solid var(--ink); }
  .count { font-size: 13px; color: var(--muted); }
  ul { list-style: none; padding: 0; margin: 0; }
  li { border-bottom: 1px solid var(--line); }
  .item {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: grid;
    grid-template-columns: 32px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 10px 4px;
    cursor: pointer;
  }
  .item:disabled { cursor: default; }
  .item:not(:disabled):hover { background: var(--card); }
  .item:focus-visible { outline: 2px solid var(--accent); }
  .num { font: 700 16px var(--font-cond); color: var(--muted); text-align: center; }
  .st-ready .num { color: var(--accent); }
  .st-conflict .num { color: var(--warn); }
  .body { display: grid; min-width: 0; }
  .players { display: flex; flex-wrap: wrap; gap: 0 6px; font-size: 16px; }
  .vs { color: var(--muted); font-size: 14px; }
  .w { font-weight: 700; }
  .l { color: var(--muted); }
  .st-waiting .players { color: var(--muted); }
  .score { font: 700 20px var(--font-cond); padding-right: 6px; }
</style>

<script lang="ts">
  import { eliminationPlacements, roundRobinStandings } from '../../core';
  import type { TournamentState } from '../../core';
  import type { Scoring } from '../lib/model';

  interface Props {
    tstate: TournamentState;
    names: Map<string, string>;
    scoring: Scoring;
  }
  let { tstate, names, scoring }: Props = $props();

  const rr = $derived(tstate.structure.format === 'round_robin');
  const table = $derived(rr ? roundRobinStandings(tstate, scoring) : []);
  const places = $derived(rr ? [] : eliminationPlacements(tstate));
  const alive = $derived(places.filter((p) => p.place === null));
  const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
</script>

{#if rr}
  <div class="tablewrap">
    <table>
      <thead>
        <tr>
          <th class="num">#</th><th>Name</th>
          <th class="num" title="Played">P</th><th class="num" title="Wins">W</th><th class="num" title="Draws">D</th><th class="num" title="Losses">L</th>
          <th class="num hide-s" title="Score for">+</th><th class="num hide-s" title="Score against">−</th><th class="num" title="Difference">±</th>
          <th class="num">Pts</th>
        </tr>
      </thead>
      <tbody>
        {#each table as r (r.entrant)}
          <tr class:top={r.rank === 1 && r.played > 0}>
            <td class="num rank">{r.rank}</td>
            <td class="name"><a href="#/p/{r.entrant}">{names.get(r.entrant)}</a></td>
            <td class="num">{r.played}</td><td class="num">{r.wins}</td><td class="num">{r.draws}</td><td class="num">{r.losses}</td>
            <td class="num hide-s">{r.for}</td><td class="num hide-s">{r.against}</td>
            <td class="num">{r.diff > 0 ? '+' : ''}{r.diff}</td>
            <td class="num pts">{r.points}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <ol class="places">
    {#each places.filter((p) => p.place !== null) as p (p.entrant)}
      <li class:gold={p.place === 1}>
        <span class="pl">{ordinal(p.place!)}</span>
        <a href="#/p/{p.entrant}">{names.get(p.entrant)}</a>
      </li>
    {/each}
  </ol>
  {#if alive.length}
    <p class="muted small still">Still in: {alive.map((p) => names.get(p.entrant)).join(', ')}</p>
  {/if}
{/if}

<style>
  .tablewrap { overflow-x: auto; }
  .rank { font: 700 18px var(--font-cond); color: var(--muted); width: 36px; }
  .top .rank { color: var(--accent); }
  .name a { font-weight: 600; text-decoration: none; }
  .name a:hover { text-decoration: underline; }
  .pts { font: 700 18px var(--font-cond); }
  .places { list-style: none; padding: 0; margin: 0; border-top: 2px solid var(--ink); max-width: 520px; }
  .places li { display: flex; gap: 14px; align-items: baseline; padding: 10px 4px; border-bottom: 1px solid var(--line); font-size: 17px; }
  .places a { text-decoration: none; font-weight: 600; }
  .pl { font: 700 20px var(--font-cond); width: 48px; color: var(--muted); }
  .gold .pl { color: var(--accent); }
  .gold a { font-size: 20px; }
  .still { margin-top: 12px; }
  @media (max-width: 520px) { .hide-s { display: none; } td, th { padding: 8px 6px; } }
</style>

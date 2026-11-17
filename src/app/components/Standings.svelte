<script lang="ts">
  import { droppedEntrants, eliminationPlacements, finalsSize, groupStandings, overallPlacements } from '../../core';
  import type { StandingRow, TournamentState } from '../../core';
  import { hasFinals, isTableFormat, standingOptions, tableStandings } from '../lib/model';
  import type { TournamentDoc } from '../lib/model';
  import Verified from './Verified.svelte';

  interface Props {
    doc: TournamentDoc;
    tstate: TournamentState;
    names: Map<string, string>;
  }
  let { doc, tstate, names }: Props = $props();

  const rr = $derived(isTableFormat(doc.format));
  const swiss = $derived(doc.format === 'swiss');
  const table = $derived(rr ? tableStandings(doc, tstate) : []);
  const groups = $derived(doc.format === 'groups' ? [...groupStandings(tstate, standingOptions(doc))] : []);
  const finals = $derived(hasFinals(doc));
  const finalsStarted = $derived(finals && !!doc.options.finals?.qualified);
  /** Draw a line under the last place that goes to the finals. */
  const cut = $derived(
    !finals ? 0 : doc.format === 'groups' ? (doc.options.finals?.advance ?? 0) : finalsSize(doc.format, doc.entrants.length, doc.options),
  );
  const places = $derived(
    finalsStarted ? overallPlacements(tstate, standingOptions(doc)) : rr ? [] : eliminationPlacements(tstate),
  );
  const alive = $derived(places.filter((p) => p.place === null));
  const out = $derived(droppedEntrants(tstate));
  /** Leave out the draws column when nobody has drawn. */
  const draws = $derived(Object.values(doc.results).some((r) => r.winner === 'draw'));
  const pct = (x: number) => (x * 100).toFixed(1);
  const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
</script>

{#snippet pointsTable(rows: StandingRow[])}
  <div class="tablewrap">
    <table>
      <thead>
        <tr>
          <th class="num">#</th><th>Name</th>
          <th class="num hide-s" title="Played">P</th><th class="num" title="Wins">W</th>{#if draws}<th class="num" title="Draws">D</th>{/if}<th class="num" title="Losses">L</th>
          <th class="num hide-s" title="Score for">+</th><th class="num hide-s" title="Score against">−</th><th class="num" title="Difference">±</th>
          <th class="num">Pts</th>
          {#if swiss}
            <th class="num hide-s" title="Win %: wins (byes count) and half of draws, out of matches played">Win%</th>
            <th class="num" title="Opponents' win %: the average win rate of everyone this player faced">OMW%</th>
            <th class="num hide-s" title="Buchholz: total points of everyone this player has played">Opp</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each rows as r, i (r.entrant)}
          <tr class:top={r.rank === 1 && r.played > 0} class:cut={i === cut - 1 && i < rows.length - 1}>
            <td class="num rank">{r.rank}</td>
            <td class="name"><a href="#/p/{r.entrant}">{names.get(r.entrant)}</a><Verified id={r.entrant} />{#if out.has(r.entrant)} <span class="dropped">dropped</span>{/if}</td>
            <td class="num hide-s">{r.played}</td><td class="num">{r.wins}</td>{#if draws}<td class="num">{r.draws}</td>{/if}<td class="num">{r.losses}</td>
            <td class="num hide-s">{r.for}</td><td class="num hide-s">{r.against}</td>
            <td class="num">{r.diff > 0 ? '+' : ''}{r.diff}</td>
            <td class="num pts">{r.points}</td>
            {#if swiss}
              <td class="num hide-s">{pct(r.played ? (r.wins + r.draws / 2) / r.played : 0)}</td>
              <td class="num">{pct(r.omw)}</td>
              <td class="num hide-s">{r.buchholz}</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

{#snippet placeList()}
  {#if alive.length}
    <div class="label sub">Still in · {alive.length}</div>
    <ul class="alive">
      {#each alive as p (p.entrant)}
        <li><a href="#/p/{p.entrant}">{names.get(p.entrant)}</a><Verified id={p.entrant} /></li>
      {/each}
    </ul>
    {#if alive.length < places.length}<div class="label sub">Out</div>{/if}
  {/if}
  <ol class="places">
    {#each places.filter((p) => p.place !== null) as p (p.entrant)}
      <li class:gold={p.place === 1}>
        <span class="pl">{ordinal(p.place!)}</span>
        <a href="#/p/{p.entrant}">{names.get(p.entrant)}</a><Verified id={p.entrant} />
        {#if out.has(p.entrant)}<span class="dropped">dropped</span>{/if}
      </li>
    {/each}
  </ol>
{/snippet}

{#if rr}
  {#if finalsStarted}
    <h3 class="head">Final placings</h3>
    {@render placeList()}
    <h3 class="head">{doc.format === 'groups' ? 'Groups' : 'Points stage'}</h3>
  {/if}
  {#if doc.format === 'groups'}
    {#each groups as [label, rows] (label)}
      <h4 class="group">Group {label}</h4>
      {@render pointsTable(rows)}
    {/each}
  {:else}
    {@render pointsTable(table)}
  {/if}
  {#if cut}
    <p class="small muted note">
      Above the line: {doc.format === 'groups' ? `the top ${cut} of each group go` : `the top ${cut} go`} to the finals.
    </p>
  {/if}
  {#if swiss}
    <p class="small muted note">
      A bye counts as a win. <b>OMW%</b> is the average win rate of everyone a player has faced (each counted as at least
      33%): if you lost to strong players, you rank above someone on the same points who played weaker ones. <b>Opp</b> is
      the same idea as total points (Buchholz). Tiebreakers are applied in the order set in Edit.
    </p>
  {/if}
{:else}
  {@render placeList()}
{/if}

<style>
  .tablewrap { overflow-x: auto; }
  tr.cut td { border-bottom: 2px solid var(--accent); }
  .head { margin: 0 0 8px; }
  .head:not(:first-child) { margin-top: 28px; }
  .group { margin: 18px 0 6px; font: 700 16px var(--font-cond); letter-spacing: 0.05em; text-transform: uppercase; }
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
  .sub { margin: 0 0 6px; }
  .alive { list-style: none; padding: 0; margin: 0 0 24px; display: flex; flex-wrap: wrap; gap: 6px; max-width: 720px; }
  .alive a {
    display: block; padding: 6px 10px; border: 1px solid var(--line-strong); border-radius: var(--radius);
    background: var(--card); text-decoration: none; font-weight: 600;
  }
  .alive a:hover { border-color: var(--ink); }
  .dropped { font: 600 12px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .note { margin-top: 10px; max-width: 560px; }
  @media (max-width: 520px) { .hide-s { display: none; } td, th { padding: 8px 6px; } .name { overflow-wrap: anywhere; } }
</style>

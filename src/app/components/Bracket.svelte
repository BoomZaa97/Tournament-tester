<script lang="ts">
  import { BYE, isFinalsMatch } from '../../core';
  import type { Format, ResolvedMatch, StandingRow } from '../../core';
  import { describeSource, isByeMatch, roundName } from '../lib/model';
  import MatchCard from './MatchCard.svelte';

  interface Props {
    format: Format;
    resolved: Map<string, ResolvedMatch>;
    names: Map<string, string>;
    seeds: Map<string, number>;
    numbers: Map<string, number>;
    /** Points stage (rounds / groups) or the knockout finals after it. Plain brackets: 'points'. */
    stage?: 'points' | 'finals';
    /** Groups: each group's table, drawn next to its rounds. */
    groupTables?: Map<string, StandingRow[]>;
    /** Show a draws column in the group tables. */
    draws?: boolean;
    /** Groups with finals: places per group that go through (a line under the last one). */
    cut?: number;
    onselect?: (id: string) => void;
  }
  let { format, resolved, names, seeds, numbers, stage = 'points', groupTables, draws = false, cut = 0, onselect }: Props = $props();

  let hover = $state<string | null>(null);

  interface Section {
    key: string;
    title: string;
    group?: string;
    /** Rounds of a points table (no connector lines). */
    table: boolean;
    columns: { title: string; matches: ResolvedMatch[]; note?: string }[];
  }

  const sections = $derived.by<Section[]>(() => {
    const all = [...resolved.values()].filter((m) => isFinalsMatch(m.template) === (stage === 'finals'));
    const templates = all.map((m) => m.template);
    const build = (key: string, title: string, side: string, group?: string): Section => {
      const ms = all.filter((m) => m.template.side === side && (!group || m.template.group === group));
      const rounds = [...new Set(ms.map((m) => m.template.round))].sort((a, b) => a - b);
      return {
        key,
        title,
        group,
        table: side === 'RR' || side === 'SW',
        columns: rounds
          .map((r) => {
            const col = ms.filter((m) => m.template.round === r).sort((a, b) => a.template.index - b.template.index);
            // swiss: a round is paired only once the round before it is finished
            const unpaired = side === 'SW' && col.every((m) => m.p1 === null);
            const note = unpaired ? `Paired when round ${r - 1} is finished` : undefined;
            const title = roundName(col[0].template, templates, format).replace(/^Group \w+ · /, '');
            return { title, matches: col, note };
          })
          // a column made only of byes (e.g. Losers Round 1 with 6 players) is noise
          .filter((c) => c.matches.some((m) => !isByeMatch(m))),
      };
    };
    if (stage === 'points' && format === 'groups') {
      const labels = [...new Set(all.map((m) => m.template.group!))];
      return labels.map((g) => build(`G-${g}`, `Group ${g}`, 'RR', g));
    }
    if (stage === 'points' && format === 'round_robin') return [build('RR', '', 'RR')];
    if (stage === 'points' && format === 'swiss') return [build('SW', '', 'SW')];
    if (!all.some((m) => m.template.side === 'GF')) {
      const s = [build('W', '', 'W')];
      if (all.some((m) => m.template.side === '3P')) s.push(build('3P', '3rd place match', '3P'));
      return s;
    }
    const gf = build('GF', 'Grand final', 'GF');
    return [build('W', 'Winners bracket', 'W'), build('L', 'Losers bracket', 'L'), gf];
  });

  // ---- connector lines, measured from the real card positions
  let lines = $state<Record<string, { d: string; on: boolean }[]>>({});
  const containers: Record<string, HTMLElement> = {};

  function measure() {
    const out: typeof lines = {};
    for (const s of sections) {
      const box = containers[s.key];
      if (!box || s.table) continue;
      const origin = box.getBoundingClientRect();
      const pos = new Map<string, DOMRect>();
      box.querySelectorAll<HTMLElement>('[data-mid]').forEach((el) => {
        if (el.dataset.hidden !== 'true') pos.set(el.dataset.mid!, el.getBoundingClientRect());
      });
      const paths: { d: string; on: boolean }[] = [];
      for (const col of s.columns) {
        for (const m of col.matches) {
          const to = pos.get(m.template.id);
          if (!to) continue;
          for (const side of ['p1', 'p2'] as const) {
            const src = m.template[side];
            if (src.type !== 'winner') continue;
            const from = pos.get(src.match);
            if (!from) continue;
            const x1 = from.right - origin.left + box.scrollLeft;
            const y1 = from.top + from.height / 2 - origin.top;
            const x2 = to.left - origin.left + box.scrollLeft;
            const y2 = to.top + (side === 'p1' ? to.height * 0.27 : to.height * 0.73) - origin.top;
            const xm = x1 + (x2 - x1) / 2;
            const feeder = resolved.get(src.match);
            paths.push({ d: `M${x1} ${y1}H${xm}V${y2}H${x2}`, on: feeder?.status === 'done' || feeder?.status === 'bye' });
          }
        }
      }
      out[s.key] = paths;
    }
    lines = out;
  }

  $effect(() => {
    void sections; // re-measure when the bracket changes
    const id = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    for (const el of Object.values(containers)) if (el) ro.observe(el);
    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  });

  /** Hide pure bye matches but keep their space so the tree stays aligned. */
  const hidden = isByeMatch;
  const describe = (src: Parameters<typeof describeSource>[0]) => describeSource(src, resolved, numbers);
</script>

{#snippet groupTable(rows: StandingRow[])}
  <table class="mini">
    <thead>
      <tr>
        <th class="num">#</th><th>Name</th><th class="num" title="Wins">W</th>
        {#if draws}<th class="num" title="Draws">D</th>{/if}
        <th class="num" title="Losses">L</th><th class="num" title="Difference">±</th><th class="num">Pts</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r, i (r.entrant)}
        <tr
          class:cut={i === cut - 1 && i < rows.length - 1}
          class:hl={hover === r.entrant}
          onpointerenter={() => (hover = r.entrant)}
          onpointerleave={() => (hover = null)}
        >
          <td class="num rank">{r.rank}</td>
          <td class="nm"><a href="#/p/{r.entrant}">{names.get(r.entrant)}</a></td>
          <td class="num">{r.wins}</td>
          {#if draws}<td class="num">{r.draws}</td>{/if}
          <td class="num">{r.losses}</td>
          <td class="num">{r.diff > 0 ? '+' : ''}{r.diff}</td>
          <td class="num pts">{r.points}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#each sections as s (s.key)}
  {@const rows = s.group ? groupTables?.get(s.group) : undefined}
  <section class="section" class:grouped={!!rows}>
    {#if s.title}<h3 class="title">{s.title}</h3>{/if}
    {#if rows}{@render groupTable(rows)}{/if}
    <div class="scroller" bind:this={containers[s.key]} class:rr={s.table}>
      <svg class="lines" aria-hidden="true">
        {#each lines[s.key] ?? [] as l}
          <path d={l.d} class:on={l.on} />
        {/each}
      </svg>
      {#each s.columns as col}
        <div class="col">
          <div class="label colhead">{col.title}</div>
          {#if col.note}<div class="small muted colnote">{col.note}</div>{/if}
          <div class="stack">
            {#each col.matches as m (m.template.id)}
              {#if s.key === 'SW' && hidden(m)}
                <!-- swiss bye: say who sits out instead of leaving a gap -->
                {#if m.p1 && m.p1 !== BYE}
                  <div class="byeline small"><span class="muted">Bye</span> {names.get(m.p1) ?? '?'} <span class="muted">· counts as a win</span></div>
                {/if}
              {:else}
                <div class="cell" data-mid={m.template.id} data-hidden={hidden(m)} class:hidden={hidden(m)}>
                  <MatchCard {m} {names} {seeds} {numbers} {describe} {hover} onhover={(id) => (hover = id)} {onselect} />
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </section>
{/each}

<style>
  .section + .section { margin-top: 28px; }
  .title {
    padding-bottom: 6px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--line);
  }
  .scroller {
    position: relative;
    display: flex;
    gap: 36px;
    overflow-x: auto;
    padding: 4px 2px 16px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }
  /* rounds of a points table have no connector lines: wrap onto the next line instead of scrolling */
  .scroller.rr { gap: 22px 16px; flex-wrap: wrap; overflow-x: visible; }
  .lines {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .lines path {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1.5;
  }
  .lines path.on { stroke: var(--ink-2); }
  .col {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
  }
  .colhead {
    height: 28px;
    display: flex;
    align-items: center;
    white-space: nowrap;
  }
  .stack {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    gap: 14px;
  }
  .rr .stack { justify-content: flex-start; gap: 10px; }
  .cell { position: relative; z-index: 1; }
  .colnote { margin: -4px 0 8px; max-width: var(--card-w, 210px); }
  .byeline {
    box-sizing: border-box;
    width: var(--card-w, 210px);
    padding: 6px 8px;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius);
  }
  .cell.hidden { visibility: hidden; }

  /* groups: the group's table on the left, its rounds on the right */
  .grouped {
    display: grid;
    grid-template-columns: minmax(250px, 300px) minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    column-gap: 28px;
  }
  .grouped .title { grid-column: 1 / -1; }
  .grouped .scroller { padding-top: 0; }
  .mini { align-self: start; margin-top: 4px; font-size: 15px; }
  .mini th { padding: 6px 6px; height: 28px; }
  .mini td { padding: 6px 6px; }
  .mini .rank { font: 700 16px var(--font-cond); color: var(--muted); width: 26px; }
  .mini .nm { max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mini .nm a { text-decoration: none; font-weight: 600; }
  .mini .nm a:hover { text-decoration: underline; }
  .mini .pts { font: 700 16px var(--font-cond); }
  .mini tr.cut td { border-bottom: 2px solid var(--accent); }
  .mini tr.hl td { background: var(--accent-soft); }

  @media (max-width: 900px) {
    .grouped { display: block; }
    .mini { max-width: 420px; margin-bottom: 14px; }
  }
  @media (max-width: 600px) {
    .scroller { --card-w: 176px; gap: 26px; }
    /* rounds of a points table: one under the other, full width, no sideways scrolling */
    .scroller.rr { --card-w: 100%; flex-direction: column; gap: 18px; overflow-x: visible; padding-bottom: 4px; }
    .rr .colhead { height: 24px; }
  }
  @media print {
    .scroller { overflow: visible; flex-wrap: nowrap; }
  }
</style>

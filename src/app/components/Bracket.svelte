<script lang="ts">
  import type { Format, ResolvedMatch } from '../../core';
  import { describeSource, isByeMatch, roundName } from '../lib/model';
  import MatchCard from './MatchCard.svelte';

  interface Props {
    format: Format;
    resolved: Map<string, ResolvedMatch>;
    names: Map<string, string>;
    seeds: Map<string, number>;
    numbers: Map<string, number>;
    onselect?: (id: string) => void;
  }
  let { format, resolved, names, seeds, numbers, onselect }: Props = $props();

  let hover = $state<string | null>(null);

  interface Section {
    key: string;
    title: string;
    columns: { title: string; matches: ResolvedMatch[] }[];
  }

  const sections = $derived.by<Section[]>(() => {
    const all = [...resolved.values()];
    const templates = all.map((m) => m.template);
    const build = (key: string, title: string, side: string): Section => {
      const ms = all.filter((m) => m.template.side === side);
      const rounds = [...new Set(ms.map((m) => m.template.round))].sort((a, b) => a - b);
      return {
        key,
        title,
        columns: rounds
          .map((r) => {
            const col = ms.filter((m) => m.template.round === r).sort((a, b) => a.template.index - b.template.index);
            return { title: roundName(col[0].template, templates, format), matches: col };
          })
          // a column made only of byes (e.g. Losers Round 1 with 6 players) is noise
          .filter((c) => c.matches.some((m) => !isByeMatch(m))),
      };
    };
    if (format === 'round_robin') return [build('RR', '', 'RR')];
    if (format === 'single_elim') {
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
      if (!box || s.key === 'RR') continue;
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

{#each sections as s (s.key)}
  <section class="section">
    {#if s.title}<h3 class="title">{s.title}</h3>{/if}
    <div class="scroller" bind:this={containers[s.key]} class:rr={s.key === 'RR'}>
      <svg class="lines" aria-hidden="true">
        {#each lines[s.key] ?? [] as l}
          <path d={l.d} class:on={l.on} />
        {/each}
      </svg>
      {#each s.columns as col}
        <div class="col">
          <div class="label colhead">{col.title}</div>
          <div class="stack">
            {#each col.matches as m (m.template.id)}
              <div class="cell" data-mid={m.template.id} data-hidden={hidden(m)} class:hidden={hidden(m)}>
                <MatchCard {m} {names} {seeds} {numbers} {describe} {hover} onhover={(id) => (hover = id)} {onselect} />
              </div>
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
  .scroller.rr { gap: 16px; }
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
  .cell.hidden { visibility: hidden; }

  @media (max-width: 600px) {
    .scroller { --card-w: 176px; gap: 26px; }
  }
  @media print {
    .scroller { overflow: visible; flex-wrap: nowrap; }
  }
</style>

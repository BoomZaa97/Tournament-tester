<script lang="ts">
  import { START_RATING } from '../lib/ranking';
  import type { RatingPoint } from '../lib/ranking';

  interface Props {
    points: RatingPoint[];
  }
  let { points }: Props = $props();

  const W = 640;
  const H = 180;
  const pad = { l: 44, r: 14, t: 14, b: 22 };

  // the start (1500) is the first point, so a single event still draws a line
  const series = $derived([{ rating: START_RATING, tournamentName: 'Start', tournamentId: '', at: '' }, ...points]);
  const lo = $derived(Math.floor((Math.min(...series.map((p) => p.rating)) - 15) / 25) * 25);
  const hi = $derived(Math.ceil((Math.max(...series.map((p) => p.rating)) + 15) / 25) * 25);
  const x = (i: number) => pad.l + (series.length > 1 ? (i / (series.length - 1)) * (W - pad.l - pad.r) : 0);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const path = $derived(series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.rating).toFixed(1)}`).join(''));
  const ticks = $derived.by(() => {
    const step = Math.max(25, Math.ceil((hi - lo) / 4 / 25) * 25);
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  });
  let hover = $state<number | null>(null);
  const shownIndex = $derived(hover ?? series.length - 1);
</script>

<figure class="chart">
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="Rating after each tournament">
    {#each ticks as v}
      <line class="grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
      <text class="tick" x={pad.l - 8} y={y(v) + 4} text-anchor="end">{v}</text>
    {/each}
    {#if START_RATING > lo && START_RATING < hi}
      <line class="base" x1={pad.l} x2={W - pad.r} y1={y(START_RATING)} y2={y(START_RATING)} />
    {/if}
    <path d={path} class="line" />
    {#each series as p, i}
      <circle
        cx={x(i)}
        cy={y(p.rating)}
        r={i === shownIndex ? 5 : 3}
        class:last={i === shownIndex}
        role="presentation"
        onpointerenter={() => (hover = i)}
        onpointerleave={() => (hover = null)}
      />
    {/each}
  </svg>
  <figcaption class="small">
    {#if series[shownIndex]}
      <b>{Math.round(series[shownIndex].rating)}</b>
      <span class="muted">{shownIndex === 0 ? 'starting rating' : `after ${series[shownIndex].tournamentName}`}</span>
    {/if}
  </figcaption>
</figure>

<style>
  .chart { margin: 0; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .base { stroke: var(--line-strong); stroke-dasharray: 4 4; }
  .tick { font: 500 11px var(--font); fill: var(--muted); }
  .line { fill: none; stroke: var(--ink); stroke-width: 2; stroke-linejoin: round; }
  circle { fill: var(--card); stroke: var(--ink); stroke-width: 1.5; cursor: default; }
  circle.last { fill: var(--accent); stroke: var(--accent); }
  figcaption { margin-top: 4px; min-height: 20px; }
  figcaption b { font: 700 17px var(--font-cond); margin-right: 6px; }
</style>

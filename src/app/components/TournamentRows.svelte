<script lang="ts">
  import { gameOf } from '../lib/games';
  import TierTag from './TierTag.svelte';
  import OfficialTag from './OfficialTag.svelte';
  import { categoryOf, FORMAT_LABEL, STATUS_LABEL, tierOf } from '../lib/model';
  import type { Status, TournamentDoc } from '../lib/model';

  export interface Row {
    t: TournamentDoc;
    status: Status;
    played: number;
    total: number;
    champion: string | null;
  }
  interface Props {
    rows: Row[];
    empty?: string;
  }
  let { rows, empty = 'Nothing here.' }: Props = $props();
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<ul class="list">
  {#each rows as { t, status, played, total, champion } (t.id)}
    <li>
      <a href="#/t/{t.id}">
        <span class="name">{t.name || 'Untitled'}</span>
        <span class="meta">
          {#if gameOf(t)}<span>{gameOf(t)}</span>{/if}
          {#if categoryOf(t)}<span>{categoryOf(t)}</span>{/if}
          {#if t.official === 'yes'}<span><OfficialTag official={t.official} /></span>{/if}
          {#if tierOf(t) !== 'small'}<span><TierTag tier={t.tier} /></span>{/if}
          <span>{FORMAT_LABEL[t.format]}</span>
          <span>{t.entrants.length} entrants</span>
          <span>{date(t.createdAt)}</span>
        </span>
        {#if champion}
          <span class="extra"><span class="label">Champion</span> <b>{champion}</b></span>
        {:else if status === 'running' && total}
          <span class="extra">
            <span class="bar" aria-hidden="true"><span style="width: {(100 * played) / total}%"></span></span>
            {played} of {total} matches played
          </span>
        {/if}
        <span class="status s-{status}">{STATUS_LABEL[status]}</span>
      </a>
    </li>
  {:else}
    <li class="muted small none">{empty}</li>
  {/each}
</ul>

<style>
  .list { list-style: none; margin: 0; padding: 0; border-top: 2px solid var(--ink); }
  .list li { border-bottom: 1px solid var(--line); }
  .list a { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 14px 4px; text-decoration: none; }
  .list a:hover .name { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
  .name { font-family: var(--font-cond); font-weight: 700; font-size: 22px; text-transform: uppercase; line-height: 1.1; }
  .meta { grid-column: 1; display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--muted); font-size: 14px; }
  .extra { grid-column: 1; display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--ink-2); margin-top: 2px; }
  .extra .label { color: var(--accent); }
  .extra b { color: var(--ink); }
  .bar { width: 64px; height: 5px; background: var(--line); border-radius: 1px; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--accent); }
  .status {
    grid-column: 2; grid-row: 1 / span 3; align-self: center;
    font: 600 13px/1 var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase;
    padding: 6px 8px; border: 1px solid var(--line-strong); border-radius: var(--radius);
  }
  .s-running { border-color: var(--accent); color: var(--accent); }
  .s-finished { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .none { padding: 14px 4px; }
</style>

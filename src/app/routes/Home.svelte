<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import TierTag from '../components/TierTag.svelte';
  import { FORMAT_LABEL, STATUS_LABEL, summaryOf, tierOf } from '../lib/model';
  import type { TournamentDoc } from '../lib/model';

  const newestFirst = (list: TournamentDoc[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // what this device saw last time, until the sheet answers
  const seen = app.store.peekAll();
  let tournaments = $state<TournamentDoc[] | null>(seen ? newestFirst(seen.tournaments) : null);
  let error = $state('');
  let filter = $state<'all' | 'running' | 'setup' | 'finished'>('all');

  app.store
    .loadAll()
    .then((d) => {
      tournaments = newestFirst(d.tournaments);
      error = '';
    })
    .catch((e) => (error = errorText(e)));

  let q = $state('');
  const PAGE = 30;
  let shown = $state(PAGE);
  // worked out once per load, not on every keystroke in the search box
  const summaries = $derived((tournaments ?? []).map((t) => ({ t, ...summaryOf(t) })));
  const matches = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return summaries
      .filter((r) => filter === 'all' || r.status === filter)
      .filter(({ t }) => !needle || [t.name, t.game, t.category, t.code].some((s) => s?.toLowerCase().includes(needle)));
  });
  const rows = $derived(matches.slice(0, shown));

  let code = $state('');
  let joinError = $state('');
  let joining = $state(false);

  async function join() {
    if (!code.trim()) return;
    joining = true;
    joinError = '';
    try {
      const t = await app.store.findByCode(code);
      app.go(`j/${t.id}`);
    } catch (e) {
      joinError = errorText(e);
    } finally {
      joining = false;
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<div class="wrap page">
  <div class="head">
    <h1>Tournaments</h1>
    <a class="btn primary" href="#/new">+ New tournament</a>
  </div>

  <form class="join" onsubmit={(e) => { e.preventDefault(); join(); }}>
    <label class="field">
      <span>Join with code</span>
      <span class="row">
        <input bind:value={code} placeholder="e.g. K7QM2X" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        <button type="submit" disabled={!code.trim() || joining}>{joining ? 'Looking…' : 'Open'}</button>
      </span>
    </label>
    {#if joinError}<p class="small err">{joinError}</p>{/if}
  </form>

  {#if app.store.kind === 'local'}
    <p class="notice small">
      Saved in this browser only. To share brackets with other people, connect a Google Sheet in
      <a href="#/settings">Settings</a>.
    </p>
  {/if}

  {#if error && tournaments}
    <p class="notice small">Can't reach the sheet ({error}). Showing what this device saw last time.</p>
  {/if}
  {#if error && !tournaments}
    <p class="notice">Couldn't load tournaments: {error}</p>
  {:else if tournaments === null}
    <p class="muted">Loading…</p>
  {:else if tournaments.length === 0}
    <div class="empty">
      <p>No tournaments yet.</p>
      <a class="btn primary" href="#/new">Make your first bracket</a>
    </div>
  {:else}
    <div class="filters" role="tablist">
      {#each [['all', 'All'], ['running', 'In progress'], ['setup', 'Not started'], ['finished', 'Finished']] as [k, label]}
        <button class="ghost small" class:on={filter === k} onclick={() => ((filter = k as typeof filter), (shown = PAGE))}>{label}</button>
      {/each}
      {#if tournaments.length > 8}
        <input class="search" type="search" placeholder="Search name, game or code" bind:value={q} oninput={() => (shown = PAGE)} aria-label="Search tournaments" />
      {/if}
    </div>
    <ul class="list">
      {#each rows as { t, status, played, total, champion } (t.id)}
        <li>
          <a href="#/t/{t.id}">
            <span class="name">{t.name || 'Untitled'}</span>
            <span class="meta">
              {#if t.game}<span>{t.game}</span>{/if}
              {#if t.category}<span>{t.category}</span>{/if}
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
        <li class="muted small none">{q.trim() ? `Nothing matches “${q.trim()}”.` : 'Nothing here.'}</li>
      {/each}
    </ul>
    {#if matches.length > shown}
      <div class="more">
        <button class="ghost" onclick={() => (shown += PAGE)}>Show more</button>
        <span class="small muted">{shown} of {matches.length}</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .page { padding-top: 28px; }
  .head { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .filters { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
  .filters .on { border-color: var(--ink); }
  .search { margin-left: auto; flex: 0 1 260px; min-width: 0; }
  .more { display: flex; align-items: center; gap: 12px; padding-top: 14px; }
  @media (max-width: 520px) { .search { margin-left: 0; flex: 1 1 100%; } }
  .list { list-style: none; margin: 0; padding: 0; border-top: 2px solid var(--ink); }
  .list li { border-bottom: 1px solid var(--line); }
  .list a {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 12px;
    padding: 14px 4px;
    text-decoration: none;
  }
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
  .notice { margin-bottom: 20px; }
  .join { max-width: 360px; margin-bottom: 24px; }
  .join .row { flex-wrap: nowrap; }
  .join input { flex: 1; min-width: 0; font: 700 18px var(--font-cond); letter-spacing: 0.14em; text-transform: uppercase; }
  .join input::placeholder { letter-spacing: 0.05em; font-weight: 500; text-transform: none; }
  .err { color: var(--danger); margin: 6px 0 0; }
</style>

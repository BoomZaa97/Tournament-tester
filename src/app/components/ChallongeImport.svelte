<script lang="ts">
  import TierPicker from './TierPicker.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import { fromChallonge } from '../lib/challonge';
  import { canonicalGame } from '../lib/games';
  import type { ChTournament, Imported } from '../lib/challonge';
  import { emptyDoc, FORMAT_LABEL, logEntry } from '../lib/model';
  import type { Player, Tier } from '../lib/model';

  let { known }: { known: Player[] } = $props();

  let open = $state(false);
  let link = $state('');
  // the key is only sent through the Google script to Challonge: never saved on this device or in the sheet
  let apiKey = $state('');
  let fetching = $state(false);
  let saving = $state(false);
  let raw = $state<ChTournament | null>(null);
  let tier = $state<Tier>('small');
  const got = $derived<Imported | null>(raw ? fromChallonge(raw, known) : null);
  const newPlayers = $derived(got ? got.created.length : 0);

  async function fetchIt() {
    if (!app.store.challonge || !link.trim() || !apiKey.trim()) return;
    fetching = true;
    raw = null;
    try {
      raw = await app.store.challonge(link.trim(), apiKey.trim());
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      fetching = false;
    }
  }

  async function create() {
    if (!got || !raw) return;
    saving = true;
    try {
      const doc = emptyDoc();
      const when = raw.started_at || raw.created_at;
      const saved = await app.store.save(
        {
          ...doc,
          name: got.name,
          game: canonicalGame(got.game ?? ''),
          tier,
          format: got.format,
          options: got.options,
          entrants: got.entrants,
          results: got.results,
          ...(when && !isNaN(Date.parse(when)) ? { createdAt: new Date(when).toISOString() } : {}),
          log: [logEntry(`Imported from Challonge (${got.imported} results)`)],
        },
        got.created,
      );
      apiKey = '';
      app.notify('Imported. You are its organizer on this device.');
      app.go(`t/${saved.id}`);
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      saving = false;
    }
  }
</script>

<section class="panel imp">
  {#if !open}
    <div class="row head">
      <div>
        <b>Moving from Challonge?</b>
        <span class="small muted">Bring a tournament over with its players and results.</span>
      </div>
      <button class="small" onclick={() => (open = true)}>Import from Challonge</button>
    </div>
  {:else}
    <div class="row head">
      <b>Import from Challonge</b>
      <span class="spacer"></span>
      <button class="small ghost" onclick={() => { open = false; raw = null; apiKey = ''; }}>Close</button>
    </div>
    <form class="form" onsubmit={(e) => { e.preventDefault(); fetchIt(); }}>
      <label class="field">
        <span>Challonge link</span>
        <input bind:value={link} placeholder="https://challonge.com/abc123" inputmode="url" autocomplete="off" />
      </label>
      <label class="field">
        <span>Your Challonge API key</span>
        <input bind:value={apiKey} type="password" autocomplete="off" placeholder="Paste the key" />
      </label>
      <p class="small muted">
        Challonge only shares tournaments with a key: on challonge.com go to Settings → Developer API and copy your key.
        It's used once to read this tournament and is never saved.
      </p>
      <div class="row">
        <button type="submit" disabled={fetching || !link.trim() || !apiKey.trim()}>{fetching ? 'Reading Challonge…' : 'Read tournament'}</button>
      </div>
    </form>

    {#if got}
      <div class="found">
        <h3>{got.name}</h3>
        <dl>
          <dt>Game</dt><dd>{got.game || '–'}</dd>
          <dt>Format</dt><dd>{FORMAT_LABEL[got.format]}</dd>
          <dt>Players</dt><dd class="num">{got.entrants.length}{newPlayers ? ` (${newPlayers} new to this site)` : ''}</dd>
          <dt>Results</dt><dd class="num">{got.imported}</dd>
        </dl>
        {#each got.notes as n}<p class="notice small">{n}</p>{/each}
        {#if got.skipped.length}
          <div class="notice small">
            <b>{got.skipped.length} {got.skipped.length === 1 ? 'result' : 'results'} couldn't be placed in the bracket here</b>: those players never meet in it (a friendly, or seeding changed by hand on Challonge).
            Enter them yourself after the import if needed:
            <ul>{#each got.skipped.slice(0, 8) as s}<li>{s}</li>{/each}</ul>
            {#if got.skipped.length > 8}<span>…and {got.skipped.length - 8} more</span>{/if}
          </div>
        {/if}
        <TierPicker bind:tier />
        <div class="row">
          <button class="primary" onclick={create} disabled={saving || got.entrants.length < 2}>{saving ? 'Creating…' : 'Create tournament from this'}</button>
          {#if got.entrants.length < 2}<span class="small muted">It needs at least 2 players.</span>{/if}
        </div>
        <p class="small muted">Everything can be changed afterwards in the Edit tab, like any tournament.</p>
      </div>
    {/if}
  {/if}
</section>

<style>
  .imp { padding: 12px 14px; margin-bottom: 22px; display: grid; gap: 12px; max-width: 640px; }
  .head { justify-content: space-between; }
  .head > div { display: grid; gap: 2px; min-width: 0; }
  .head button { white-space: normal; }
  .form { display: grid; gap: 12px; }
  .form p { margin: 0; }
  .found { display: grid; gap: 10px; border-top: 1px solid var(--line); padding-top: 12px; }
  .found h3 { margin: 0; }
  .found p { margin: 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; }
  dt { font: 600 13px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); align-self: center; }
  dd { margin: 0; }
  ul { margin: 6px 0 0; padding-left: 18px; }
</style>

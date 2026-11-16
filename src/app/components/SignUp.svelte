<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { myPin } from '../lib/store';
  import type { TournamentDoc } from '../lib/model';

  interface Props {
    doc: TournamentDoc;
    names: Map<string, string>;
    onjoined: (doc: TournamentDoc) => void;
  }
  let { doc, names, onjoined }: Props = $props();

  let name = $state('');
  let busy = $state(false);
  let error = $state('');
  let mine = $state(myPin(doc.id));

  const open = $derived(!!doc.signup && !!app.store.signup && Object.keys(doc.results).length === 0);
  const joined = $derived(!!mine && names.has(mine.playerId));
  const waitPlace = $derived(mine ? (doc.waitlist ?? []).findIndex((w) => w.id === mine!.playerId) + 1 : 0);
  /** Self sign-up would put you on the waitlist: the limit is reached, or others are already waiting. */
  const full = $derived(!!doc.maxPlayers && (doc.entrants.length >= doc.maxPlayers || (doc.waitlist?.length ?? 0) > 0));

  async function join() {
    if (!name.trim() || !app.store.signup) return;
    busy = true;
    error = '';
    try {
      const r = await app.store.signup(doc.id, name.trim());
      mine = { playerId: r.playerId, pin: r.pin };
      app.notify(r.waitlisted ? "You're on the waitlist" : "You're in");
      onjoined(r.tournament);
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if joined}
  <div class="panel box">
    <p>You're in as <b>{names.get(mine!.playerId)}</b>. Your PIN is <b class="pin">{mine!.pin}</b>.</p>
    <p class="small muted">You need it to report your own scores. This device remembers it; write it down for other devices.</p>
  </div>
{:else if waitPlace}
  <div class="panel box">
    <p>
      You're on the waitlist as <b>{doc.waitlist![waitPlace - 1].name}</b>, number <b>{waitPlace}</b>.
      Your PIN is <b class="pin">{mine!.pin}</b>.
    </p>
    <p class="small muted">If a spot opens, the organizer moves people up in order. Keep your PIN: you'll need it to play.</p>
  </div>
{:else if open}
  <form class="panel box" onsubmit={(e) => { e.preventDefault(); join(); }}>
    <div>
      <b>Sign-up is open.</b>
      {#if full}
        <span class="small muted">All {doc.maxPlayers} spots are taken: you'll go on the waitlist.</span>
      {:else}
        <span class="small muted">Add yourself to this tournament.</span>
      {/if}
    </div>
    <div class="row">
      <input bind:value={name} placeholder="Your name or team" maxlength="60" aria-label="Your name or team" />
      <button class="primary" type="submit" disabled={!name.trim() || busy}>
        {busy ? 'Joining…' : full ? 'Join waitlist' : 'Join'}
      </button>
    </div>
    {#if error}<p class="small err">{error}</p>{/if}
  </form>
{/if}

<style>
  .box { padding: 12px 14px; display: grid; gap: 8px; margin-top: 16px; max-width: 560px; }
  .row { flex-wrap: nowrap; }
  .row input { flex: 1; min-width: 0; }
  .pin { font: 700 20px var(--font-cond); letter-spacing: 0.12em; color: var(--accent); }
  .err { color: var(--danger); }
  .box p { margin: 0; }
</style>

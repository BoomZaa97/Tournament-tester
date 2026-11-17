<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { myPin } from '../lib/store';
  import type { TournamentDoc } from '../lib/model';

  interface Props {
    doc: TournamentDoc;
    names: Map<string, string>;
    canEdit: boolean;
    onchange: (doc: TournamentDoc) => void;
    /** Organizer: take everyone who hasn't checked in out of the bracket. */
    onnoshows: () => Promise<boolean>;
  }
  let { doc, names, canEdit, onchange, onnoshows }: Props = $props();

  const here = $derived(new Set(doc.checkedIn ?? []));
  const count = $derived(doc.entrants.filter((e) => here.has(e.id)).length);
  const missing = $derived(doc.entrants.filter((e) => !here.has(e.id)));
  // re-read when the doc changes: checking in with a PIN remembers it on this device
  const mine = $derived.by(() => {
    void doc.updatedAt;
    void app.accountSync;
    return myPin(doc.id);
  });
  const meIn = $derived(!!mine && (names.has(mine.playerId) || !!doc.waitlist?.some((w) => w.id === mine!.playerId)));

  let pin = $state('');
  let busy = $state(false);
  let error = $state('');

  async function send(who: { pin: string } | { playerId: string }, arrived: boolean) {
    if (!app.store.checkin) return;
    busy = true;
    error = '';
    try {
      onchange(await app.store.checkin(doc.id, who, arrived));
      if ('pin' in who) app.notify(arrived ? "You're checked in" : 'Check-in undone');
      pin = '';
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
  }

  async function removeNoShows() {
    const list = missing.map((e) => names.get(e.id) ?? e.name).join(', ');
    if (!confirm(`Remove ${missing.length} player${missing.length === 1 ? '' : 's'} who didn't check in?\n\n${list}\n\nYou can undo this from the Log tab.`)) return;
    busy = true;
    await onnoshows();
    busy = false;
  }
</script>

<section class="panel ci">
  <div class="head">
    <h3>Check-in</h3>
    <span class="tally"><b>{count}</b> of {doc.entrants.length} here</span>
  </div>

  {#if meIn}
    {#if here.has(mine!.playerId)}
      <div class="row">
        <span class="done">You're checked in{names.has(mine!.playerId) ? '' : ' (waitlist)'}.</span>
        <button class="small ghost" disabled={busy} onclick={() => send({ pin: mine!.pin }, false)}>Undo</button>
      </div>
    {:else}
      <button class="accent big" disabled={busy} onclick={() => send({ pin: mine!.pin }, true)}>I'm here</button>
    {/if}
  {:else if !canEdit}
    <form class="row pinrow" onsubmit={(e) => { e.preventDefault(); send({ pin: pin.trim() }, true); }}>
      <input bind:value={pin} inputmode="numeric" autocomplete="off" maxlength="6" placeholder="Your 6-digit PIN" aria-label="Your PIN" />
      <button class="accent" type="submit" disabled={busy || !/^\d{6}$/.test(pin.trim())}>I'm here</button>
    </form>
    <p class="small muted">Playing? Check in with the PIN you got when you signed up (or ask the organizer for it).</p>
  {/if}
  {#if error}<p class="small err">{error}</p>{/if}

  <ul class="names">
    {#each doc.entrants as e (e.id)}
      <li class:in={here.has(e.id)}>
        <span class="mark" aria-hidden="true"></span>
        <span class="name">{names.get(e.id) ?? e.name}</span>
        <span class="small state">{here.has(e.id) ? 'Here' : 'Not yet'}</span>
        {#if canEdit}
          <button class="small" disabled={busy} onclick={() => send({ playerId: e.id }, !here.has(e.id))}>
            {here.has(e.id) ? 'Undo' : 'Mark here'}
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  {#if canEdit && missing.length}
    <div class="row">
      <button class="danger" disabled={busy || missing.length === doc.entrants.length} onclick={removeNoShows}>
        Remove {missing.length} no-show{missing.length === 1 ? '' : 's'}
      </button>
      <span class="small muted">Before round 1. Undo from the Log tab.</span>
    </div>
  {/if}
</section>

<style>
  .ci { padding: 12px 14px; margin-top: 16px; max-width: 560px; display: grid; gap: 10px; }
  .ci p { margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .tally { font-size: 15px; }
  .tally b { font: 700 20px var(--font-cond); color: var(--accent); }
  .big { min-height: 48px; font-size: 17px; justify-self: start; padding: 0 24px; }
  .done { font-weight: 600; }
  .pinrow { flex-wrap: nowrap; }
  .pinrow input { flex: 1; min-width: 0; max-width: 200px; letter-spacing: 0.15em; }
  .err { color: var(--danger); }
  .names { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); max-height: 360px; overflow-y: auto; }
  .names li { display: flex; align-items: center; gap: 10px; padding: 6px 2px; border-bottom: 1px solid var(--line); min-height: 40px; }
  .mark { width: 12px; height: 12px; border: 2px solid var(--line-strong); border-radius: 50%; flex: none; }
  .in .mark { background: var(--accent); border-color: var(--accent); }
  .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .state { color: var(--muted); }
  .in .state { color: var(--ink); font-weight: 600; }
</style>

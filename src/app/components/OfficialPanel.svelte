<script lang="ts">
  import { app } from '../lib/app.svelte';
  import type { Official, TournamentDoc } from '../lib/model';
  import type { OfficialState } from '../lib/store';
  import OfficialTag from './OfficialTag.svelte';

  interface Props {
    doc: TournamentDoc;
    /** Runs the change and puts the new status on the page; returns false if it failed (already shown). */
    onchange: (fn: () => Promise<OfficialState>, done: string) => Promise<boolean>;
  }
  let { doc, onchange }: Props = $props();

  const status = $derived<Official>(doc.official ?? '');
  const staff = $derived(app.store.can('tournaments'));
  let note = $state('');
  let busy = $state(false);

  async function run(fn: () => Promise<OfficialState>, done: string) {
    busy = true;
    if (await onchange(fn, done)) note = '';
    busy = false;
  }
  const ask = () => run(() => app.store.requestOfficial!(doc.id, note), 'Sent: staff will look at it');
  const withdraw = () => run(() => app.store.requestOfficial!(doc.id, '', true), 'Request withdrawn');
  const decide = (s: '' | 'yes' | 'no') =>
    run(() => app.store.setOfficial(doc.id, s, note), s === 'yes' ? 'This tournament is official' : s === 'no' ? 'Request refused' : 'Official status removed');
</script>

<section class="official panel">
  <div class="head">
    <h2 class="label">Official tournament</h2>
    <OfficialTag official={status} pending />
  </div>
  <p class="small muted">
    Matches in official tournaments count towards the <b>confirmed rating</b>, next to the normal rating that counts every
    tournament. Staff check each one before it's official.
  </p>

  {#if status === 'yes'}
    <p class="small">This tournament is official.{#if doc.officialNote} Note from staff: “{doc.officialNote}”{/if}</p>
  {:else if status === 'pending'}
    <p class="small">Sent to staff for review.{#if doc.officialNote} Your note: “{doc.officialNote}”{/if}</p>
  {:else if status === 'no'}
    <p class="small"><b>Not made official.</b>{#if doc.officialNote} Staff said: “{doc.officialNote}”{/if} You can fix things and ask again.</p>
  {/if}

  {#if staff}
    <label class="field">
      <span>Note <span class="muted">(optional, the organizer sees it)</span></span>
      <input bind:value={note} maxlength="300" />
    </label>
    <div class="row">
      {#if status !== 'yes'}<button class="small" disabled={busy} onclick={() => decide('yes')}>Make official</button>{/if}
      {#if status === 'pending'}<button class="small ghost" disabled={busy} onclick={() => decide('no')}>Refuse</button>{/if}
      {#if status === 'yes'}<button class="small ghost" disabled={busy} onclick={() => decide('')}>Not official</button>{/if}
    </div>
  {:else if app.store.requestOfficial && status !== 'yes'}
    {#if status === 'pending'}
      <div class="row"><button class="small ghost" disabled={busy} onclick={withdraw}>Withdraw request</button></div>
    {:else}
      <label class="field">
        <span>Anything staff should know? <span class="muted">(optional)</span></span>
        <input bind:value={note} maxlength="300" placeholder="e.g. Monthly league, results checked by two judges" />
      </label>
      <div class="row"><button class="small" disabled={busy} onclick={ask}>Ask to make it official</button></div>
    {/if}
  {/if}
</section>

<style>
  .official { padding: 14px; display: grid; gap: 10px; margin-bottom: 20px; }
  .head { display: flex; align-items: center; gap: 10px; }
  .head h2 { margin: 0; }
  p { margin: 0; }
</style>

<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { helperLink } from '../lib/store';
  import { scriptOutdated, UPDATE_SCRIPT } from '../lib/model';
  import type { TournamentDoc } from '../lib/model';

  interface Props {
    doc: TournamentDoc;
    names: Map<string, string>;
    onsignup: (open: boolean) => Promise<boolean>;
    onmax: (max: number) => Promise<boolean>;
    oncheckin: (on: boolean) => Promise<boolean>;
  }
  let { doc, names, onsignup, onmax, oncheckin }: Props = $props();

  async function toggleCheckIn(on: boolean) {
    busy = true;
    await oncheckin(on);
    busy = false;
  }

  const outdated = $derived(scriptOutdated(doc, app.store.kind));
  let max = $state<number | undefined>(doc.maxPlayers || undefined);
  const maxChanged = $derived((max || 0) !== (doc.maxPlayers || 0));

  async function saveMax() {
    busy = true;
    await onmax(Math.max(0, Math.round(max || 0)));
    busy = false;
  }

  const viewLink = `${location.href.split('#')[0]}#/t/${doc.id}`;
  const helper = helperLink(doc.id);
  const started = $derived(Object.keys(doc.results).length > 0);

  let pins = $state<Record<string, string> | null>(null);
  let loadingPins = $state(false);
  let busy = $state(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      app.notify('Link copied');
    } catch {
      prompt('Copy this link:', text);
    }
  }

  async function showPins() {
    if (!app.store.pins) return;
    loadingPins = true;
    try {
      pins = await app.store.pins(doc.id);
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      loadingPins = false;
    }
  }

  async function toggle(open: boolean) {
    busy = true;
    await onsignup(open);
    busy = false;
  }
</script>

<section class="panel share">
  <h3>Players and helpers</h3>

  <div class="item">
    <div class="label">Link for everyone</div>
    <p class="small muted">Players and viewers. Players can sign up (if open) and report their own scores with their PIN.</p>
    <div class="row"><code>{viewLink}</code><button class="small" onclick={() => copy(viewLink)}>Copy</button></div>
  </div>

  <div class="item">
    <div class="label">Join code and door poster</div>
    {#if doc.code}
      <p class="small muted">People type <b class="code">{doc.code}</b> on the home page, or scan the QR code on the poster.</p>
    {:else}
      <p class="small muted">No join code yet: {UPDATE_SCRIPT} The poster's QR code works already.</p>
    {/if}
    <a class="btn small" href="#/t/{doc.id}/poster">Door poster (QR code)</a>
  </div>

  <div class="item">
    <div class="label">Helper link</div>
    {#if helper}
      <p class="small muted"><b>Anyone with this link can edit this tournament.</b> Only send it to people helping you run it.</p>
      <div class="row"><code class="secret">{helper}</code><button class="small" onclick={() => copy(helper)}>Copy</button></div>
    {:else}
      <p class="small muted">You're editing as the site admin. The helper link is on the organizer's device.</p>
    {/if}
  </div>

  <div class="item">
    <label class="check">
      <input type="checkbox" checked={!!doc.signup} disabled={busy || started} onchange={(e) => toggle(e.currentTarget.checked)} />
      Let players sign up themselves
    </label>
    <p class="small muted">{started ? 'Sign-up closes once the first result is in.' : 'They add their name on the tournament page and get a PIN.'}</p>
  </div>

  <div class="item">
    <div class="label">Player limit</div>
    {#if outdated}
      <p class="small muted">{UPDATE_SCRIPT}</p>
    {:else}
      <p class="small muted">Sign-ups after this go on a waitlist. Empty = no limit. People you add by hand don't count against it.</p>
      <form class="row" onsubmit={(e) => { e.preventDefault(); saveMax(); }}>
        <input class="max" type="number" min="2" inputmode="numeric" placeholder="No limit" bind:value={max} aria-label="Most players" />
        <button class="small" type="submit" disabled={busy || !maxChanged}>Save</button>
      </form>
    {/if}
  </div>

  <div class="item">
    <label class="check">
      <input type="checkbox" checked={!!doc.checkIn} disabled={busy || started || outdated} onchange={(e) => toggleCheckIn(e.currentTarget.checked)} />
      Check-in before the start
    </label>
    <p class="small muted">
      {#if outdated}{UPDATE_SCRIPT}{:else}Players tap "I'm here" on the tournament page with their PIN. You see who came and can remove the no-shows in one click.{/if}
    </p>
  </div>

  <div class="item">
    <div class="label">Player PINs</div>
    <p class="small muted">Each player reports their own scores with their PIN. Give people you added by hand their PIN.</p>
    {#if pins}
      <table class="pins">
        <tbody>
          {#each doc.entrants as e (e.id)}
            <tr><td>{names.get(e.id) ?? e.name}</td><td class="num pin">{pins[e.id] ?? '–'}</td></tr>
          {/each}
          {#each doc.waitlist ?? [] as w (w.id)}
            <tr><td>{w.name} <span class="small muted">(waitlist)</span></td><td class="num pin">{pins[w.id] ?? '–'}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <button class="small" onclick={showPins} disabled={loadingPins}>{loadingPins ? 'Loading…' : 'Show PINs'}</button>
    {/if}
  </div>
</section>

<style>
  .share { padding: 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin-bottom: 20px; }
  .item { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .item p { margin: 0; }
  .item > button, .item > .btn { justify-self: start; }
  .btn.small { min-height: 32px; padding: 0 10px; font-size: 14px; }
  .code { font: 700 17px var(--font-cond); letter-spacing: 0.12em; color: var(--ink); }
  .row { flex-wrap: nowrap; align-items: center; }
  code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    background: var(--paper);
    border: 1px solid var(--line);
    padding: 6px 8px;
    border-radius: var(--radius);
  }
  .pins { max-width: 360px; }
  .max { width: 120px; }
  .pins td { padding: 6px 8px; }
  .pin { font: 700 17px var(--font-cond); letter-spacing: 0.12em; }
</style>

<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { organizerLink } from '../lib/store';
  import type { HelpersState } from '../lib/store';
  import { scriptOutdated, UPDATE_SCRIPT } from '../lib/model';
  import type { TournamentDoc } from '../lib/model';

  interface Props {
    doc: TournamentDoc;
    names: Map<string, string>;
    onsignup: (open: boolean) => Promise<boolean>;
    onmax: (max: number) => Promise<boolean>;
    oncheckin: (on: boolean) => Promise<boolean>;
    ondiscord: (url: string) => Promise<boolean>;
  }
  let { doc, names, onsignup, onmax, oncheckin, ondiscord }: Props = $props();

  // ---- Discord: the webhook link stays in the sheet; the page only knows whether there is one
  let hook = $state('');
  const hookOk = $derived(/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(hook.trim()));
  async function connectDiscord(url: string) {
    busy = true;
    if (await ondiscord(url)) hook = '';
    busy = false;
  }

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
  const joinLink = `${location.href.split('#')[0]}#/j/${doc.id}`;
  // ---- helpers: each gets their own link, which the organizer can remove
  let orgLink = $state(organizerLink(doc.id));
  let hs = $state<HelpersState | null>(null);
  let hsError = $state('');
  let helperName = $state('');
  /** The link just made: shown once (the sheet keeps only a hash). */
  let fresh = $state<{ name: string; link: string } | null>(null);
  const oldScript = $derived(hsError === UPDATE_SCRIPT);

  $effect(() => {
    if (!app.store.helpers) return;
    app.store.helpers(doc.id).then(
      (r) => (hs = r),
      (e) => (hsError = errorText(e)),
    );
  });

  async function helperChange(run: () => Promise<HelpersState>, done?: string) {
    busy = true;
    try {
      hs = await run();
      if (done) app.notify(done);
      return true;
    } catch (e) {
      app.notify(errorText(e), 'error');
      return false;
    } finally {
      busy = false;
    }
  }

  async function addHelper() {
    const name = helperName.trim();
    if (!name || !app.store.addHelper) return;
    let link = '';
    const ok = await helperChange(async () => {
      const r = await app.store.addHelper!(doc.id, name);
      link = r.link;
      return r;
    });
    if (ok) {
      fresh = { name, link };
      helperName = '';
    }
  }

  async function removeHelper(id: string, name: string) {
    if (!app.store.removeHelper || !confirm(`Remove ${name}? Their helper link stops working at once.`)) return;
    if (await helperChange(() => app.store.removeHelper!(doc.id, id), `${name} can't edit any more`) && fresh?.name === name) fresh = null;
  }

  async function resetKey() {
    if (!app.store.resetOrgKey) return;
    const sure = confirm(
      'Make a new organizer link? Every old copy of your organizer link stops working, including old helper links shared before ' +
        "helpers got their own. This device keeps editing; on your other devices, open the new link or log in.",
    );
    if (sure && (await helperChange(() => app.store.resetOrgKey!(doc.id), 'New organizer link made: old copies stopped working'))) {
      orgLink = organizerLink(doc.id);
    }
  }
  const added = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
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
    <p class="small muted">Both open a sign-up page made for phones: name, Join, then their PIN and check-in. Same page as a link:</p>
    <div class="row"><code>{joinLink}</code><button class="small" onclick={() => copy(joinLink)}>Copy</button></div>
    <a class="btn small" href="#/t/{doc.id}/poster">Door poster (QR code)</a>
  </div>

  <div class="item">
    <div class="label">Helpers</div>
    {#if oldScript}
      {#if orgLink}
        <p class="small muted"><b>Anyone with this link can edit this tournament.</b> Only send it to people helping you run it.</p>
        <div class="row"><code class="secret">{orgLink}</code><button class="small" onclick={() => copy(orgLink!)}>Copy</button></div>
      {/if}
      <p class="small muted">Separate helper links you can take back: {UPDATE_SCRIPT}</p>
    {:else if hsError}
      <p class="small warn">{hsError}</p>
    {:else if !hs}
      <p class="small muted">Loading…</p>
    {:else if hs.you === 'helper'}
      <p class="small muted">You're a helper here: you can run the tournament but not delete it. The organizer can take this device's access away.</p>
    {:else}
      <p class="small muted">
        Each helper gets their own link. Helpers can do everything except delete the tournament or change helpers.
        Remove someone and their link stops working at once.
      </p>
      {#if hs.helpers.length}
        <ul class="helpers">
          {#each hs.helpers as h (h.id)}
            <li>
              <span><b>{h.name}</b> <span class="muted small">added {added(h.at)}</span></span>
              <button class="small" disabled={busy} onclick={() => removeHelper(h.id, h.name)}>Remove</button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if fresh}
        <div class="fresh">
          <p class="small"><b>Link for {fresh.name}.</b> Copy it now and send it to them: it isn't shown again.</p>
          <div class="row"><code class="secret">{fresh.link}</code><button class="small" onclick={() => copy(fresh!.link)}>Copy</button></div>
        </div>
      {/if}
      <form class="row" onsubmit={(e) => { e.preventDefault(); addHelper(); }}>
        <input bind:value={helperName} maxlength="40" placeholder="Helper's name" autocomplete="off" aria-label="Helper's name" />
        <button class="small" type="submit" disabled={busy || !helperName.trim()}>Make helper link</button>
      </form>
    {/if}
  </div>

  {#if !oldScript && hs?.you === 'main' && orgLink}
    <div class="item">
      <div class="label">Your organizer link</div>
      <p class="small muted">Opens editing on your own other devices. Don't share it: give other people a helper link.</p>
      <div class="row"><code class="secret">{orgLink}</code><button class="small" onclick={() => copy(orgLink!)}>Copy</button></div>
      <p class="small muted">Sent it to someone, or shared an old helper link? Make a new one: every old copy stops working.</p>
      <button class="small" disabled={busy} onclick={resetKey}>Make a new organizer link</button>
    </div>
  {:else if hs?.you === 'staff'}
    <p class="small muted">You're editing as staff. The organizer link is on the organizer's device.</p>
  {/if}

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
    <div class="label">Discord announcements</div>
    {#if doc.discord === undefined}
      <p class="small muted">{UPDATE_SCRIPT}</p>
    {:else if doc.discord}
      <p class="small"><b>Connected.</b> <span class="muted">Results (once confirmed), the start, the finals and the champion are posted in your channel.</span></p>
      <button class="small" disabled={busy} onclick={() => confirm('Stop posting to Discord?') && connectDiscord('')}>Disconnect</button>
    {:else}
      <p class="small muted">
        Post results in a Discord channel. In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL,
        then paste it here. Nobody else can see the link.
      </p>
      <form class="row" onsubmit={(e) => { e.preventDefault(); if (hookOk) connectDiscord(hook.trim()); }}>
        <input bind:value={hook} placeholder="https://discord.com/api/webhooks/…" inputmode="url" autocomplete="off" aria-label="Discord webhook URL" />
        <button class="small" type="submit" disabled={busy || !hookOk}>Connect</button>
      </form>
      {#if hook.trim() && !hookOk}<p class="small warn">That doesn't look like a Discord webhook link.</p>{/if}
    {/if}
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
  .helpers { list-style: none; margin: 4px 0; padding: 0; border-top: 1px solid var(--line); max-width: 480px; }
  .helpers li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line); }
  .fresh { border: 1px solid var(--accent); border-radius: var(--radius); padding: 8px 10px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; min-width: 0; }
  .max { width: 120px; }
  .row input:not(.max) { flex: 1; min-width: 0; }
  .warn { color: var(--warn); }
  .pins td { padding: 6px 8px; }
  .pin { font: 700 17px var(--font-cond); letter-spacing: 0.12em; }
</style>

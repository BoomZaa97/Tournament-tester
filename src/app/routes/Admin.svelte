<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { LocalStore, SheetsStore, saveSettings } from '../lib/store';
  import type { AllData, Settings, Store } from '../lib/store';
  import type { Player } from '../lib/model';
  import Verified from '../components/Verified.svelte';

  let s = $state<Settings>({ ...app.settings });
  let testing = $state(false);
  let testResult = $state('');
  let busy = $state('');

  // ---- verified players (accounts), for the site admin
  let accounts = $state<Player[] | null>(null);
  $effect(() => {
    if (!app.store.isAdmin || app.store.kind !== 'sheets') return;
    app.store.players().then(
      (ps) => {
        app.noteVerified(ps);
        accounts = ps.filter((p) => p.account).sort((a, b) => a.name.localeCompare(b.name));
      },
      () => (accounts = []),
    );
  });

  // ---- clean-up: players left over from deleted (test) tournaments
  let unused = $state<Player[] | null>(null);
  let pruning = $state(false);
  async function findUnused() {
    pruning = true;
    try {
      unused = (await app.store.prunePlayers(true)).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      pruning = false;
    }
  }
  async function removeUnused() {
    if (!unused?.length || !confirm(`Remove ${unused.length} unused ${unused.length === 1 ? 'player' : 'players'}? This can't be undone.`)) return;
    pruning = true;
    try {
      const gone = await app.store.prunePlayers(false);
      app.notify(`Removed ${gone.length} ${gone.length === 1 ? 'player' : 'players'}`);
      unused = null;
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      pruning = false;
    }
  }

  async function test() {
    testing = true;
    testResult = '';
    try {
      const st = new SheetsStore(s.sheetsUrl.trim(), s.adminKey.trim());
      const data = await st.loadAll();
      let msg = `Connected. ${data.tournaments.length} tournament(s) in the sheet.`;
      if (!s.adminKey.trim()) msg += ' No admin key: you can still create and run your own tournaments.';
      else if (await st.checkKey()) {
        // A key that works is what people want kept; don't make them find the Save button too.
        save();
        msg += ' Admin key accepted and saved. You can create and edit tournaments now.';
      } else msg += ' Admin key is WRONG. Nothing was saved.';
      testResult = msg;
    } catch (e) {
      testResult = `Couldn't connect: ${errorText(e)}`;
    } finally {
      testing = false;
    }
  }

  function save() {
    const clean = { ...s, sheetsUrl: s.sheetsUrl.trim(), adminKey: s.adminKey.trim() };
    saveSettings(clean);
    app.applySettings(clean);
    app.notify('Settings saved');
  }

  /** Merge tournaments into a store, keeping whatever version the store has. */
  async function copyInto(target: Store, data: AllData) {
    for (const t of data.tournaments) {
      const existing = await target.get(t.id);
      await target.save({ ...t, version: existing?.version ?? 0 }, data.players.filter((p) => t.entrants.some((e) => e.id === p.id)));
    }
  }

  async function exportBackup() {
    const data = await app.store.loadAll({ full: true });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tournaments-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importBackup(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    busy = 'Importing…';
    try {
      const data = JSON.parse(await file.text()) as AllData;
      if (!Array.isArray(data.tournaments)) throw new Error('Not a backup file');
      await copyInto(app.store, data);
      app.notify(`Imported ${data.tournaments.length} tournament(s)`);
    } catch (err) {
      app.notify(errorText(err), 'error');
    } finally {
      busy = '';
      e.currentTarget.value = '';
    }
  }

  async function uploadLocal() {
    const local = await new LocalStore().loadAll();
    if (!local.tournaments.length) return app.notify('Nothing saved in this browser');
    if (!confirm(`Copy ${local.tournaments.length} tournament(s) from this browser into the Google Sheet?`)) return;
    busy = 'Copying…';
    try {
      await copyInto(app.store, local);
      app.notify('Copied to the sheet');
    } catch (err) {
      app.notify(errorText(err), 'error');
    } finally {
      busy = '';
    }
  }
</script>

<div class="wrap page">
  <a class="back small" href="#/settings">← Settings</a>
  <h1>Admin</h1>
  {#if app.store.isAdmin}
    <p class="muted lead">
      {app.store.kind === 'sheets' ? 'This device has the site admin key: full rights on every tournament.' : 'Data is saved in this browser only, so this device can change everything.'}
    </p>
  {:else}
    <p class="notice">
      Only the site owner needs this page. Everyone else can view everything, and organizers edit their own tournaments
      without a key. Owner: enter the site admin key below.
    </p>
  {/if}

  <section>
    <h2>Where data is saved</h2>
    <div class="choices">
      <label class="choice" class:on={s.source === 'local'}>
        <input type="radio" bind:group={s.source} value="local" />
        <span><b>This browser only</b><br /><span class="small muted">Nothing to set up. Other people can't see it.</span></span>
      </label>
      <label class="choice" class:on={s.source === 'sheets'}>
        <input type="radio" bind:group={s.source} value="sheets" />
        <span><b>Google Sheet</b><br /><span class="small muted">Free. Anyone with the link can view; only people with the admin key can edit.</span></span>
      </label>
    </div>

    {#if s.source === 'sheets'}
      <div class="sheet">
        <label class="field">
          <span>Apps Script web app URL</span>
          <input bind:value={s.sheetsUrl} placeholder="https://script.google.com/macros/s/…/exec" inputmode="url" />
        </label>
        <label class="field">
          <span>Site admin key <span class="muted">(owner only; everyone else leaves this empty)</span></span>
          <input bind:value={s.adminKey} type="password" autocomplete="off" />
        </label>
        <div class="row">
          <button onclick={test} disabled={!s.sheetsUrl.trim() || testing}>{testing ? 'Testing…' : 'Test and save'}</button>
          {#if testResult}<span class="small">{testResult}</span>{/if}
        </div>
        <p class="small muted">
          Setup takes about 5 minutes: follow <b>docs/google-sheets-setup.md</b> in the project. To make the sheet the default for
          everyone who opens your site, put the URL in <code>public/config.json</code>. Never put the admin key there.
        </p>
      </div>
    {/if}

    <div class="row"><button class="primary" onclick={save}>Save settings</button></div>
  </section>

  <hr class="rule" />

  <section>
    <h2>Roles and access</h2>
    <p class="small muted">No sign-up needed to view. Rights come from keys and PINs kept on each device.</p>
    <div class="roles" role="table" aria-label="Roles">
      <div class="rhead" role="row"><span role="columnheader">Role</span><span role="columnheader">How someone gets it</span><span role="columnheader">What they can do</span></div>
      <div role="row"><b role="cell">Site admin</b><span role="cell" class="rgets">The admin key, typed on this page (per device)</span><span role="cell">Everything: every tournament, rename and clean up players, reset account passwords, import backups</span></div>
      <div role="row"><b role="cell">Organizer</b><span role="cell" class="rgets">Creating a tournament on their device, or logging in to the account that made it</span><span role="cell">Edit that tournament: results, entrants, format, finals, check-in, players' PINs</span></div>
      <div role="row"><b role="cell">Helper</b><span role="cell" class="rgets">The helper link from the tournament's Share panel</span><span role="cell">Same as the organizer, for that one tournament</span></div>
      <div role="row"><b role="cell">Player</b><span role="cell" class="rgets">Joining (they get a 6-digit PIN), or logging in to their account</span><span role="cell">Report and confirm their own matches, check in, drop out, edit their own profile</span></div>
      <div role="row"><b role="cell">Viewer</b><span role="cell" class="rgets">Anyone with the link</span><span role="cell">See brackets, results, rankings and profiles</span></div>
    </div>

    {#if app.store.isAdmin && app.store.kind === 'sheets'}
      <h3>Verified players {#if accounts}<span class="muted">· {accounts.length}</span>{/if}</h3>
      {#if accounts === null}
        <p class="small muted">Loading…</p>
      {:else if accounts.length === 0}
        <p class="small muted">Nobody has made an account yet.</p>
      {:else}
        <p class="small muted">Players with an account. Their name is locked to them. To give one a new password, open their page.</p>
        <ul class="accts">
          {#each accounts as p (p.id)}
            <li><a href="#/p/{p.id}">{p.name}</a><Verified id={p.id} /></li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <hr class="rule" />

  {#if app.store.isAdmin}
    <section>
      <h2>Clean up players</h2>
      <p class="small muted">
        Players who are in no tournament and have no account: test names, typos, or people whose tournaments were deleted.
        Removing them clears them from the player list and suggestions. Players with an account are always kept.
      </p>
      {#if unused === null}
        <div class="row"><button onclick={findUnused} disabled={pruning}>{pruning ? 'Looking…' : 'Find unused players'}</button></div>
      {:else if unused.length === 0}
        <p class="small">Nothing to clean up: every player is in a tournament or has an account.</p>
      {:else}
        <p class="small"><b>{unused.length}</b> {unused.length === 1 ? 'player' : 'players'}: {unused.map((p) => p.name).join(', ')}</p>
        <div class="row">
          <button class="danger" onclick={removeUnused} disabled={pruning}>{pruning ? 'Removing…' : `Remove ${unused.length}`}</button>
          <button class="ghost" onclick={() => (unused = null)} disabled={pruning}>Cancel</button>
        </div>
      {/if}
    </section>

    <hr class="rule" />
  {/if}

  <section>
    <h2>Backup</h2>
    <p class="small muted">Download everything as one file, or load a backup into the current data source.</p>
    <div class="row">
      <button onclick={exportBackup}>Download backup</button>
      {#if app.store.isAdmin}
        <label class="btn">Import backup<input type="file" accept="application/json,.json" hidden onchange={importBackup} /></label>
      {/if}
      {#if app.store.kind === 'sheets'}
        <button onclick={uploadLocal}>Copy this browser's tournaments to the sheet</button>
      {/if}
      {#if busy}<span class="small muted">{busy}</span>{/if}
    </div>
  </section>
</div>

<style>
  .page { padding-top: 20px; max-width: 760px; }
  .back { display: inline-block; margin-bottom: 8px; color: var(--muted); text-decoration: none; }
  h1 { margin-bottom: 8px; }
  .lead, .notice { margin: 0 0 24px; }
  h3 { margin: 10px 0 0; }
  .roles { border-top: 2px solid var(--ink); }
  .roles > div { display: grid; grid-template-columns: 110px minmax(0, 1fr) minmax(0, 1.3fr); gap: 4px 16px; padding: 10px 2px; border-bottom: 1px solid var(--line); font-size: 15px; }
  .rhead span { font: 600 13px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  @media (max-width: 600px) {
    .roles > div { grid-template-columns: minmax(0, 1fr); }
    .rhead { display: none !important; }
    .roles .rgets { color: var(--muted); }
    .roles .rgets::before { content: 'Gets it: '; font-weight: 600; }
  }
  .row button, .row .btn { white-space: normal; max-width: 100%; height: auto; padding-top: 6px; padding-bottom: 6px; }
  .accts { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; }
  .accts a { font-weight: 600; text-decoration: none; }
  .accts a:hover { text-decoration: underline; }
  section { display: grid; gap: 14px; }
  .choices { display: grid; gap: 8px; }
  .choice { display: flex; gap: 12px; align-items: start; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--card); cursor: pointer; }
  .choice.on { border-color: var(--ink); box-shadow: inset 3px 0 0 var(--accent); }
  .choice input { width: 18px; min-height: 0; margin-top: 3px; accent-color: var(--accent); }
  .sheet { display: grid; gap: 12px; }
  code { font-size: 13px; background: var(--card); border: 1px solid var(--line); padding: 1px 4px; border-radius: 3px; }
</style>

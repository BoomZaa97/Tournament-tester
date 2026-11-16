<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { LocalStore, SheetsStore, saveSettings } from '../lib/store';
  import type { AllData, Settings, Store } from '../lib/store';

  let s = $state<Settings>({ ...app.settings });
  let testing = $state(false);
  let testResult = $state('');
  let busy = $state('');

  async function test() {
    testing = true;
    testResult = '';
    try {
      const st = new SheetsStore(s.sheetsUrl.trim(), s.adminKey.trim());
      const data = await st.loadAll();
      let msg = `Connected. ${data.tournaments.length} tournament(s) in the sheet.`;
      if (s.adminKey.trim()) msg += (await st.checkKey()) ? ' Admin key accepted.' : ' Admin key is WRONG — you can only view.';
      else msg += ' No admin key: view only.';
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
    const data = await app.store.loadAll();
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
  <h1>Settings</h1>

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
          <span>Admin key <span class="muted">(leave empty to just view)</span></span>
          <input bind:value={s.adminKey} type="password" autocomplete="off" />
        </label>
        <div class="row">
          <button onclick={test} disabled={!s.sheetsUrl.trim() || testing}>{testing ? 'Testing…' : 'Test connection'}</button>
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
    <h2>Backup</h2>
    <p class="small muted">Download everything as one file, or load a backup into the current data source.</p>
    <div class="row">
      <button onclick={exportBackup}>Download backup</button>
      {#if app.store.canEdit}
        <label class="btn">Import backup<input type="file" accept="application/json,.json" hidden onchange={importBackup} /></label>
      {/if}
      {#if app.store.kind === 'sheets' && app.store.canEdit}
        <button onclick={uploadLocal}>Copy this browser's tournaments to the sheet</button>
      {/if}
      {#if busy}<span class="small muted">{busy}</span>{/if}
    </div>
  </section>
</div>

<style>
  .page { padding-top: 28px; max-width: 720px; }
  h1 { margin-bottom: 24px; }
  section { display: grid; gap: 14px; }
  .choices { display: grid; gap: 8px; }
  .choice { display: flex; gap: 12px; align-items: start; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--card); cursor: pointer; }
  .choice.on { border-color: var(--ink); box-shadow: inset 3px 0 0 var(--accent); }
  .choice input { width: 18px; min-height: 0; margin-top: 3px; accent-color: var(--accent); }
  .sheet { display: grid; gap: 12px; }
  code { font-size: 13px; background: var(--card); border: 1px solid var(--line); padding: 1px 4px; border-radius: 3px; }
</style>

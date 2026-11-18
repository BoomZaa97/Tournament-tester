<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { LocalStore, ROLE_LABEL, ROLE_RANK, SheetsStore, saveSettings, siteSettings } from '../lib/store';
  import type { AllData, AuditRow, Role, Settings, StaffAccount, Store } from '../lib/store';
  import { STATUS_LABEL, statusOf } from '../lib/model';
  import type { Player, TournamentDoc } from '../lib/model';
  import Verified from '../components/Verified.svelte';
  import TierTag from '../components/TierTag.svelte';

  // ---------------------------------------------------------------- tabs (what this device's role may see)
  type Tab = 'overview' | 'users' | 'tournaments' | 'audit' | 'security' | 'data';
  const shared = app.store.kind === 'sheets';
  const myRole = $derived(app.store.role());
  const staff = $derived(shared && app.store.can('audit'));
  const tabs = $derived.by(() => {
    const t: [Tab, string][] = [];
    if (staff) t.push(['overview', 'Overview']);
    if (shared && app.store.can('accounts')) t.push(['users', 'Users & roles']);
    if (staff) t.push(['tournaments', 'Tournaments']);
    if (staff) t.push(['audit', 'Audit log']);
    t.push(['security', 'Security']);
    t.push(['data', 'Data & backup']);
    return t;
  });
  const TAB_KEY = 'tt.adminTab.v1';
  let tab = $state<Tab>((() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || 'overview';
    } catch {
      return 'overview';
    }
  })());
  const current = $derived(tabs.some(([t]) => t === tab) ? tab : tabs[0][0]);
  function pick(t: Tab) {
    tab = t;
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  }

  const ago = (iso: string) => {
    if (!iso) return 'never';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 60) return `${Math.round(s / 86400)} d ago`;
    return iso.slice(0, 10);
  };
  const when = (iso: string) => (iso === 'forever' ? 'for good' : `until ${new Date(iso).toLocaleString()}`);

  // ---------------------------------------------------------------- data for the staff tabs
  let all = $state<AllData | null>(app.store.peekAll());
  let accounts = $state<StaffAccount[] | null>(null);
  let auditRows = $state<AuditRow[] | null>(null);
  let loadError = $state('');

  async function loadAllData() {
    try {
      all = await app.store.loadAll();
      app.noteVerified(all.players);
    } catch (e) {
      loadError = errorText(e);
    }
  }
  async function loadAccounts() {
    if (!app.store.accounts || !app.store.can('accounts')) return;
    try {
      accounts = await app.store.accounts();
    } catch (e) {
      loadError = errorText(e);
    }
  }
  async function loadAudit() {
    if (!app.store.audit || !app.store.can('audit')) return;
    try {
      auditRows = await app.store.audit(500);
    } catch (e) {
      loadError = errorText(e);
    }
  }
  $effect(() => {
    if (!staff) return;
    loadAllData();
    loadAccounts();
    loadAudit();
  });

  const counts = $derived.by(() => {
    const ts = all?.tournaments ?? [];
    const by = { setup: 0, running: 0, finished: 0 };
    for (const t of ts) by[statusOf(t)]++;
    return {
      tournaments: ts.length,
      ...by,
      players: all?.players.length ?? 0,
      accounts: accounts?.length ?? 0,
      staff: accounts?.filter((a) => a.role === 'moderator' || a.role === 'admin').length ?? 0,
      organizers: accounts?.filter((a) => a.role === 'organizer').length ?? 0,
      suspended: accounts?.filter((a) => a.suspended).length ?? 0,
      locked: accounts?.filter((a) => a.locked).length ?? 0,
    };
  });

  // ---------------------------------------------------------------- users & roles
  let q = $state('');
  let filter = $state<'all' | 'staff' | 'suspended'>('all');
  const shown = $derived(
    (accounts ?? [])
      .filter((a) => (filter === 'staff' ? !!a.role : filter === 'suspended' ? a.suspended : true))
      .filter((a) => !q.trim() || `${a.name} ${a.username}`.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name)),
  );
  /** Roles this device may give: below its own (the owner may make admins). */
  const assignable = $derived((['', 'organizer', 'moderator', 'admin'] as Role[]).filter((r) => ROLE_RANK[r] < ROLE_RANK[myRole]));
  let open = $state<string | null>(null); // account whose suspend form is open
  let days = $state('7');
  let reason = $state('');
  let resetFor = $state<{ id: string; username: string; password: string; twoStepOff?: boolean } | null>(null);
  let working = $state('');

  async function act(id: string, label: string, fn: () => Promise<unknown>, done: string) {
    working = id;
    try {
      await fn();
      app.notify(done);
      await Promise.all([loadAccounts(), loadAudit()]);
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      working = '';
    }
    void label;
  }
  async function loginAs(a: StaffAccount) {
    const reason = prompt(`Log in as ${a.name}? You'll see the site as them and can act for them. This is written to the audit log.\n\nWhy? (optional)`);
    if (reason === null) return;
    working = a.id;
    try {
      await app.store.loginAs!(a.playerId, reason);
      app.refreshAccount();
      app.notify(`Logged in as ${a.name}`);
      app.go(`p/${a.playerId}`);
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      working = '';
    }
  }

  const changeRole = (a: StaffAccount, role: Role) =>
    act(a.id, 'role', () => app.store.setRole!(a.playerId, role), `${a.name} is now ${ROLE_LABEL[role].toLowerCase()}`);
  function suspendNow(a: StaffAccount) {
    const forever = days === 'forever';
    if (!confirm(`Suspend ${a.name} ${forever ? 'for good' : `for ${days} days`}? They're logged out at once and can't log in or use their PINs.`)) return;
    act(a.id, 'suspend', () => app.store.suspend!(a.playerId, { forever, days: forever ? undefined : Number(days), reason: reason.trim() }), `${a.name} is suspended`).then(
      () => ((open = null), (reason = '')),
    );
  }
  const lift = (a: StaffAccount) => act(a.id, 'lift', () => app.store.suspend!(a.playerId, {}), `${a.name} can log in again`);
  function logoutAll(a: StaffAccount) {
    if (!confirm(`Log ${a.name} out on every device?`)) return;
    act(a.id, 'logout', () => app.store.logoutAll!(a.playerId), `${a.name} is logged out everywhere`);
  }
  async function resetPassword(a: StaffAccount) {
    if (!confirm(`Give ${a.name}'s account a new password? Their old one stops working.`)) return;
    working = a.id;
    try {
      const r = await app.store.resetPassword!(a.playerId);
      resetFor = { id: a.id, ...r };
      await loadAudit();
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      working = '';
    }
  }
  function removeAccount(a: StaffAccount) {
    if (!confirm(`Remove ${a.name}'s account (@${a.username})? They lose the login and the verified mark. If they never played, their name goes too; otherwise their results stay.`)) return;
    act(a.id, 'remove', () => app.store.deleteAccount!(a.playerId), 'Account removed').then(() => {
      app.verified.delete(a.playerId);
      loadAllData();
    });
  }

  // clean-up: players left over from deleted (test) tournaments
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
      loadAudit();
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      pruning = false;
    }
  }

  // ---------------------------------------------------------------- tournaments
  let tq = $state('');
  const tlist = $derived(
    [...(all?.tournaments ?? [])]
      .filter((t) => !tq.trim() || `${t.name} ${t.game} ${t.category ?? ''}`.toLowerCase().includes(tq.trim().toLowerCase()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  async function deleteTournament(t: TournamentDoc) {
    if (!confirm(`Delete "${t.name}"? Its matches disappear from player history too. This can't be undone.`)) return;
    working = t.id;
    try {
      await app.store.remove(t.id);
      app.notify('Tournament deleted');
      await Promise.all([loadAllData(), loadAudit()]);
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      working = '';
    }
  }

  // ---------------------------------------------------------------- audit log
  let aq = $state('');
  const auditShown = $derived(
    (auditRows ?? []).filter((r) => !aq.trim() || Object.values(r).join(' ').toLowerCase().includes(aq.trim().toLowerCase())),
  );

  // ---------------------------------------------------------------- security
  let site = $state(siteSettings());
  $effect(() => {
    if (all?.site) site = all.site;
  });
  let savingSite = $state(false);
  async function setLock(lockCreate: boolean) {
    savingSite = true;
    try {
      site = await app.store.setSite!({ lockCreate });
      app.notify(lockCreate ? 'Only organizers and staff can create tournaments now' : 'Anyone can create tournaments now');
      loadAudit();
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      savingSite = false;
    }
  }

  // ---------------------------------------------------------------- data & backup (any device)
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
      if (!s.adminKey.trim()) msg += ' No admin key: you can still create and run your own tournaments.';
      else if (await st.checkKey()) {
        // A key that works is what people want kept; don't make them find the Save button too.
        save();
        msg += ' Admin key accepted and saved. You have full rights now.';
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
  <div class="head">
    <h1>Admin</h1>
    {#if shared}<span class="rolebadge" class:staff={ROLE_RANK[myRole] >= 2}>{ROLE_LABEL[myRole]}</span>{/if}
  </div>
  {#if !staff}
    <p class="notice">
      {shared
        ? 'Staff tools (users, roles, audit log) show up here for the site owner and for accounts the owner made admin or moderator. Owner: enter the site admin key under Data & backup.'
        : 'Data is saved in this browser only, so this device can change everything.'}
    </p>
  {/if}

  <div class="tabs" role="tablist" aria-label="Admin sections">
    {#each tabs as [t, label] (t)}
      <button role="tab" aria-selected={current === t} class:on={current === t} onclick={() => pick(t)}>{label}</button>
    {/each}
  </div>
  {#if loadError}<p class="small err">{loadError}</p>{/if}

  <!-- ============================================================ overview -->
  {#if current === 'overview'}
    <section>
      <div class="stats">
        <div><span class="lbl">Tournaments</span><b class="num">{counts.tournaments}</b><span class="small muted">{counts.running} running · {counts.finished} finished</span></div>
        <div><span class="lbl">Players</span><b class="num">{counts.players}</b><span class="small muted">{counts.accounts} with an account</span></div>
        <div><span class="lbl">Staff</span><b class="num">{counts.staff}</b><span class="small muted">{counts.organizers} organizers</span></div>
        <div><span class="lbl">Suspended</span><b class="num" class:alert={counts.suspended > 0}>{counts.suspended}</b><span class="small muted">{counts.locked} locked right now</span></div>
      </div>
      {#if site.lockCreate}
        <p class="small">Only organizers and staff can create tournaments. <button class="linkish" onclick={() => pick('security')}>Security</button></p>
      {/if}
      <h2>Recent activity</h2>
      {#if auditRows === null}
        <p class="small muted">Loading…</p>
      {:else if !auditRows.length}
        <p class="small muted">Nothing yet. Role changes, suspensions, removals and staff edits show up here.</p>
      {:else}
        <ul class="feed">
          {#each auditRows.slice(0, 8) as r, i (i)}
            <li><span class="small muted when">{ago(r.time)}</span><span><b>{r.actor}</b> {r.action.toLowerCase()}{#if r.target}: {r.target}{/if}{#if r.detail} <span class="muted">({r.detail})</span>{/if}</span></li>
          {/each}
        </ul>
        <div><button class="small" onclick={() => pick('audit')}>Whole audit log</button></div>
      {/if}
    </section>

  <!-- ============================================================ users & roles -->
  {:else if current === 'users'}
    <section>
      <div class="row tools">
        <input bind:value={q} placeholder="Search name or username" aria-label="Search accounts" />
        <div class="chips" role="tablist" aria-label="Show">
          {#each [['all', 'All'], ['staff', 'Roles'], ['suspended', 'Suspended']] as [v, l] (v)}
            <button role="tab" aria-selected={filter === v} class:on={filter === v} onclick={() => (filter = v as typeof filter)}>{l}</button>
          {/each}
        </div>
      </div>
      {#if accounts === null}
        <p class="small muted">Loading…</p>
      {:else if !shown.length}
        <p class="small muted">No accounts{q.trim() || filter !== 'all' ? ' match' : ' yet'}.</p>
      {:else}
        <ul class="users">
          {#each shown as a (a.id)}
            <li class:sus={a.suspended}>
              <div class="who">
                <a href="#/p/{a.playerId}">{a.name}</a><Verified id={a.playerId} />
                <span class="small muted">@{a.username}</span>
                {#if a.role}<span class="tag role-{a.role}">{ROLE_LABEL[a.role]}</span>{/if}
                {#if a.suspended}<span class="tag bad">Suspended</span>{/if}
                {#if a.locked}<span class="tag warn">Locked</span>{/if}
                {#if a.twoStep}<span class="tag">2-step</span>{/if}
              </div>
              <div class="small muted meta">
                Last login {ago(a.lastLogin)} · seen {ago(a.lastSeen)} · joined {a.createdAt.slice(0, 10)}{#if !a.recovery} · no recovery code{/if}
              </div>
              {#if a.suspended}
                <div class="small bad">Suspended {when(a.bannedUntil)}{#if a.banReason}: {a.banReason}{/if}</div>
              {/if}
              {#if a.manageable}
                <div class="row acts">
                  {#if app.store.can('roles')}
                    <label class="small rolepick">Role
                      <select value={a.role} disabled={working === a.id} onchange={(e) => changeRole(a, e.currentTarget.value as Role)}>
                        {#each assignable as r (r)}<option value={r}>{ROLE_LABEL[r]}</option>{/each}
                      </select>
                    </label>
                  {/if}
                  {#if a.suspended}
                    <button class="small" disabled={working === a.id} onclick={() => lift(a)}>Lift suspension</button>
                  {:else}
                    <button class="small" disabled={working === a.id} onclick={() => ((open = open === a.id ? null : a.id), (reason = ''))}>Suspend…</button>
                  {/if}
                  {#if app.store.can('roles') && !a.suspended}
                    <button class="small" disabled={working === a.id} onclick={() => loginAs(a)}>Log in as</button>
                  {/if}
                  <button class="small" disabled={working === a.id} onclick={() => logoutAll(a)}>Log out everywhere</button>
                  <button class="small" disabled={working === a.id} onclick={() => resetPassword(a)}>Reset password</button>
                  <button class="small danger" disabled={working === a.id} onclick={() => removeAccount(a)}>Remove account</button>
                </div>
                {#if open === a.id}
                  <form class="suspend" onsubmit={(e) => { e.preventDefault(); suspendNow(a); }}>
                    <label class="small">For
                      <select bind:value={days}>
                        <option value="1">1 day</option>
                        <option value="7">7 days</option>
                        <option value="30">30 days</option>
                        <option value="365">1 year</option>
                        <option value="forever">For good</option>
                      </select>
                    </label>
                    <input bind:value={reason} maxlength="200" placeholder="Reason (they see it when they try to log in)" aria-label="Reason" />
                    <div class="row"><button class="small danger" type="submit">Suspend</button><button class="small ghost" type="button" onclick={() => (open = null)}>Cancel</button></div>
                  </form>
                {/if}
                {#if resetFor?.id === a.id}
                  <p class="small notice">New password for <b>@{resetFor.username}</b>: <b class="num pw">{resetFor.password}</b>. Give it to them; they can change it on their Account page.{#if resetFor.twoStepOff} Their two-step login is off now.{/if}</p>
                {/if}
              {:else}
                <div class="small muted">{a.role ? 'Same or higher role than yours: only someone above can change it.' : ''}</div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <h2>Clean up players</h2>
      <p class="small muted">
        Players who are in no tournament and have no account: test names, typos, or people whose tournaments were deleted.
        Players with an account are always kept.
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

  <!-- ============================================================ tournaments -->
  {:else if current === 'tournaments'}
    <section>
      <input bind:value={tq} placeholder="Search tournaments" aria-label="Search tournaments" />
      {#if !all}
        <p class="small muted">Loading…</p>
      {:else if !tlist.length}
        <p class="small muted">No tournaments{tq.trim() ? ' match' : ' yet'}.</p>
      {:else}
        <ul class="tlist">
          {#each tlist as t (t.id)}
            <li>
              <div>
                <a href="#/t/{t.id}">{t.name}</a> <TierTag tier={t.tier} />
                <div class="small muted">{[t.game, t.category, `${t.entrants.length} entrants`, STATUS_LABEL[statusOf(t)], `made ${t.createdAt.slice(0, 10)}`].filter(Boolean).join(' · ')}</div>
              </div>
              <div class="row">
                <a class="btn small" href="#/t/{t.id}/edit">Edit</a>
                <button class="small danger" disabled={working === t.id} onclick={() => deleteTournament(t)}>Delete</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="small muted">Staff can fix any tournament. Changes to someone else's tournament are written to the audit log.</p>
    </section>

  <!-- ============================================================ audit log -->
  {:else if current === 'audit'}
    <section>
      <div class="row tools">
        <input bind:value={aq} placeholder="Filter (name, action…)" aria-label="Filter the audit log" />
        <button class="small" onclick={loadAudit}>Refresh</button>
      </div>
      {#if auditRows === null}
        <p class="small muted">Loading…</p>
      {:else if !auditShown.length}
        <p class="small muted">Nothing{aq.trim() ? ' matches' : ' recorded yet'}.</p>
      {:else}
        <div class="audit" role="table" aria-label="Audit log">
          <div class="arow ahead" role="row"><span role="columnheader">When</span><span role="columnheader">Who</span><span role="columnheader">What</span></div>
          {#each auditShown as r, i (i)}
            <div class="arow" role="row">
              <span role="cell" class="small muted" title={r.time}>{new Date(r.time).toLocaleString()}</span>
              <span role="cell"><b>{r.actor}</b>{#if r.role} <span class="small muted">{ROLE_LABEL[r.role as Role] ?? r.role}</span>{/if}</span>
              <span role="cell">{r.action}{#if r.target}: <b>{r.target}</b>{/if}{#if r.detail} <span class="muted">({r.detail})</span>{/if}</span>
            </div>
          {/each}
        </div>
        <p class="small muted">The newest {auditRows.length} entries. Kept in the sheet's Audit tab (last 2,000).</p>
      {/if}
    </section>

  <!-- ============================================================ security -->
  {:else if current === 'security'}
    <section>
      {#if shared}
        <h2>Who can create tournaments</h2>
        <div class="choices">
          <label class="choice" class:on={!site.lockCreate}>
            <input type="radio" name="lock" checked={!site.lockCreate} disabled={!app.store.can('settings') || savingSite} onchange={() => setLock(false)} />
            <span><b>Anyone</b><br /><span class="small muted">Whoever opens the site can run a tournament.</span></span>
          </label>
          <label class="choice" class:on={site.lockCreate}>
            <input type="radio" name="lock" checked={site.lockCreate} disabled={!app.store.can('settings') || savingSite} onchange={() => setLock(true)} />
            <span><b>Only organizers and staff</b><br /><span class="small muted">Give people the Organizer role under Users & roles. Stops junk tournaments.</span></span>
          </label>
        </div>
        {#if !app.store.can('settings')}<p class="small muted">Only admins can change this.</p>{/if}
      {/if}

      <h2>How accounts are protected</h2>
      <ul class="facts small">
        <li>Passwords are never stored, only a salted, keyed hash. Nobody (not even the owner) can read them.</li>
        <li>5 wrong passwords or recovery codes in a row lock the account for 10 minutes (written to the audit log).</li>
        <li>Forgotten passwords: a one-time recovery code each player saves, or a reset by staff.</li>
        <li>Players' PINs are never shown publicly; too many wrong PINs block PIN use in that tournament for a while.</li>
        <li>Suspended accounts are logged out at once and can't log in, join, check in or report with their PINs.</li>
        <li>"Log out everywhere" ends every session of an account (staff for others, players for themselves on their Account page).</li>
        <li>Staff only manage accounts below their own role, and everything they do is in the audit log.</li>
        <li>Discord webhook links and organizer keys stay secret in the sheet; pages only see whether they're set.</li>
      </ul>

      <h2>Roles and permissions</h2>
      <div class="roles" role="table" aria-label="Roles">
        <div class="rhead" role="row"><span role="columnheader">Role</span><span role="columnheader">How someone gets it</span><span role="columnheader">What they can do</span></div>
        <div role="row"><b role="cell">Site owner</b><span role="cell" class="rgets">The admin key, typed under Data & backup (per device)</span><span role="cell">Everything, including making admins and importing backups</span></div>
        <div role="row"><b role="cell">Admin</b><span role="cell" class="rgets">Given by the site owner to an account</span><span role="cell">Everything below, plus giving roles up to moderator, "Log in as" a player to fix things for them, and the security settings</span></div>
        <div role="row"><b role="cell">Moderator</b><span role="cell" class="rgets">Given by an admin</span><span role="cell">Fix or delete any tournament, rename and clean up players, edit profiles, suspend / log out / reset / remove accounts below them, read the audit log</span></div>
        <div role="row"><b role="cell">Organizer</b><span role="cell" class="rgets">Given by an admin, or anyone while creating is open</span><span role="cell">Create tournaments and run their own: results, entrants, format, finals, check-in, players' PINs</span></div>
        <div role="row"><b role="cell">Helper</b><span role="cell" class="rgets">The helper link from a tournament's Share panel</span><span role="cell">Same as the organizer, for that one tournament</span></div>
        <div role="row"><b role="cell">Player</b><span role="cell" class="rgets">Joining (a 6-digit PIN), or an account</span><span role="cell">Report and confirm their own matches, check in, drop out, their own profile and privacy</span></div>
        <div role="row"><b role="cell">Viewer</b><span role="cell" class="rgets">Anyone with the link</span><span role="cell">See brackets, results, rankings and public profiles</span></div>
      </div>
    </section>

  <!-- ============================================================ data & backup -->
  {:else}
    <section>
      <h2>Where data is saved</h2>
      <div class="choices">
        <label class="choice" class:on={s.source === 'local'}>
          <input type="radio" bind:group={s.source} value="local" />
          <span><b>This browser only</b><br /><span class="small muted">Nothing to set up. Other people can't see it.</span></span>
        </label>
        <label class="choice" class:on={s.source === 'sheets'}>
          <input type="radio" bind:group={s.source} value="sheets" />
          <span><b>Google Sheet</b><br /><span class="small muted">Free. Anyone with the link can view; organizers and staff edit.</span></span>
        </label>
      </div>

      {#if s.source === 'sheets'}
        <div class="sheet">
          <label class="field">
            <span>Apps Script web app URL</span>
            <input bind:value={s.sheetsUrl} placeholder="https://script.google.com/macros/s/…/exec" inputmode="url" />
          </label>
          <label class="field">
            <span>Site admin key <span class="muted">(owner only; staff use their account instead)</span></span>
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

      <hr class="rule" />
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
  {/if}
</div>

<style>
  .page { padding-top: 20px; max-width: 860px; }
  .back { display: inline-block; margin-bottom: 8px; color: var(--muted); text-decoration: none; }
  .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .head h1 { margin: 0; }
  .rolebadge { font: 600 13px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 3px 8px; color: var(--muted); }
  .rolebadge.staff { border-color: var(--accent); color: var(--accent); }
  .notice { margin: 0 0 18px; }
  .tabs { display: flex; gap: 2px; border-bottom: 2px solid var(--ink); margin: 12px 0 18px; overflow-x: auto; scrollbar-width: none; }
  .tabs button { border: 0; border-radius: 0; background: none; min-height: 40px; padding: 0 12px; color: var(--muted); font: 600 15px var(--font-cond); letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 3px solid transparent; margin-bottom: -2px; }
  .tabs button.on { color: var(--ink); border-bottom-color: var(--accent); }
  section { display: grid; gap: 14px; }
  h2 { margin: 8px 0 0; }
  .err { color: var(--danger); }
  .bad { color: var(--danger); }
  .linkish { background: none; border: 0; padding: 0; min-height: 0; color: var(--ink); text-decoration: underline; font: inherit; cursor: pointer; }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 2px solid var(--ink); border-bottom: 1px solid var(--line); }
  .stats > div { display: grid; gap: 2px; padding: 10px 12px; border-right: 1px solid var(--line); }
  .stats > div:last-child { border-right: 0; }
  .stats .lbl { font: 600 12px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .stats b { font: 700 30px var(--font-cond); }
  .stats b.alert { color: var(--danger); }
  @media (max-width: 600px) {
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .stats > div:nth-child(2) { border-right: 0; }
    .stats > div:nth-child(-n + 2) { border-bottom: 1px solid var(--line); }
  }
  .feed, .users, .tlist, .facts { list-style: none; margin: 0; padding: 0; }
  .feed li { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 15px; }
  .feed .when { padding-top: 1px; }
  .facts { display: grid; gap: 6px; padding-left: 18px; list-style: square; }
  .tools { flex-wrap: wrap; }
  .tools input { flex: 1; min-width: 180px; }
  .chips { display: flex; gap: 4px; }
  .chips button { min-height: 32px; padding: 0 10px; font-size: 14px; }
  .chips button.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .users { border-top: 2px solid var(--ink); }
  .users li { display: grid; gap: 6px; padding: 12px 2px; border-bottom: 1px solid var(--line); }
  .users li.sus { box-shadow: inset 3px 0 0 var(--danger); padding-left: 10px; }
  .who { display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; }
  .who a { font-weight: 700; text-decoration: none; }
  .who a:hover { text-decoration: underline; }
  .tag { font: 600 12px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 1px 6px; }
  .tag.role-admin, .tag.role-moderator { border-color: var(--accent); color: var(--accent); }
  .tag.bad { border-color: var(--danger); color: var(--danger); }
  .tag.warn { border-color: var(--warn); color: var(--warn); }
  .acts { flex-wrap: wrap; gap: 6px; }
  .acts button { white-space: normal; height: auto; padding-top: 5px; padding-bottom: 5px; }
  .rolepick { display: inline-flex; align-items: center; gap: 6px; }
  .rolepick select, .suspend select { width: auto; min-height: 32px; padding: 4px 8px; }
  .suspend { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line-strong); border-radius: var(--radius); }
  .suspend label { display: inline-flex; align-items: center; gap: 6px; }
  .pw { letter-spacing: 0.06em; user-select: all; }
  .tlist { border-top: 2px solid var(--ink); }
  .tlist li { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 2px; border-bottom: 1px solid var(--line); }
  .tlist a:not(.btn) { font-weight: 700; text-decoration: none; }
  .btn.small { min-height: 32px; padding: 0 10px; font-size: 14px; }
  .audit { border-top: 2px solid var(--ink); }
  .arow { display: grid; grid-template-columns: 170px minmax(0, 0.8fr) minmax(0, 1.4fr); gap: 4px 14px; padding: 8px 2px; border-bottom: 1px solid var(--line); font-size: 15px; }
  .ahead span { font: 600 13px var(--font-cond); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  @media (max-width: 600px) {
    .arow { grid-template-columns: minmax(0, 1fr); }
    .ahead { display: none; }
  }
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
  .choices { display: grid; gap: 8px; }
  .choice { display: flex; gap: 12px; align-items: start; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--card); cursor: pointer; }
  .choice.on { border-color: var(--ink); box-shadow: inset 3px 0 0 var(--accent); }
  .choice input { width: 18px; min-height: 0; margin-top: 3px; accent-color: var(--accent); }
  .sheet { display: grid; gap: 12px; }
  code { font-size: 13px; background: var(--card); border: 1px solid var(--line); padding: 1px 4px; border-radius: 3px; }
</style>

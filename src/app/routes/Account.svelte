<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { ROLE_LABEL, TWO_STEP, forgetAccount, orgKeyIds, stopLoginAs, viewingAs } from '../lib/store';
  import type { TournamentDoc } from '../lib/model';
  import QrCode from '../components/QrCode.svelte';

  interface Props {
    /** Where to go after logging in (e.g. "j/abc123"), from #/account/<path>. */
    next?: string;
  }
  let { next = '' }: Props = $props();
  /** Where to go after logging in: where they came from, else their profile. */
  const after = (playerId: string) => app.go(next || `p/${playerId}`);

  const can = $derived(!!app.store.login);
  // "Create account" in the top menu opens this form on sign-up
  let mode = $state<'login' | 'register' | 'recover'>(
    (() => {
      try {
        const s = sessionStorage.getItem('tt.signup');
        sessionStorage.removeItem('tt.signup');
        return s ? 'register' : 'login';
      } catch {
        return 'login';
      }
    })(),
  );
  let username = $state('');
  let password = $state('');
  let name = $state('');
  let showClaim = $state(false);
  let claimCode = $state('');
  let claimPin = $state('');
  let busy = $state(false);
  let error = $state('');
  let recoveryInput = $state('');
  /** A recovery code to show once (after sign-up, recovery, or making a new one). */
  let shownCode = $state('');
  let savedIt = $state(false);
  /** The code was shown right after logging in / signing up: "Done" then goes on to the profile. */
  let leaveAfterCode = false;
  /** Two-step login is on for this account: the login form asks for the code. */
  let needCode = $state(false);
  let loginCode = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      const claim = showClaim && claimPin.trim() ? { code: claimCode.trim(), pin: claimPin.trim() } : undefined;
      const a =
        mode === 'login'
          ? await app.store.login!(username.trim(), password, needCode ? loginCode.trim() : undefined)
          : mode === 'recover'
            ? await app.store.recover!(username.trim(), recoveryInput, password)
            : await app.store.register!({ username: username.trim(), password, name: name.trim(), claim });
      const code = 'recoveryCode' in a ? (a.recoveryCode as string | undefined) : undefined;
      app.refreshAccount();
      password = '';
      recoveryInput = '';
      needCode = false;
      loginCode = '';
      const offNote = 'twoStepOff' in a && a.twoStepOff ? ' Two-step login is off now: turn it on again below.' : '';
      app.notify(
        mode === 'login' ? `Logged in as ${a.name}` : mode === 'recover' ? 'New password set. Other devices are logged out.' + offNote : `Welcome, ${a.name}`,
      );
      if (code) {
        // show it before going anywhere: it's the only way back in without the site admin
        shownCode = code;
        savedIt = false;
        leaveAfterCode = true;
      } else after(a.playerId);
    } catch (err) {
      error = errorText(err);
      // name used by a player who played before: offer the join code + PIN fields
      if (/join code and your PIN/.test(error)) showClaim = true;
      // two-step login: the password was right, now the code
      if (error === TWO_STEP) {
        needCode = true;
        error = '';
      }
    } finally {
      busy = false;
    }
  }

  // ---- logged in

  let tournaments = $state<TournamentDoc[]>([]);
  $effect(() => {
    if (!app.account) return;
    void app.accountSync;
    app.store.loadAll().then((d) => (tournaments = d.tournaments), () => {});
  });
  const playing = $derived(
    app.account
      ? tournaments.filter((t) => t.entrants.some((e) => e.id === app.account!.playerId) || t.waitlist?.some((w) => w.id === app.account!.playerId))
      : [],
  );
  const running = $derived.by(() => {
    void app.accountSync;
    const mine = new Set(orgKeyIds());
    return tournaments.filter((t) => mine.has(t.id));
  });
  const newest = (list: TournamentDoc[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  let newName = $state('');
  let oldPass = $state('');
  let newPass = $state('');

  async function rename(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await app.store.renameSelf!(newName.trim());
      app.refreshAccount();
      newName = '';
      app.notify('Name changed everywhere');
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await app.store.changePassword!(oldPass, newPass);
      oldPass = newPass = '';
      app.notify('Password changed. Other devices are logged out.');
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  let codePass = $state('');
  async function makeCode(e: SubmitEvent) {
    e.preventDefault();
    if (app.account?.recovery && !confirm('Make a new recovery code? Your old one stops working.')) return;
    busy = true;
    error = '';
    try {
      shownCode = await app.store.newRecoveryCode!(codePass);
      savedIt = false;
      codePass = '';
      app.refreshAccount();
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(shownCode);
      app.notify('Recovery code copied');
    } catch {
      prompt('Copy your recovery code:', shownCode);
    }
  }

  function downloadCode() {
    const text =
      'Tournament Tester recovery code\n\n' +
      `Username: ${app.account?.username ?? ''}\nRecovery code: ${shownCode}\n\n` +
      'Use it on the Log in page: "Forgot your password?". It works once; you get a new one after using it.\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `recovery-code-${app.account?.username ?? 'account'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function doneWithCode() {
    shownCode = '';
    if (leaveAfterCode && app.account) after(app.account.playerId);
    leaveAfterCode = false;
  }

  // ---- two-step login
  let tsPass = $state('');
  let tsSetup = $state<{ secret: string; uri: string } | null>(null);
  let tsCode = $state('');
  let tsOff = $state(false);

  async function startTwoStep(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      tsSetup = await app.store.twoStepSetup!(tsPass);
      tsPass = '';
      tsCode = '';
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  async function finishTwoStep(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await app.store.twoStepOn!(tsCode.trim());
      tsSetup = null;
      tsCode = '';
      app.refreshAccount();
      app.notify('Two-step login is on');
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  async function stopTwoStep(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await app.store.twoStepOff!(tsPass, tsCode.trim());
      tsPass = tsCode = '';
      tsOff = false;
      app.refreshAccount();
      app.notify('Two-step login is off');
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  // ---- privacy and sessions
  async function setPrivacy(p: { privateProfile?: boolean; unranked?: boolean }) {
    busy = true;
    error = '';
    try {
      await app.store.setPrivacy!(p);
      app.refreshAccount();
      app.notify('Saved');
    } catch (err) {
      error = errorText(err);
      app.notify(error, 'error');
      app.refreshAccount(); // the checkbox shows what's really saved
    } finally {
      busy = false;
    }
  }

  async function logOutOthers() {
    if (!confirm('Log out on every other phone and computer? This device stays logged in.')) return;
    busy = true;
    error = '';
    try {
      await app.store.logoutAll!();
      app.notify('Logged out everywhere else');
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  // ---- delete account
  let delOpen = $state(false);
  let delPass = $state('');
  let delCode = $state('');
  async function deleteMe(e: SubmitEvent) {
    e.preventDefault();
    if (!confirm('Delete your account for good? This can\'t be undone.')) return;
    busy = true;
    error = '';
    try {
      const r = await app.store.deleteMe!(delPass, delCode.trim() || undefined);
      delPass = delCode = '';
      delOpen = false;
      mode = 'login';
      app.refreshAccount();
      app.notify(r.playerRemoved ? 'Account deleted' : 'Account deleted. Your past results stay under your name.');
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  function logOut() {
    if (viewingAs()) {
      stopLoginAs();
      app.refreshAccount();
      app.syncAccount();
      app.notify('Back to your own account');
      app.go('admin');
      return;
    }
    forgetAccount();
    mode = 'login';
    error = '';
    app.refreshAccount();
    app.notify('Logged out');
  }
</script>

<div class="wrap page">
  {#if !can}
    <h1>Account</h1>
    <p class="muted">Accounts work when the site saves to the shared Google Sheet (Settings).</p>
  {:else if app.account}
    {#if shownCode}
      <section class="panel codebox" aria-live="polite">
        <h2>Your recovery code</h2>
        <p class="small">
          If you ever forget your password, this code lets you set a new one. <b>It's shown only now.</b> Keep it somewhere safe
          (a note, a photo, a password manager).
        </p>
        <p class="code num">{shownCode}</p>
        <div class="row flow">
          <button class="small" onclick={copyCode}>Copy</button>
          <button class="small" onclick={downloadCode}>Download as a file</button>
        </div>
        <label class="check"><input type="checkbox" bind:checked={savedIt} /> I've saved my recovery code</label>
        <div><button class="primary" disabled={!savedIt} onclick={doneWithCode}>Done</button></div>
      </section>
    {/if}

    <p class="label">Logged in</p>
    <h1>{app.account.name}</h1>
    <p class="muted user">
      @{app.account.username}{#if app.account.role} · <b class="rolename">{ROLE_LABEL[app.account.role]}</b>{/if} ·
      <a href="#/p/{app.account.playerId}">Your results</a>{#if app.account.role} · <a href="#/admin">Admin</a>{/if}
    </p>

    <section>
      <h2>Playing in</h2>
      {#if playing.length}
        <ul class="list">
          {#each newest(playing) as t (t.id)}
            <li><a href="#/{t.signup || t.checkIn ? 'j' : 't'}/{t.id}">{t.name}</a> <span class="small muted">{t.game}</span></li>
          {/each}
        </ul>
      {:else}
        <p class="small muted">Nothing yet. Scan a tournament's QR code or type its join code on the Tournaments page.</p>
      {/if}
    </section>

    {#if running.length}
      <section>
        <h2>Running</h2>
        <ul class="list">
          {#each newest(running) as t (t.id)}
            <li><a href="#/t/{t.id}">{t.name}</a> <span class="small muted">{t.game}</span></li>
          {/each}
        </ul>
      </section>
    {/if}

    <p class="small muted">
      Your PINs and the tournaments you run come with you to any device you log in on. Tournaments you make while logged in
      are added automatically.
    </p>

    <hr class="rule" />

    <section>
      <h2>Name</h2>
      <form class="row" onsubmit={rename}>
        <input bind:value={newName} placeholder={app.account.name} maxlength="60" aria-label="New name" />
        <button type="submit" disabled={busy || !newName.trim()}>Change</button>
      </form>
      <p class="small muted">Changes it in every bracket and result.</p>
    </section>

    <section>
      <h2>Password</h2>
      <form class="grid" onsubmit={changePassword}>
        <label class="field"><span>Current password</span><input bind:value={oldPass} type="password" autocomplete="current-password" /></label>
        <label class="field"><span>New password</span><input bind:value={newPass} type="password" autocomplete="new-password" minlength="6" /></label>
        <div><button type="submit" disabled={busy || !oldPass || newPass.length < 6}>Change password</button></div>
      </form>
      <p class="small muted">This logs you out on every other device.</p>
    </section>

    <section>
      <h2>Recovery code</h2>
      {#if app.account.recovery}
        <p class="small muted">You have a recovery code for "Forgot your password?". Lost it? Make a new one (the old one stops working).</p>
      {:else}
        <p class="small notice">You don't have a recovery code yet. Make one now, so you can get back in if you forget your password.</p>
      {/if}
      <form class="row" onsubmit={makeCode}>
        <input bind:value={codePass} type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password" />
        <button type="submit" disabled={busy || !codePass}>{app.account.recovery ? 'New code' : 'Make code'}</button>
      </form>
    </section>

    <section>
      <h2>Two-step login</h2>
      {#if app.account.twoStep}
        <p class="small"><b class="on">On.</b> Logging in needs your password and a 6-digit code from your authenticator app.</p>
        {#if tsOff}
          <form class="grid" onsubmit={stopTwoStep}>
            <label class="field"><span>Password</span><input bind:value={tsPass} type="password" autocomplete="current-password" /></label>
            <label class="field"><span>Code from the app</span><input bind:value={tsCode} inputmode="numeric" autocomplete="one-time-code" maxlength="6" /></label>
            <div class="row flow">
              <button type="submit" disabled={busy || !tsPass || tsCode.trim().length !== 6}>Turn off</button>
              <button type="button" class="ghost" onclick={() => (tsOff = false)}>Cancel</button>
            </div>
          </form>
        {:else}
          <div><button class="small" onclick={() => ((tsOff = true), (tsPass = ''), (tsCode = ''))}>Turn off…</button></div>
        {/if}
        <p class="small muted">Lost your phone? "Forgot your password?" with your recovery code gets you in and turns two-step off.</p>
      {:else if tsSetup}
        <ol class="steps small">
          <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) and add an account.</li>
          <li>
            Scan this code. On this phone? Tap <a href={tsSetup.uri}>add to authenticator</a>, or type the key by hand.
            <div class="qr"><QrCode text={tsSetup.uri} label="Two-step login QR code" /></div>
            <span class="key num">{tsSetup.secret.match(/.{4}/g)?.join(' ')}</span>
          </li>
          <li>Type the 6-digit code the app shows.</li>
        </ol>
        <form class="row" onsubmit={finishTwoStep}>
          <input bind:value={tsCode} inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" aria-label="Code from the app" />
          <button type="submit" class="primary" disabled={busy || tsCode.trim().length !== 6}>Turn on</button>
        </form>
        <div><button class="small ghost" onclick={() => (tsSetup = null)}>Cancel</button></div>
      {:else}
        <p class="small muted">
          Extra protection: logging in also needs a code from an authenticator app on your phone, so a stolen password isn't
          enough. Recommended for staff.
        </p>
        <form class="row" onsubmit={startTwoStep}>
          <input bind:value={tsPass} type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password" />
          <button type="submit" disabled={busy || !tsPass}>Set up</button>
        </form>
      {/if}
    </section>

    <section>
      <h2>Privacy</h2>
      <label class="check">
        <input type="checkbox" checked={!!app.account.privateProfile} disabled={busy} onchange={(e) => setPrivacy({ privateProfile: e.currentTarget.checked })} />
        <span>Private profile <span class="small muted">(only you and staff see your photo, bio and links)</span></span>
      </label>
      <label class="check">
        <input type="checkbox" checked={!!app.account.unranked} disabled={busy} onchange={(e) => setPrivacy({ unranked: e.currentTarget.checked })} />
        <span>Hide me from the rankings <span class="small muted">(your results still count in brackets and for opponents)</span></span>
      </label>
    </section>

    <section>
      <h2>Devices</h2>
      <div class="row flow">
        <button onclick={logOutOthers} disabled={busy}>Log out everywhere else</button>
        <span class="small muted">For a lost phone or a shared computer.</span>
      </div>
    </section>

    {#if error}<p class="small err">{error}</p>{/if}

    <hr class="rule" />
    <div class="row">
      <button onclick={logOut}>Log out</button>
      <span class="small muted">Also removes your PINs and organizer keys from this device. Log in again to get them back.</span>
    </div>

    <section class="danger-zone">
      {#if delOpen}
        <h2>Delete account</h2>
        <p class="small">
          Your login, PINs on other devices and verified mark go. If you never played in a tournament, your name is removed too;
          otherwise your past results stay under your name.
        </p>
        <form class="grid" onsubmit={deleteMe}>
          <label class="field"><span>Password</span><input bind:value={delPass} type="password" autocomplete="current-password" /></label>
          {#if app.account.twoStep}
            <label class="field"><span>Code from the app</span><input bind:value={delCode} inputmode="numeric" autocomplete="one-time-code" maxlength="6" /></label>
          {/if}
          <div class="row flow">
            <button type="submit" class="danger" disabled={busy || !delPass || (app.account.twoStep && delCode.trim().length !== 6)}>Delete my account</button>
            <button type="button" class="ghost" onclick={() => (delOpen = false)}>Cancel</button>
          </div>
        </form>
      {:else}
        <div><button class="small ghost danger" onclick={() => ((delOpen = true), (delPass = ''), (delCode = ''))}>Delete account…</button></div>
      {/if}
    </section>
  {:else}
    <h1>{mode === 'login' ? 'Log in' : mode === 'recover' ? 'Forgot your password?' : 'Create an account'}</h1>
    {#if mode === 'recover'}
      <p class="muted intro">
        Type your username, the recovery code you saved when you made your account, and a new password. No code? Ask the site
        admin: they can give you a new password.
      </p>
    {:else}
      <p class="muted intro">
        An account keeps your PINs and the tournaments you run on every device, and lets you join a tournament with one tap.
        You can still play without one.
      </p>
    {/if}

    <form class="grid form" onsubmit={submit}>
      {#if mode === 'register'}
        <label class="field">
          <span>Your name <span class="muted">(shown in brackets)</span></span>
          <input bind:value={name} maxlength="60" autocomplete="nickname" />
        </label>
      {/if}
      <label class="field">
        <span>Username</span>
        <input bind:value={username} maxlength="24" autocomplete="username" autocapitalize="none" spellcheck="false" />
      </label>
      {#if mode === 'recover'}
        <label class="field">
          <span>Recovery code</span>
          <input bind:value={recoveryInput} placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        </label>
      {/if}
      <label class="field">
        <span>{mode === 'recover' ? 'New password' : 'Password'}{#if mode !== 'login'} <span class="muted">(6 or more characters)</span>{/if}</span>
        <input bind:value={password} type="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
      </label>
      {#if mode === 'login' && needCode}
        <label class="field">
          <span>Code from your authenticator app</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={loginCode} inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" autofocus />
        </label>
        <p class="small muted hint">Lost your phone? Use "Forgot your password?" with your recovery code.</p>
      {/if}

      {#if mode === 'register'}
        {#if showClaim}
          <fieldset class="claim">
            <legend>Played here before without an account?</legend>
            <p class="small muted">
              Type the join code and your PIN from one of your tournaments (the organizer can look it up). Your past results
              move to your account.
            </p>
            <div class="row">
              <input bind:value={claimCode} placeholder="Join code" maxlength="8" autocapitalize="characters" aria-label="Join code" />
              <input bind:value={claimPin} placeholder="PIN" inputmode="numeric" maxlength="6" aria-label="PIN" />
            </div>
          </fieldset>
        {:else}
          <button type="button" class="linkish small" onclick={() => (showClaim = true)}>Played here before without an account?</button>
        {/if}
      {/if}

      {#if error}<p class="small err">{error}</p>{/if}
      <button
        class="accent big"
        type="submit"
        disabled={busy || !username.trim() || !password || (mode === 'register' && !name.trim()) || (mode === 'recover' && !recoveryInput.trim()) || (mode === 'login' && needCode && loginCode.trim().length !== 6)}
      >
        {busy ? 'One moment…' : mode === 'login' ? 'Log in' : mode === 'recover' ? 'Set new password' : 'Create account'}
      </button>
    </form>

    <p class="switch">
      {#if mode === 'login'}
        No account yet? <button class="linkish" onclick={() => ((mode = 'register'), (error = ''), (needCode = false))}>Create one</button>
      {:else}
        {mode === 'recover' ? 'Remembered it?' : 'Have an account?'} <button class="linkish" onclick={() => ((mode = 'login'), (error = ''))}>Log in</button>
      {/if}
    </p>
    {#if mode === 'login'}
      <p class="small"><button class="linkish" onclick={() => ((mode = 'recover'), (error = ''), (password = ''))}>Forgot your password?</button></p>
    {/if}
  {/if}
</div>

<style>
  .page { padding-top: 28px; max-width: 520px; }
  h1 { margin-bottom: 6px; overflow-wrap: anywhere; }
  .label { margin: 0; font: 600 13px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .user { margin: 0 0 24px; }
  .intro { margin: 0 0 20px; }
  section { display: grid; gap: 10px; margin-bottom: 22px; }
  h2 { margin: 0; }
  .grid { display: grid; gap: 12px; }
  .form { margin-bottom: 18px; }
  .big { min-height: 50px; font-size: 17px; }
  .list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .list li { padding: 10px 2px; border-bottom: 1px solid var(--line); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .list a { font-weight: 600; text-decoration: none; }
  .list a:hover { text-decoration: underline; }
  .row { flex-wrap: nowrap; }
  .row input { flex: 1; min-width: 0; }
  .claim { border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 10px 12px 12px; display: grid; gap: 8px; margin: 0; }
  .claim legend { font-weight: 600; padding: 0 4px; }
  .claim p { margin: 0; }
  .linkish { background: none; border: 0; padding: 0; min-height: 0; color: var(--ink); text-decoration: underline; font: inherit; cursor: pointer; justify-self: start; }
  .linkish.small { font-size: 14px; }
  .switch { margin: 0 0 8px; }
  .err { color: var(--danger); margin: 0; }
  .codebox { padding: 14px; margin-bottom: 24px; border-color: var(--accent); }
  .codebox p { margin: 0; }
  .code { font: 700 26px var(--font-cond); letter-spacing: 0.08em; overflow-wrap: anywhere; user-select: all; }
  .row.flow { flex-wrap: wrap; justify-content: flex-start; }
  .codebox > div { justify-self: start; }
  @media (max-width: 520px) { .row:not(form) { flex-wrap: wrap; } }
  .rolename { color: var(--accent); font-weight: 600; }
  .on { color: var(--ok, var(--ink)); }
  .check { display: flex; gap: 10px; align-items: start; }
  .check input { width: 18px; min-height: 0; margin-top: 3px; accent-color: var(--accent); flex: none; }
  .steps { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
  .qr { width: 180px; margin: 8px 0 4px; background: #fff; padding: 6px; border: 1px solid var(--line); }
  .key { display: block; font: 600 16px var(--font-cond); letter-spacing: 0.08em; overflow-wrap: anywhere; user-select: all; }
  .hint { margin: -4px 0 0; }
  .danger-zone { margin-top: 26px; }
</style>

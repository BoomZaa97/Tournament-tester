<script lang="ts">
  import { app, errorText } from '../lib/app.svelte';
  import { forgetAccount, orgKeyIds } from '../lib/store';
  import type { TournamentDoc } from '../lib/model';

  interface Props {
    /** Where to go after logging in (e.g. "j/abc123"), from #/account/<path>. */
    next?: string;
  }
  let { next = '' }: Props = $props();

  const can = $derived(!!app.store.login);
  let mode = $state<'login' | 'register'>('login');
  let username = $state('');
  let password = $state('');
  let name = $state('');
  let showClaim = $state(false);
  let claimCode = $state('');
  let claimPin = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      const claim = showClaim && claimPin.trim() ? { code: claimCode.trim(), pin: claimPin.trim() } : undefined;
      const a =
        mode === 'login'
          ? await app.store.login!(username.trim(), password)
          : await app.store.register!({ username: username.trim(), password, name: name.trim(), claim });
      app.refreshAccount();
      password = '';
      app.notify(mode === 'login' ? `Logged in as ${a.name}` : `Welcome, ${a.name}`);
      if (next) app.go(next);
    } catch (err) {
      error = errorText(err);
      // name used by a player who played before: offer the join code + PIN fields
      if (/join code and your PIN/.test(error)) showClaim = true;
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

  function logOut() {
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
    <p class="label">Logged in</p>
    <h1>{app.account.name}</h1>
    <p class="muted user">@{app.account.username} · <a href="#/p/{app.account.playerId}">Your results</a></p>

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

    {#if error}<p class="small err">{error}</p>{/if}

    <hr class="rule" />
    <div class="row">
      <button onclick={logOut}>Log out</button>
      <span class="small muted">Also removes your PINs and organizer keys from this device. Log in again to get them back.</span>
    </div>
  {:else}
    <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>
    <p class="muted intro">
      An account keeps your PINs and the tournaments you run on every device, and lets you join a tournament with one tap.
      You can still play without one.
    </p>

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
      <label class="field">
        <span>Password{#if mode === 'register'} <span class="muted">(6 or more characters)</span>{/if}</span>
        <input bind:value={password} type="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
      </label>

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
      <button class="accent big" type="submit" disabled={busy || !username.trim() || !password || (mode === 'register' && !name.trim())}>
        {busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Create account'}
      </button>
    </form>

    <p class="switch">
      {#if mode === 'login'}
        No account yet? <button class="linkish" onclick={() => ((mode = 'register'), (error = ''))}>Create one</button>
      {:else}
        Have an account? <button class="linkish" onclick={() => ((mode = 'login'), (error = ''))}>Log in</button>
      {/if}
    </p>
    {#if mode === 'login'}
      <p class="small muted">Forgot your password? Ask the site admin: they can give you a new one.</p>
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
  @media (max-width: 520px) { .row:not(form) { flex-wrap: wrap; } }
</style>

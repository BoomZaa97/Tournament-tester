<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { forgetAccount, ROLE_LABEL, stopLoginAs, viewingAs } from '../lib/store';

  /** The account menu at the top right: profile, account, settings, admin, log out. */
  interface Props {
    /** Staff on this device: show the Admin link. */
    staff: boolean;
    /** The current top-level route, to mark the open page. */
    section: string;
  }
  let { staff, section }: Props = $props();

  const shared = $derived(app.store.kind === 'sheets');
  const role = $derived((void app.account, app.store.role()));
  let open = $state(false);
  let root: HTMLDivElement;

  const label = $derived(app.account ? app.account.name : shared ? 'Account' : 'Menu');
  const active = $derived(['account', 'settings', 'admin'].includes(section) || (section === 'p' && app.path[1] === app.account?.playerId));

  function close() {
    open = false;
  }

  function onDocClick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) close();
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      close();
      root.querySelector<HTMLButtonElement>('.trigger')?.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...root.querySelectorAll<HTMLElement>('[role=menuitem]')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
      e.preventDefault();
    }
  }

  async function toggle() {
    open = !open;
    if (open) {
      await Promise.resolve();
      root.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    }
  }

  // any navigation closes it
  $effect(() => {
    void app.path;
    close();
  });

  const asOther = $derived((void app.account, viewingAs()));

  function logOut() {
    if (asOther) stopLoginAs();
    else forgetAccount();
    app.refreshAccount();
    if (asOther) app.syncAccount();
    close();
    app.notify(asOther ? 'Back to your own account' : 'Logged out');
    app.go(asOther ? 'admin' : '');
  }
</script>

<svelte:document onclick={onDocClick} onkeydown={onKey} />

<div class="menu" bind:this={root}>
  <button class="trigger" class:on={active} aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
    <span class="name">{label}</span><span class="caret" aria-hidden="true"></span>
  </button>
  {#if open}
    <div class="panel" role="menu" aria-label="Account menu">
      {#if app.account}
        <div class="who">
          <b>{app.account.name}</b>
          <span class="small muted">@{app.account.username}{#if role} · {ROLE_LABEL[role]}{/if}</span>
        </div>
        <a role="menuitem" href="#/p/{app.account.playerId}">Your profile</a>
        <a role="menuitem" href="#/account">Account and security</a>
      {:else if shared}
        <a role="menuitem" href="#/account">Log in</a>
        <a role="menuitem" href="#/account" onclick={() => sessionStorage.setItem('tt.signup', '1')}>Create account</a>
      {/if}
      <a role="menuitem" href="#/settings">Settings</a>
      {#if staff}<a role="menuitem" href="#/admin">Admin</a>{/if}
      {#if app.account}
        <hr />
        <button role="menuitem" class="out" onclick={logOut}>{asOther ? 'Back to my account' : 'Log out'}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu { position: relative; flex: none; }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 180px;
    min-height: 36px;
    padding: 0 8px;
    border: 0;
    border-bottom: 3px solid transparent;
    border-radius: 0;
    background: none;
    font-weight: 600;
    font-size: 15px;
    color: var(--ink-2);
  }
  .trigger.on { color: var(--ink); border-bottom-color: var(--accent); }
  .trigger[aria-expanded='true'] { color: var(--ink); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .caret { width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; flex: none; }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 40;
    min-width: 210px;
    display: grid;
    padding: 6px 0;
    background: var(--paper);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
  }
  .who { display: grid; gap: 1px; padding: 6px 14px 8px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .who b { overflow-wrap: anywhere; }
  .panel a, .panel button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 9px 14px;
    min-height: 0;
    border: 0;
    border-radius: 0;
    background: none;
    font: inherit;
    font-size: 15px;
    color: var(--ink);
    text-decoration: none;
    cursor: pointer;
  }
  .panel a:hover, .panel button:hover, .panel a:focus-visible, .panel button:focus-visible { background: var(--card); outline: none; box-shadow: inset 3px 0 0 var(--accent); }
  .out { color: var(--danger) !important; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; }
  @media (max-width: 520px) {
    .trigger { font-size: 14px; max-width: 150px; }
  }
</style>

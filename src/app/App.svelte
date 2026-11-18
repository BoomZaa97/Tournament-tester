<script lang="ts">
  import { app } from './lib/app.svelte';
  import Home from './routes/Home.svelte';
  import Create from './routes/Create.svelte';
  import Tournament from './routes/Tournament.svelte';
  import Poster from './routes/Poster.svelte';
  import Join from './routes/Join.svelte';
  import Players from './routes/Players.svelte';
  import PlayerPage from './routes/Player.svelte';
  import Settings from './routes/Settings.svelte';
  import Admin from './routes/Admin.svelte';
  import Account from './routes/Account.svelte';
  import UserMenu from './components/UserMenu.svelte';
  import { stopLoginAs, viewingAs } from './lib/store';

  const section = $derived(app.path[0] ?? '');
  // an admin used "Log in as" on this device
  const asOther = $derived((void app.account, viewingAs()));
  function backToMe() {
    stopLoginAs();
    app.refreshAccount();
    app.syncAccount();
    app.notify('Back to your own account');
    app.go('admin');
  }
  // staff (site owner, admins, moderators) get the Admin menu; re-read when the account changes
  const staff = $derived((void app.account, app.store.kind === 'sheets' && app.store.can('audit')));
  // bring a logged-in account's PINs and organizer keys onto this device
  app.syncAccount();
</script>

<header class="top no-print">
  <div class="wrap bar">
    <a class="brand" href="#/">
      <span class="mark" aria-hidden="true"></span>
      <span><small>Project:</small> Tournament Tester</span>
    </a>
    <nav>
      <a href="#/" class:on={section === '' || section === 't' || section === 'j' || section === 'new'}>Tournaments</a>
      <a href="#/players" class:on={section === 'players' || (section === 'p' && app.path[1] !== app.account?.playerId)}>Rankings</a>
    </nav>
    <UserMenu {staff} {section} />
  </div>
</header>

{#if asOther && app.account}
  <div class="viewas no-print" role="status">
    <div class="wrap row">
      <span>You're logged in as <b>{app.account.name}</b> (@{app.account.username}). Everything you do counts as them.</span>
      <button class="small" onclick={backToMe}>Back to my account</button>
    </div>
  </div>
{/if}

<main>
  {#key app.path.join('/')}
    {#if section === 'new'}
      <Create />
    {:else if section === 'j' && app.path[1]}
      <Join id={app.path[1]} />
    {:else if section === 't' && app.path[1] && app.path[2] === 'poster'}
      <Poster id={app.path[1]} />
    {:else if section === 't' && app.path[1]}
      <Tournament id={app.path[1]} tab={app.path[2] ?? 'bracket'} arg={app.path[3]} />
    {:else if section === 'players'}
      <Players />
    {:else if section === 'p' && app.path[1]}
      <PlayerPage id={app.path[1]} />
    {:else if section === 'settings'}
      <Settings />
    {:else if section === 'admin'}
      <Admin />
    {:else if section === 'account'}
      <Account next={app.path.slice(1).join('/')} />
    {:else}
      <Home />
    {/if}
  {/key}
</main>

{#if app.toast}
  <div class="toast {app.toast.kind}" role="status">{app.toast.text}</div>
{/if}

<style>
  .top {
    border-bottom: 2px solid var(--ink);
    background: var(--paper);
    position: sticky;
    top: 0;
    z-index: 20;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 56px;
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    font-family: var(--font-cond);
    font-weight: 700;
    font-size: 21px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-right: auto;
  }
  .brand small {
    font-weight: 500;
    color: var(--muted);
    font-size: 15px;
  }
  .mark {
    width: 14px;
    height: 22px;
    border: 3px solid var(--ink);
    border-left: 0;
    position: relative;
  }
  .mark::after {
    content: '';
    position: absolute;
    right: -10px;
    top: 7px;
    width: 8px;
    height: 3px;
    background: var(--accent);
  }
  nav {
    display: flex;
    gap: 2px;
    margin: 0 -8px;
    min-width: 0;
    max-width: calc(100% + 16px);
    /* narrow phone (or large text): slide sideways instead of spilling off the screen */
    overflow-x: auto;
    scrollbar-width: none;
  }
  nav::-webkit-scrollbar { display: none; }
  nav a {
    flex: none;
    white-space: nowrap;
    text-decoration: none;
    padding: 8px;
    font-weight: 600;
    font-size: 15px;
    color: var(--ink-2);
    border-bottom: 3px solid transparent;
  }
  nav a.on {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  main {
    padding-bottom: 80px;
  }
  .viewas { background: var(--accent); color: #fff; padding: 8px 0; font-size: 15px; }
  .viewas .row { justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  .viewas button { background: #fff; color: #16181d; border-color: #fff; }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    background: var(--ink);
    color: var(--paper);
    padding: 11px 16px;
    border-radius: var(--radius);
    font-weight: 500;
    max-width: calc(100vw - 32px);
    z-index: 100;
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
  @media (max-width: 520px) {
    .top { position: static; }
    .bar { gap: 0 4px; min-height: 0; padding-top: 10px; }
    .brand { font-size: 18px; }
    .brand small { display: none; }
    nav { width: 100%; justify-content: flex-start; margin-top: 2px; order: 3; }
    nav a { padding: 6px 8px; font-size: 14px; }
  }
</style>

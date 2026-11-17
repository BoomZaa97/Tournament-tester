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
  import Account from './routes/Account.svelte';

  const section = $derived(app.path[0] ?? '');
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
      <a href="#/players" class:on={section === 'players' || section === 'p'}>Players</a>
      <a href="#/settings" class:on={section === 'settings'}>Settings</a>
      {#if app.store.kind === 'sheets'}
        <a href="#/account" class="acct" class:on={section === 'account'}>{app.account ? app.account.name : 'Log in'}</a>
      {/if}
    </nav>
  </div>
</header>

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
  }
  nav a {
    text-decoration: none;
    padding: 8px;
    font-weight: 600;
    font-size: 15px;
    color: var(--ink-2);
    border-bottom: 3px solid transparent;
  }
  nav a.acct {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  nav a.on {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  main {
    padding-bottom: 80px;
  }
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
    nav { width: 100%; justify-content: flex-start; margin-top: 2px; }
    nav a { padding: 6px 8px; font-size: 14px; }
  }
</style>

<script lang="ts">
  import { gameOf } from '../lib/games';
  import QrCode from '../components/QrCode.svelte';
  import { app, errorText } from '../lib/app.svelte';
  import { FORMAT_LABEL, scriptOutdated, UPDATE_SCRIPT } from '../lib/model';
  import type { TournamentDoc } from '../lib/model';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  let doc = $state<TournamentDoc | null>(null);
  let error = $state('');
  app.store
    .get(id)
    .then((d) => (d ? (doc = d) : (error = "This tournament doesn't exist (or was deleted).")))
    .catch((e) => (error = errorText(e)));

  // the phone sign-up page; it sends people on to the bracket when there's nothing to do there
  const link = `${location.href.split('#')[0]}#/j/${id}`;
  const site = location.href.split('#')[0].replace(/^https?:\/\//, '').replace(/\/$/, '');
</script>

<div class="wrap page">
  <div class="row no-print bar">
    <a class="small" href="#/t/{id}/edit">← Back</a>
    <span class="spacer"></span>
    <button class="primary" onclick={() => print()} disabled={!doc}>Print poster</button>
  </div>

  {#if error}
    <p class="notice">{error}</p>
  {:else if !doc}
    <p class="muted">Loading…</p>
  {:else}
    {#if scriptOutdated(doc, app.store.kind)}
      <p class="notice small no-print">No join code yet: {UPDATE_SCRIPT} The QR code works already.</p>
    {/if}
    <article class="poster">
      <div class="label">{[gameOf(doc), FORMAT_LABEL[doc.format]].filter(Boolean).join(' · ')}</div>
      <h1>{doc.name}</h1>
      <p class="lead">{doc.signup ? 'Playing? Scan to sign up and get your PIN.' : 'Scan to follow the bracket and report your scores.'}</p>
      <div class="qr"><QrCode text={link} label="QR code for {doc.name}" /></div>
      {#if doc.code}
        <div class="codebox">
          <div class="label">Or open {site} and type the code</div>
          <div class="code">{doc.code}</div>
        </div>
      {/if}
    </article>
  {/if}
</div>

<style>
  .page { padding-top: 18px; }
  .bar { margin-bottom: 18px; }
  .poster {
    max-width: 640px;
    margin: 0 auto;
    border: 2px solid var(--ink);
    border-radius: var(--radius);
    background: var(--card);
    padding: clamp(18px, 5vw, 40px);
    text-align: center;
    display: grid;
    gap: 14px;
    justify-items: center;
  }
  h1 { font-size: clamp(32px, 9vw, 64px); overflow-wrap: anywhere; line-height: 1; }
  .lead { font-size: clamp(17px, 4vw, 22px); margin: 0; }
  .qr { width: min(340px, 100%); border: 1px solid var(--line); }
  .codebox { border-top: 2px solid var(--ink); padding-top: 12px; width: 100%; }
  .codebox .label { overflow-wrap: anywhere; }
  .code {
    font: 700 clamp(48px, 16vw, 104px) / 1 var(--font-cond);
    letter-spacing: 0.12em;
    color: var(--accent);
    margin-top: 6px;
    overflow-wrap: anywhere;
  }
  @media print {
    .page { padding: 0; }
    .poster { border: 0; max-width: none; color: #000; background: #fff; }
    .poster .label { color: #444; }
  }
</style>

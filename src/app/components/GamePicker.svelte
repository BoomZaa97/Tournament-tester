<script lang="ts">
  import { canonicalGame, cleanGame, GAME_GROUPS, GAMES } from '../lib/games';

  interface Props {
    /** The chosen game's name ('' = none yet). */
    game: string;
    /** Games already played on this site, most played first. */
    used?: string[];
    id?: string;
  }
  let { game = $bindable(), used = [], id = 'game-pick' }: Props = $props();

  const OTHER = '\u0000other';
  const listed = new Set(GAMES.map((g) => g.name));
  // games played here come first; the full list follows (without repeating them)
  const here = $derived(used.slice(0, 10));
  const extraHere = $derived(here.filter((g) => !listed.has(g)));

  let choice = $state(game && (listed.has(game) || used.includes(game)) ? game : game ? OTHER : '');
  let other = $state(choice === OTHER ? game : '');

  // what gets stored: a listed game, or the typed name tidied (a known alias becomes the listed name)
  const typed = $derived(canonicalGame(other, used));
  $effect(() => {
    game = choice === OTHER ? typed : choice;
  });
  // typed "cs go" → stored as CS2: say so
  const renamed = $derived(choice === OTHER && typed && typed !== cleanGame(other) ? typed : '');
</script>

<div class="picker">
  <select {id} bind:value={choice} class:empty={!choice} aria-required="true">
    <option value="" disabled>Choose the game…</option>
    {#if here.length}
      <optgroup label="Played here">
        {#each here as g}<option value={g}>{g}</option>{/each}
      </optgroup>
    {/if}
    {#each GAME_GROUPS as group}
      <optgroup label={group}>
        {#each GAMES.filter((g) => g.group === group && !here.includes(g.name)) as g}<option value={g.name}>{g.name}</option>{/each}
      </optgroup>
    {/each}
    <option value={OTHER}>Other game…</option>
  </select>
  {#if choice === OTHER}
    <input
      bind:value={other}
      maxlength="40"
      placeholder="Game name, written in full"
      list="{id}-used"
      aria-label="Other game's name"
      required
      autocomplete="off"
    />
    <datalist id="{id}-used">{#each extraHere as g}<option value={g}></option>{/each}</datalist>
    {#if renamed}
      <p class="small note">Saved as <b>{renamed}</b>, so it shares one ranking with the other {renamed} tournaments.</p>
    {:else}
      <p class="small muted note">Write it the way most people know it. Every tournament of a game shares one ranking.</p>
    {/if}
  {/if}
</div>

<style>
  .picker { display: grid; gap: 6px; min-width: 0; }
  select.empty { color: var(--muted); }
  select option { color: var(--ink); }
  .note { margin: 0; }
  .note b { color: var(--accent); }
</style>

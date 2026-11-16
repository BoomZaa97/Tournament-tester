<script lang="ts">
  import { BYE, applyEdit, matchAllowsDraws, winnerFromScores } from '../../core';
  import type { Decision, ResolvedMatch, ResultInput, TournamentState, Winner } from '../../core';
  import type { Scoring } from '../lib/model';

  interface Props {
    m: ResolvedMatch;
    tstate: TournamentState;
    title: string;
    names: Map<string, string>;
    numbers: Map<string, number>;
    scoring: Scoring;
    canEdit: boolean;
    /** Players may report this match themselves with their PIN (shared mode). */
    canReport?: boolean;
    /** The player this browser belongs to, if they signed up or reported before. */
    me?: { playerId: string; pin: string };
    onsave: (input: ResultInput | null, decisions: Record<string, Decision>) => Promise<boolean>;
    onreport?: (input: ResultInput, pin: string) => Promise<boolean>;
    onclose: () => void;
  }
  let { m, tstate, title, names, numbers, scoring, canEdit, canReport = false, me, onsave, onreport, onclose }: Props = $props();

  const allowDraw = matchAllowsDraws(m.template);
  /** A conflicted match whose players aren't decided any more can only be cleared. */
  const playable = m.p1 !== null && m.p1 !== BYE && m.p2 !== null && m.p2 !== BYE;
  const existing = m.result;
  /** A player (not an organizer) reporting an unplayed match. */
  const reportMode = !canEdit && canReport && !!onreport && m.status === 'ready' && !existing;
  const myMatch = !!me && (me.playerId === m.p1 || me.playerId === m.p2);
  let pin = $state(myMatch ? me!.pin : '');
  const pinOk = $derived(/^\d{6}$/.test(pin.trim()));
  const n1 = names.get(m.p1 as string) ?? '?';
  const n2 = names.get(m.p2 as string) ?? '?';

  let s1 = $state<number | undefined>(existing?.score1);
  let s2 = $state<number | undefined>(existing?.score2);
  let winner = $state<Winner | null>(existing?.winner ?? null);
  let forfeit = $state(!!existing?.forfeit);
  let winnerTouched = $state(false);
  let step = $state<'form' | 'confirm'>('form');
  let decisions = $state<Record<string, Decision>>({});
  let busy = $state(false);

  // Changing a score picks the winner, until the user taps a winner themselves.
  function scoresChanged() {
    if (winnerTouched || forfeit || (s1 === undefined && s2 === undefined)) return;
    // a blank score next to a filled one counts as 0
    const w = winnerFromScores(s1 ?? 0, s2 ?? 0, scoring.lowerWins);
    winner = w === 'draw' && !allowDraw ? null : w;
  }

  const hasScore = $derived(s1 !== undefined || s2 !== undefined);
  const input = $derived<ResultInput | null>(
    winner
      ? {
          winner,
          ...(hasScore && !forfeit && { score1: s1 ?? 0, score2: s2 ?? 0 }),
          ...(forfeit && { forfeit: true }),
        }
      : null,
  );

  const scoreDisagrees = $derived(
    !forfeit && winner && hasScore && winner !== winnerFromScores(s1 ?? 0, s2 ?? 0, scoring.lowerWins),
  );

  /** Dry run: what would this change do to the rest of the bracket? */
  function previewFor(next: ResultInput | null) {
    return applyEdit(tstate, m.template.id, next, decisions);
  }

  let pending = $state<ResultInput | null | undefined>(undefined);
  const preview = $derived(pending === undefined ? null : previewFor(pending));

  async function submit(next: ResultInput | null) {
    if (reportMode) {
      if (!next || !pinOk) return;
      busy = true;
      try {
        if (await onreport!(next, pin.trim())) onclose();
      } finally {
        busy = false;
      }
      return;
    }
    pending = next;
    const p = previewFor(next);
    if (p.conflicts.length === 0) return commit();
    step = 'confirm';
  }

  async function commit() {
    busy = true;
    try {
      if (await onsave(pending ?? null, decisions)) onclose();
    } finally {
      busy = false;
    }
  }

  function bump(which: 1 | 2, d: number) {
    if (which === 1) s1 = Math.max(0, (s1 ?? 0) + d);
    else s2 = Math.max(0, (s2 ?? 0) + d);
    scoresChanged();
  }

  const who = (id: string | null) => (id ? (names.get(id) ?? '?') : 'TBD');

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Match {numbers.get(m.template.id)}">
  <header>
    <div>
      <div class="label">Match {numbers.get(m.template.id)} · {title}</div>
      <h2>{n1} <span class="vs">vs</span> {n2}</h2>
    </div>
    <button class="ghost" onclick={onclose} aria-label="Close">✕</button>
  </header>

  {#if m.status === 'conflict' && step === 'form'}
    <p class="notice small">
      This result was entered for <b>{who(m.result!.p1)}</b> vs <b>{who(m.result!.p2)}</b>, but an earlier result changed.
      Save it again to confirm, or clear it.
    </p>
  {/if}

  {#if !canEdit && !reportMode}
    <div class="readonly">
      {#if existing}
        <p>{existing.winner === 'draw' ? 'Draw' : `${existing.winner === 'p1' ? n1 : n2} won`}{existing.forfeit ? ' by forfeit' : ''}
          {#if existing.score1 !== undefined}· {existing.score1}–{existing.score2}{/if}</p>
      {:else}
        <p class="muted">Not played yet.</p>
      {/if}
    </div>
  {:else if step === 'form'}
    {#if reportMode}
      {#if myMatch}
        <p class="small reporter">Reporting as <b>{names.get(me!.playerId)}</b>.</p>
      {:else}
        <label class="field pinfield">
          <span>Playing in this match? Enter your PIN to report the result</span>
          <input bind:value={pin} inputmode="numeric" autocomplete="off" maxlength="6" placeholder="6-digit PIN" />
        </label>
      {/if}
    {/if}
    <div class="scores">
      {#each [[1, n1, 'p1'], [2, n2, 'p2']] as [i, name, side] (side)}
        <div class="side" class:win={winner === side}>
          <button class="pick" onclick={() => { winner = side as Winner; winnerTouched = true; }} aria-pressed={winner === side}>
            <span class="pname">{name}</span>
            <span class="tag">{winner === side ? 'Winner' : 'Set winner'}</span>
          </button>
          {#if !forfeit}
            <div class="stepper">
              <button onclick={() => bump(i as 1 | 2, -1)} aria-label="Minus one for {name}">−</button>
              <input
                type="number"
                inputmode="numeric"
                min="0"
                placeholder="0"
                value={i === 1 ? s1 : s2}
                oninput={(e) => {
                  const v = Number.isNaN(e.currentTarget.valueAsNumber) ? undefined : e.currentTarget.valueAsNumber;
                  if (i === 1) s1 = v; else s2 = v;
                  scoresChanged();
                }}
                aria-label="Score for {name}"
              />
              <button onclick={() => bump(i as 1 | 2, 1)} aria-label="Plus one for {name}">+</button>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="row opts">
      {#if !reportMode}
        <label class="check"><input type="checkbox" bind:checked={forfeit} /> Forfeit / DQ</label>
      {/if}
      {#if allowDraw}
        <button class="small" class:on={winner === 'draw'} onclick={() => { winner = 'draw'; winnerTouched = true; }}>Draw</button>
      {/if}
    </div>
    {#if scoreDisagrees}<p class="small warnline">The winner you picked doesn't match the score. That's allowed, just checking.</p>{/if}

    <footer>
      {#if existing}
        <button class="danger ghost" onclick={() => submit(null)} disabled={busy}>Clear result</button>
      {/if}
      <span class="spacer"></span>
      {#if reportMode}
        <button class="primary big" onclick={() => submit(input)} disabled={!input || busy || !playable || !pinOk}>
          {busy ? 'Sending…' : 'Report result'}
        </button>
      {:else}
        <button class="primary big" onclick={() => submit(input)} disabled={!input || busy || !playable}>
          {existing ? 'Update result' : 'Save result'}
        </button>
      {/if}
    </footer>
  {:else if preview}
    <div class="confirm">
      <p>
        <b>{preview.conflicts.length} later match{preview.conflicts.length === 1 ? ' was' : 'es were'} already played</b>
        with players that change because of this edit. Choose what to do with each:
      </p>
      <ul>
        {#each preview.conflicts as c (c.matchId)}
          <li>
            <div class="small">
              <b>Match {numbers.get(c.matchId)}</b> was {who(c.played.p1)} vs {who(c.played.p2)},
              now {who(c.now.p1 as string)} vs {who(c.now.p2 as string)}
            </div>
            <div class="row seg">
              <button class="small" class:on={(decisions[c.matchId] ?? 'reset') === 'reset'} onclick={() => (decisions = { ...decisions, [c.matchId]: 'reset' })}>
                Reset (replay)
              </button>
              <button class="small" class:on={decisions[c.matchId] === 'keep'} disabled={!c.canKeep} onclick={() => (decisions = { ...decisions, [c.matchId]: 'keep' })}
                title={c.canKeep ? 'Keep the score, give it to the new player' : 'Not possible for this match'}>
                Keep score
              </button>
            </div>
          </li>
        {/each}
      </ul>
      <p class="small muted">Everything in this edit can be undone from the Log tab.</p>
      <footer>
        <button class="ghost" onclick={() => (step = 'form')}>Back</button>
        <span class="spacer"></span>
        <button class="accent big" onclick={commit} disabled={busy}>Apply {preview.changes.length} change{preview.changes.length === 1 ? '' : 's'}</button>
      </footer>
    </div>
  {/if}
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(10, 11, 13, 0.45); z-index: 50; }
  .sheet {
    position: fixed;
    z-index: 51;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow: auto;
    background: var(--paper);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    padding: 16px;
    display: grid;
    gap: 14px;
  }
  header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
  h2 { font-size: 24px; margin-top: 4px; overflow-wrap: anywhere; }
  .vs { color: var(--muted); font-size: 16px; }
  .scores { display: grid; gap: 8px; }
  .side {
    display: flex;
    align-items: stretch;
    gap: 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--card);
    padding: 6px;
  }
  .side.win { border-color: var(--ink); box-shadow: inset 4px 0 0 var(--accent); }
  .pick {
    all: unset;
    flex: 1;
    min-width: 0;
    cursor: pointer;
    display: grid;
    padding: 4px 8px;
  }
  .pick:focus-visible { outline: 2px solid var(--accent); }
  .pname { font-weight: 700; font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font: 600 12px var(--font-cond); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .win .tag { color: var(--accent); }
  .stepper { display: flex; align-items: center; gap: 4px; }
  .stepper button { width: 44px; min-height: 48px; padding: 0; font-size: 22px; }
  .stepper input { width: 56px; min-height: 48px; text-align: center; font: 700 24px var(--font-cond); padding: 0; }
  .opts { justify-content: space-between; }
  .reporter { margin: 0 0 10px; }
  .pinfield { margin-bottom: 12px; }
  .pinfield input { max-width: 180px; letter-spacing: 0.2em; font-variant-numeric: tabular-nums; }
  .on { border-color: var(--ink); background: var(--ink); color: var(--paper); }
  .warnline { color: var(--warn); margin: 0; }
  footer { display: flex; align-items: center; gap: 8px; }
  .big { min-height: 48px; padding: 0 20px; font-size: 16px; }
  .confirm ul { list-style: none; padding: 0; margin: 0 0 10px; display: grid; gap: 8px; }
  .confirm li { border: 1px solid var(--warn); background: var(--warn-soft); border-radius: var(--radius); padding: 10px; display: grid; gap: 8px; }
  .seg { gap: 4px; }
  .readonly p { font-size: 18px; margin: 0; }

  @media (max-width: 600px) {
    .sheet {
      top: auto;
      bottom: 0;
      transform: translateX(-50%);
      width: 100vw;
      border-radius: 10px 10px 0 0;
      border-bottom: 0;
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
    }
  }
</style>

# Project: Tournament Tester

A free tournament bracket maker with editable results and match history, for any game.
Made because Challonge made fixing wrong results hard.

## Owner's goals (from the planning chat)

- Universal: any game, solo or teams, any scoring (incl. lower-score-wins).
- All formats eventually: single elim, double elim, round robin, Swiss, groups, and finals after any points stage (all done).
- Owner + others can view; owner (and helpers with the admin key) edit.
- Works on phones and desktop. Low maintenance, no paid server.
- Design must NOT look AI-generated: plain "printed bracket sheet" look. Paper background, ink text,
  one accent colour (orange-red), Barlow / Barlow Condensed, tabular numbers. No gradients, glows, emoji.
  Owner said they don't mind the design beyond that.
- Everything must be editable: results, entrants, seeding, format, even mid-tournament.

## Live setup (done)

- Site: https://boomzaa97.github.io/Tournament-tester/ (GitHub Pages via `.github/workflows/deploy.yml`;
  Pages source must be "GitHub Actions" in repo settings).
- Data: Google Sheet "Tournament Tester data" in the owner's Drive
  (https://docs.google.com/spreadsheets/d/1M4MlnOivfrHzZAOAV8v4p3dhVMBuPslIJ-pe3tZun4g/edit),
  with `apps-script/Code.gs` pasted into Extensions → Apps Script and deployed as a web app
  (Execute as: Me, Access: Anyone). Its `/exec` URL is in `public/config.json`.
- `ADMIN_KEY` (Apps Script → Project Settings → Script properties) is the site admin key: full rights everywhere.
  The owner keeps it; never ask for it in chat and never commit it. It's entered per device in the site's Settings page.
- If `Code.gs` changes, the owner must paste it again and do Deploy → Manage deployments → edit →
  Version: New version (URL stays the same). Their Google UI is in Thai.

## Roles (no accounts; secrets live in each browser's localStorage)

| Role | Proof sent to Code.gs | Rights |
|---|---|---|
| Site admin | `key` = `ADMIN_KEY` | Everything; only one who can rename players or import backups |
| Organizer / helper | `orgKey` (random, made by the creator's browser, `tt.keys.v1`); sheet stores only `Tournaments.orgKeyHash` (SHA-256) | Save/delete that tournament, `pins`. Helper link = `#/t/<id>/org/<key>` |
| Player | 6-digit `Entrants.pin` (`tt.pins.v1`); never in GET responses | `signup` (only while `signup` is on and no results), `report` (own match, no result yet) |

- Anyone can create: a new tournament (`version` 0) is accepted with any `orgKey` ≥ 16 chars.
- Code.gs has no bracket engine, so `report` trusts the reporter's `p1`/`p2` snapshot; a wrong pairing shows up as
  a normal conflict for the organizer. Swiss rounds a player reports into get frozen on load (`toState` calls
  `lockSwissRounds`) and stored on the next organizer save.
- Entrant rewrites carry PINs over by playerId; new entrants get a PIN.
- `store.canEdit(id)` (admin key or org key for that id) replaces the old global flag.

## Architecture

| Path | What |
|---|---|
| `src/core/` | Bracket engine, pure TypeScript, no UI. `createTournament`, `resolve`, `applyEdit`, `undo`, `restructure`, `replaceEntrant`, standings. |
| `src/app/` | Svelte 5 SPA, hash routes (`#/t/<id>`), works from any sub-path. |
| `src/app/lib/store.ts` | Storage: `LocalStore` (browser) or `SheetsStore` (Apps Script). Swap without UI changes. |
| `apps-script/Code.gs` | Google Sheets backend. Tabs: Players, Tournaments, Entrants, Results, Log. Plain rows, editable by hand. |
| `test/` | Vitest: formats (random full runs 2–40 players), editing rules, Code.gs against a fake spreadsheet. |

### Core rule — don't break this

Only the bracket **structure** (regenerated from format + entrant count + options) and **match results** are stored.
Who plays each match is always derived by `resolve()`. Each result stores a snapshot of who played (`p1`, `p2`);
if the bracket later resolves different players into that match, it's a **conflict**, and `applyEdit` asks
`reset` (replay) or `keep` (credit the score to the new player). `applyEdit` is pure, so the UI calls it once as a
preview, shows conflicts, then again with the admin's decisions.

Other details:
- Bye matches (a slot is BYE) are hidden in the UI and not numbered (Swiss shows "Bye: name" instead).
- Draws only allowed in round robin and Swiss (`allowsDraws`).

### Swiss (`src/core/formats/swiss.ts`)

- Rounds that haven't started are NOT stored: their match slots use `{type:'swiss'}` sources and `resolve()`
  pairs them (`pairSwiss`) once every earlier round is done. So editing a past result re-pairs them for free.
- Rounds that HAVE started (≥1 result) are frozen in `options.swissPairings` (by seed, 0 = bye), so
  `structure = f(format, entrant count, options)` still holds. `applyEdit`/`undo` return `options` (via
  `lockSwissRounds`), and the app must save `out.options` with `out.results`. A round with no results left unfreezes.
- `restructure` carries frozen rounds over by player: removed player → their opponent gets a bye in started rounds;
  late entrant → sits out started rounds. Code.gs needed no change (options is already a JSON column).
- Pairing: rank by match points (win/bye 1, draw ½) then seed; top half vs bottom half within a score group;
  backtracking avoids rematches (rematches only if impossible); bye → lowest-ranked with fewest byes.
- Standings: same table as round robin (`roundRobinStandings`), byes = wins, extra `omw` (OMW%, floor 1/3) and `buchholz` tiebreakers
  (default order OMW%, Buchholz, h2h, diff, for). Default rounds = ceil(log2 n), max n−1 (even) / n (odd).
- Log entries keep `changes` (for undo) or `restore` (previous setup, for tournament edits).
- `SheetsStore` POSTs as `text/plain` (no CORS preflight, which Apps Script can't answer). Saves carry a `version`;
  mismatch → `conflict` error → app reloads.
- Svelte: don't name variables `state` in components (clashes with `$state`); the codebase uses `tstate`.

## Commands

```bash
npm install
npm run dev        # local dev server
npm test           # all tests (must pass; CI runs them before deploying)
npm run typecheck  # svelte-check, must be 0 errors 0 warnings
npm run build
```

Push to `main` = deploy. Check UI changes in a real browser (Playwright, desktop + iPhone size, light + dark).

### Groups and finals (`formats/groups.ts`, `formats/finals.ts`)

- Groups: snake seeding into `groupCount` round-robin groups (default ~4 per group, ≥2 each); ids `A-RR1-1`,
  side `RR` with `template.group`. Tables per group: `groupStandings`.
- Finals ("top cut") after any points stage (swiss / round robin / groups): `options.finals = {format, advance,
  thirdPlaceMatch?, grandFinal?, qualified?}`. `advance` is per group for groups. The finals bracket is a normal
  single/double elim with ids prefixed `F-` and `{type:'qualified', seed:k}` sources; `resolve()` leaves them
  null until `qualified` (entrant seeds in finals seed order) is set by the organizer (FinalsPanel → logged with
  `restore`, undoable). Frozen like Swiss rounds: editing stage 1 later doesn't move finalists (the panel warns).
- `suggestFinalists` (top N; groups: by place then group, A1 B1 A2 B2) + `tieAtCut`. `overallPlacements` =
  finalists by finals result, then the rest by stage-1 position. Points tables never count finals matches.
- Draws per match: `matchAllowsDraws(template)` (sides RR/SW only). Code.gs `report` mirrors this (`F-` ids never).
- `restructure` carries `qualified` by player; if a finalist is removed the finals go back to unconfirmed.

## Next up (agreed roadmap)

1. Maybe for Swiss: drop a player from future rounds without deleting their past results.
2. Maybe: rate-limit PIN guesses; let players confirm/dispute an opponent's report.
3. Later: Discord announcements, import from Challonge, Elo.

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
- Accounts (optional, `Accounts` tab, `routes/Account.svelte` at `#/account[/<return path>]`): username + password linked to
  one player. They add NO new rights: `me` hands a logged-in device the player's PINs and the account's org keys
  (`Accounts.orgKeys`, plain keys checked against `orgKeyHash`), written into `tt.pins.v1` / `tt.keys.v1`, so all PIN /
  org-key code works unchanged. `tt.account.v1` = {token, account, pins, keys}; the lists are what logout removes again.
  Token = `accountId.HMAC(ACCOUNT_SECRET, salt)` (stateless; a new salt on password change/reset logs other devices out).
  Passwords: HMAC with salt. 5 wrong in a row → 10 min lock. `signup` with `token` joins as the account's player; a name
  that belongs to an account can't be used by name. Registering a name that already played needs a PIN of that player
  (device PINs sent as `claims`, or join code + PIN typed). Admin: `resetPassword` (Player page). Players list has
  `account: true`. `app.account` / `app.accountSync` (pages re-read `myPin` when it changes); `app.syncAccount()` on start.
- `store.canEdit(id)` (admin key or org key for that id) replaces the old global flag.
- Rankings (`lib/ranking.ts`, `routes/Players.svelte` at `#/players`, nav "Rankings"): computed in the browser from results,
  nothing stored. Elo (start 1500, K 40 under 10 rated matches then 24; forfeits/byes/walkovers don't count; ranked from
  `PROVISIONAL` = 5 rated matches) and placement points (`placementPoints`, finished tournaments only), filtered by game,
  `TournamentDoc.category` (optional, `Tournaments.category`) and year. Player page: a rank card per game and per category
  they played, rating chart (`components/RatingChart.svelte`), medals, recent form.
- Profiles (`Profiles` tab, read only by `GET action=profile`, never in lists; `loadTables` skips it): photo = square JPEG
  data URL made by `lib/photo.ts` (≤ 45k chars), bio ≤ 280, ≤ 3 http(s) links. `POST action=profile`: the player's own
  account token or the admin key. Local mode keeps them in `tt.profiles.v1`.

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
- Sheet layout (`LAYOUT` = '2'): per-tournament tabs (`PER_TOURNAMENT`: Entrants, Results, Log, Waitlist) keep one
  contiguous block per tournament, in Tournaments-tab order (newest on top), with a `tournament` name column. Writes go
  through `writeBlock` / `appendRows` / `writeRow` (only that block or row; never clear-then-write a whole tab);
  `writeTable` (whole tab) only for Players/Accounts, renames and `tidyOnce` (one-time regroup of old sheets).
  `loadTables` skips the Log tab; `loadOne(id)` reads only one tournament's blocks. GET `get&since=<updatedAt>` →
  `{same:true}` when unchanged (`store.open`), `all&lite=1` leaves out logs (`loadAll()`; backup uses `{full:true}`),
  `players` = the registry (Edit tab). `onEdit` bumps `updatedAt` for hand edits. Real Sheets have a fixed row count and
  throw outside it: `scripts/fake-google.mjs` (shared by tests and `sheet:fake`) mimics that.
- Instant pages (the sheet takes 4–6 s): `lib/cache.ts` keeps what the sheet last sent in `tt.cache.v1` (per sheet URL; the
  lite list + up to 20 full tournaments). `store.peek(id)` / `peekAll()` return it synchronously (LocalStore: real data);
  pages render it first, then load (`since` only when the shown doc is `full`, i.e. has its log). Tournament header:
  "Updating…" → "Live · updated 12 s ago". Organizer saves are optimistic: `persist` sets `doc` at once and queues the save
  (`lib/saveQueue.ts`: one at a time, each sent with the last server `version`, waiting for the first load; a failure drops
  the queue, puts back `queue.confirmed` and reloads). Player report/confirm still wait for the sheet (PIN checks).
  `SHEET_DELAY=5000 npm run sheet:fake` mimics the slowness; `GET /fail?n=1` on it makes the next save fail.
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
npm run sheet:fake   # Code.gs on an in-memory sheet at http://localhost:5180/exec (admin key: test-admin)
```

End-to-end tests of shared features: run `sheet:fake` + `dev`, then in the site set
`localStorage["tt.settings.v1"] = {"source":"sheets","sheetsUrl":"http://localhost:5180/exec","adminKey":""}`.
Never create test data in the real Sheet. Put any `.claude/launch.json` you need for previews back out before committing.

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

### Venue features (join codes, waitlist, check-in, drop-outs, confirmations)

- Old-script compatibility: `SheetsStore.call` turns "Unknown action" into `UPDATE_SCRIPT` ("The site owner needs to update
  the Google script for this."). `scriptOutdated(doc)` = sheets mode and no `doc.code` (the new script always returns one).
- Join code: `Tournaments.code`, 6 chars from `CODE_CHARS` (no 0/O/1/I), made by Code.gs on first save, or by `ensureCodes`
  on any GET for older rows. Public lookup `GET action=code&code=…`. LocalStore makes codes too. Poster: `#/t/<id>/poster`
  (`routes/Poster.svelte`, QR drawn by `components/QrCode.svelte` with `qrcode-generator`, always black on white).
- Phone sign-up page `#/j/<id>` (`routes/Join.svelte`): the poster QR, the home page's code box and the share panel all point
  here. Name → Join, then PIN / waitlist place, "I'm here", next match and scores to confirm (links to
  `#/t/<id>/matches/<matchId>`, which opens that match). Nothing to do there (sign-up closed, no check-in, not a player on
  this device) → `location.replace` to the bracket.
- Saves now return `assemble(...)` of what was stored (code, waitlist, check-ins), not the posted doc.
- Waitlist: `Tournaments.maxPlayers`; `signup` puts people on the `Waitlist` tab when full or when anyone is already
  waiting. Waitlisted people are NOT entrants (`doc.waitlist`, ignored on save). Moving up = a normal organizer save that
  adds them as the last seed (`withEntrants` + `restore` log entry); `saveTournament` then takes their PIN (and check-in)
  from the Waitlist row and deletes it. Undoing a move-up removes them from the bracket (not back onto the waitlist).
- Check-in: `Tournaments.checkIn`, `Entrants/Waitlist.checkedIn`; `doc.checkedIn` = player ids. `checkin` action takes a
  PIN or (organizer) a playerId, only before the first result, and does NOT bump `version` (only `updatedAt`), so the
  page reloads on `updatedAt` changes too. "Remove no-shows" = `withEntrants` with a `restore` log entry. Removed
  players get a new PIN if they're added back (PINs aren't kept for removed entrants).
- Drop-outs: `options.dropped` (seeds). `resolve()` turns any unplayed match with a dropped player into a walkover
  (`status:'bye'`, `walkover:true`, real `loser`); swiss pairs only active players in unstarted rounds. Points tables
  count walkovers as a win/loss (byes exclude them); `swissRecord` gives the winner a point but no bye. A walkover GF
  needs no reset. `restructure` carries drops by player and leaves them out while re-placing results.
  `lockSwissRounds`: if a round someone reported into (not frozen yet) clashes with the pairing without dropped
  players, it freezes the pairing with everyone instead. Players drop with Code.gs `drop` (needs a result to exist;
  logged with `restore`); organizers via Edit tab → Drop-outs. `report` refuses matches with a dropped player.
- Confirmations: `MatchResult.status` ('reported' | 'confirmed' | 'disputed') + `reportedBy` (Results columns).
  `report` sets 'reported'; `confirm` (opponent's PIN, `ok`) sets confirmed/disputed with a before/after log entry.
  Anything the organizer saves through `applyEdit` has no status (= confirmed). The engine ignores these fields.

## Next up (agreed roadmap)

1. Maybe: rate-limit PIN guesses.
2. Maybe: keep PINs of removed entrants so undoing a removal gives them the same PIN.
3. Later: Discord announcements, import from Challonge.

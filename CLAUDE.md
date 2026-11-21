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
  The owner keeps it; never ask for it in chat and never commit it. It's entered per device on the site's Admin page (`#/admin`, linked from Settings).
- If `Code.gs` changes, the owner must paste it again and do Deploy → Manage deployments → edit →
  Version: New version (URL stays the same). Their Google UI is in Thai.

## Roles (no accounts; secrets live in each browser's localStorage)

| Role | Proof sent to Code.gs | Rights |
|---|---|---|
| Site admin | `key` = `ADMIN_KEY` | Everything; only one who can rename players, clean up unused players (`prunePlayers`: no tournament, no account; Admin page) or import backups |
| Organizer | `orgKey` (random, made by the creator's browser, `tt.keys.v1`); sheet stores only `Tournaments.orgKeyHash` (SHA-256) | Save/delete that tournament, `pins`, manage helpers. Own-device link = `#/t/<id>/org/<key>` |
| Helper | Their own `orgKey` (same `tt.keys.v1`, same `#/t/<id>/org/<key>` link); sheet stores `{id, name, hash, at}` in hidden `Tournaments.helpers` | Everything the organizer can except delete the tournament or manage helpers |
| Player | 6-digit `Entrants.pin` (`tt.pins.v1`); never in GET responses; guessing limited per tournament (`pinOwner` / `PIN_LIMIT`: 10 wrong in 10 min or 40 in 6 h → all PINs refused, counts in CacheService; account `claims` count too, max 50) | `signup` (only while `signup` is on and no results), `report` (own match, no result yet) |

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
  Passwords: HMAC with salt. 5 wrong in a row → 10 min lock (wrong recovery codes count too). Recovery (no email): each
  account has a one-time recovery code (16 hex, shown once at sign-up / recovery / `recoveryCode` with the password; only
  `Accounts.recoveryHash` kept). `recover` = username + code + new password → logs out other devices, new code.
  `account.recovery` says whether one exists (old accounts: make one on the Account page). `signup` with `token` joins as the account's player; a name
  that belongs to an account can't be used by name. Registering a name that already played (`hasPlayed`: entrant, waitlist or result) needs a PIN of that player; a leftover name with no results is free
  (device PINs sent as `claims`, or join code + PIN typed). Admin: `resetPassword` and `deleteAccount` (Player page; the player stays, unverified). A player with no matches still has a page. Players list has
  `account: true` (all lists, incl. `get`). `app.account` / `app.accountSync` (pages re-read `myPin` when it changes); `app.syncAccount()` on start.
- Verified names: a player with an account is "verified". `app.verified` (SvelteSet of ids, filled by `app.noteVerified(players)`
  from every player list a page gets; only adds) drives `components/Verified.svelte` (accent check mark next to names:
  bracket, matches, standings, rankings, profile, entrant editor). Lock in Code.gs (`verifiedNames` / `notVerifiedName`,
  names compared by `nameKey`: case and extra spaces ignored, same as `lib/players.ts` `nameKey`): a save can't create a
  new player id under a verified name, and `renamePlayer` (admin) can't rename someone else onto one.
- The device forgets organizer keys / PINs of deleted tournaments (`forgetDeleted`, on every `loadAll`, only ids held before
  the request). Removing the account this device is logged in to logs it out.
- `store.canEdit(id)` (`can('tournaments')` or org key for that id) replaces the old global flag.
- Staff roles (Code.gs "roles, suspensions, sessions, audit" section; `Accounts.role`): `ROLE_RANK` '' 0 < organizer 1 <
  moderator 2 < admin 3 < owner 4 (owner = `ADMIN_KEY`). `PERMS`: tournaments/players/accounts/audit = moderator,
  roles/settings = admin. `whoIs(body)` → actor (key, or `auth` = the account token, sent by `SheetsStore` only when the
  saved account has a role). Staff act only on accounts below them (`staffTarget`/`outranks`); only the owner makes admins.
  Client: `store.role()`, `store.can(perm)` (+ 'create': true unless `site.lockCreate`), `ROLE_LABEL`. Every staff
  action → `audit()` (Audit tab, newest first via insertRowsAfter, max 2000; `loadTables` skips it).
- Admin page (`routes/Admin.svelte`) = tabs by perms: Overview, Users & roles (role select, suspend 1/7/30/365 days/forever,
  log out everywhere, reset password, remove, clean up players), Tournaments, Audit log, Security (`lockCreate`, roles
  table), Data & backup. Nav link when `can('audit')` in sheets mode.
- Suspensions: `bannedUntil` ('forever' or ISO) + `banReason`; suspending changes `sessionNonce` (token includes it), login /
  recover / PINs refused (`suspendedAccountOf`). "Log out everywhere": `logoutAll` (self → new token for this device).
- Site settings: script property `SITE` JSON (`lockCreate`), sent as `site` in `GET all`, cached in `tt.site.v1`.
  `CREATE_LOCKED` for version-0 saves below organizer.
- Privacy: `Accounts.privateProfile` (GET profile → `{profile:null, private:true}`; POST `readProfile` for self/staff) and
  `unranked` = "hide my name in the rankings": they keep their place but show as "Anonymous" (not linked, not searchable)
  to everyone but themselves (Rankings, home Top players, Player leaderboard).
- Two-step login (TOTP, RFC 6238 SHA-1/6 digits/30 s, ±1 step): `twoStepSetup` (password → `totpPending` + otpauth URI,
  QR on the Account page), `twoStepOn` (first code), `twoStepOff` (password + code). Login without `code` → `TWO_STEP`
  error, the form then asks for it. `totpLast` = last step used (each code once). Wrong codes count towards the lock.
  Recovery code and staff reset turn it off (`twoStepOff: true` in the reply). Fake Google has `computeHmacSignature`.
- Deleting accounts: `deleteMe` (own password + code) or staff `deleteAccount`; both call `removePlayerIfUnused` (no
  entrant/waitlist/result → the player and profile go too, `playerRemoved`), so no separate clean-up.
- Player pages show the player ID (copy button).
- "Log in as" (Admin → Users, admins/owner only, `loginAs`): returns the player's normal token (audited, reason optional);
  `SheetsStore.loginAs` keeps the admin's own saved account in `tt.viewAs.v1` and marks the saved one `viewAs` (its sync
  sends no device org keys). Banner in App.svelte; "Back to my account" = `stopLoginAs()`.
- Header: Tournaments, Rankings + `components/UserMenu.svelte` dropdown (profile, account, settings, admin, log out).
  Logging in / signing up goes to `#/p/<playerId>` (or the `#/account/<path>` return path).
- Category vs division: `TournamentDoc.category` = kind of competition (Esports, Sports…), `division` = age / level
  (`Tournaments.division`, empty = Open). Read them with `categoryOf` / `divisionOf` (model.ts): an old category that
  looks like an age group (`DIVISION_LIKE`: Open, U18…) counts as the division until the tournament is edited.
  Rankings filter by both; with no filters, verified players without matches are listed as not ranked yet.
- Create: sign-up is on by default in shared mode and no entrants are required (the page waits for 2).
- Games (`lib/games.ts`): rankings are per game, so a game is written one way. `GAMES` = built-in list (Esports / Sports /
  Board & card games, with aliases: "cs2", "CSGO", "Counter-Strike 2" → CS2). Read a tournament's game ONLY with
  `gameOf(t)` (maps old free-typed names; compare/group/show with it), never `t.game`. `canonicalGame(raw, used)` = list name
  for a name/alias, else a spelling already used on the site (`gameKey`: case/spaces/punctuation ignored), else tidied as typed.
  `components/GamePicker.svelte` (Create + Edit setup): select with "Played here" (`usedGames`), the list, "Other game…" →
  required name ("Saved as CS2" hint). The game is required on Create and on Edit setup. Picking a listed game fills the
  category (`categoryForGame`) unless the organizer typed one. Challonge import stores `canonicalGame(got.game)`. Links
  `#/players/cs2` open CS2. Player page: "No. N in <game>" badges for top-10 places (not shown for Anonymous players).
- Home (`routes/Home.svelte`, `#/`): plain "results sheet" front page, no marketing hero / step lists / stat cards.
  Masthead (date line, "Tournaments & results", counts, New tournament). Top players shows the
  leaders greyed ("still settling") while nobody has PROVISIONAL rated matches yet. Left: On now, Taking sign-ups, Latest results
  (or a short "Nothing here yet" text). Right: join-code box, Top players (most played game), Official. Then the 6 most
  recent tournaments + link to the Tournaments page. No nav item is highlighted on Home (the brand links to it).
- Tournaments page (`routes/Tournaments.svelte`, `#/tournaments`, nav "Tournaments"): status tabs with counts, search,
  sort, and filters for game, category, division, format, event size, official only, taking sign-ups (folded behind a
  "Filters" button on phones). Filters live in `sessionStorage` `tt.tfilter.v1`. Rows: `components/TournamentRows.svelte`
  (also used by Home).
- Notices (announcements), backend only for now (the owner didn't want them on the site yet): `site.news` in the SITE
  script property (≤ 8, newest first; title ≤ 80, text ≤ 400, link https:// or #/…, `important`). Code.gs `news` action
  (perm 'tournaments', audited): `post` (with `id` = edit) or `remove`. Sent with `GET all` as `site.news`;
  `store.setNews`. No UI shows them.
- Footer (App.svelte, not on the poster): about line, Players / Organizers links, © year, back to top. Its link lists are
  `div.links`, not `nav` (App's header `nav a` styles would apply).
- Player page stats start with the overall rating (all games) and place.
- Settings are split: `#/settings` (`routes/Settings.svelte`, everyone) = this device's look (`lib/prefs.ts`, `tt.prefs.v1`:
  theme auto/light/dark → `data-theme` on <html>, text size → `data-size=large` = `zoom: 1.12` on body; Bracket divides its
  connector measurements by that zoom) and "Your access" (role, account, tournaments organized/played on this device).
  `#/admin` (`routes/Admin.svelte`; nav link only for the site admin in sheets mode, linked from Settings otherwise) = data
  source, admin key, roles and access table, verified players, backups.
- Rankings (`lib/ranking.ts`, `routes/Players.svelte` at `#/players`, nav "Rankings"): computed in the browser from results,
  nothing stored. Elo (start 1500, K 40 under 10 rated matches then 24; forfeits/byes/walkovers don't count; ranked from
  `PROVISIONAL` = 5 rated matches) and placement points (`placementPoints`, finished tournaments only), filtered by game,
  category / division (see below), event size and year. Event size = `TournamentDoc.tier`
  ('major' | 'semi' | 'small', `Tournaments.tier`, anything else = small; `tierOf`, `TIER_WEIGHT`: points ×2 / ×1.5 / ×1 via
  `eventPoints`; `TierPicker` in create/edit, `TierTag` badge). Rankings page: podium, "You" row + jump, verified-only
  switch, Majors column. Player page: a rank card per game and per category they played, rating chart
  (`components/RatingChart.svelte`), leaderboard around them, "By event size" honours table, tournaments with tier tag and
  points (filter chips), medals, recent form, head-to-head.
- Rankings are per game: game chips at the top ("Overview" first, then games most played first, "All games together"
  last), category chips under them, link `#/players/<game>` (`all-games` = every game, `overview` = a card per game with
  its top 5 and links to its categories; default = overview with 2+ games, else the one game; chips use
  `history.replaceState`, no reload). Home "Top players" and the Player page's Rating stat use the (player's) most played game.
- Helper links (Code.gs `helpers` action, `manageHelpers`; `organizerKind` → 'main' | 'helper' | ''): no `op` = `{you, helpers}`
  (no hashes; helpers get an empty list), `add` (name + `helperKey` made by the browser; NOT `key`, which `SheetsStore.call`
  always overwrites with the admin key), `remove`, `reset` (`newKey`: new `orgKeyHash`, organizer only; old copies of the
  organizer link, incl. old shared "helper links", stop working). Staff can list/remove (audited). `aboutMe` keeps any working
  key (`keyKind`). Site: Share panel → Helpers (new link shown once). A request refused with the "Only the organizer…" error
  while sending a key → `forgetOrgKey` + `KEY_GONE` message; `KEYS_CHANGED` event bumps `app.accountSync`, so
  `Tournament.svelte`'s `canEdit` drops the Edit tab.
- Official tournaments: `Tournaments.official` ('' | 'pending' | 'yes' | 'no', `officialOf`) + `officialNote`. Organizer
  `requestOfficial` (org key; `cancel` withdraws), staff `setOfficial` (perm 'tournaments', audited). Saves never change it
  (`saveTournament` copies unknown stored columns). `isOfficial(t)`, `OfficialTag` badge, `components/OfficialPanel.svelte`
  (Edit tab), Admin → Tournaments "Asked to be official" + Overview count.
- Confirmed rating: `RankRow.confirmed` / `confirmedRated` / `confirmedChange` / `officialEvents` = the same Elo over official
  tournaments only; `RankBy` 'rating' | 'confirmed' | 'points' (Rankings tabs, Confirmed column; Player page stat + cards).
- New-version bar: `lib/update.svelte.ts` re-fetches `index.html` (no-store) every 5 min and when the tab is shown, compares
  the `assets/index-*.js` name with the loaded one → "A newer version of the site is out. Reload" (Pages caches 10 min).
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
- Read cache (Code.gs "read cache"): `GET all` (lite and full) and `GET get` answers are kept in CacheService for 5 min
  (`cachedRead`, split into 30k-char pieces), keyed by a `data-stamp`. `putRows` / `deleteRows` / `writeTable` clears and SITE
  writes set `WROTE`; `handle` then calls `dataChanged()` (new stamp), and `onEdit` calls it for hand edits, so a change is
  never hidden. The stamp is read before the sheet. `get&since` compares against the cached answer. Tests that edit the fake
  sheet by hand must call `onEdit` (like the real sheet does).
- Link previews: static Open Graph tags in `index.html` + `public/og-card.png` (1200×630, drawn on a canvas in the site's
  look). The image URL is absolute (the live Pages URL). CI runs `npm run typecheck` too.
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

### Import from Challonge

- Browsers can't call Challonge's API (no CORS), so Code.gs `challonge` action (before the lock, reads no sheet) fetches
  `api.challonge.com/v1/tournaments/<id>.json?include_participants=1&include_matches=1&api_key=…` with the organizer's own
  key; the key is passed through only (never stored/logged). `challongeId` accepts plain ids, localized paths and
  `org.challonge.com/x` (→ `org-x`). Fake Google answers via `onFetch`; `sheet:fake` serves a demo 8-player bracket
  (key `bad-key-0000` → 401, link `/missing` → 404).
- `lib/challonge.ts` `fromChallonge(t, known)`: entrants by Challonge seed (duplicate names get " (2)"; known names reuse ids),
  format map (single/double elim, round robin incl. double round, Swiss; others = players only + note). Elim/RR results
  by replaying `resolve()` and taking the next unused Challonge match between the same two players (id order); Swiss keeps
  Challonge's pairings as frozen `swissPairings` (results `S{r}-{i}` in Challonge order). Unplaceable matches → `skipped`.
  Scores: one set = the score, several sets = sets won. `components/ChallongeImport.svelte` on the Create page (sheets mode).

### Venue features (join codes, waitlist, check-in, drop-outs, confirmations)

- Old-script compatibility: `SheetsStore.call` turns "Unknown action" into `UPDATE_SCRIPT` ("The site owner needs to update
  the Google script for this."). `scriptOutdated(doc)` = sheets mode and no `doc.code` (the new script always returns one).
- Join code: `Tournaments.code`, 6 chars from `CODE_CHARS` (no 0/O/1/I), made by Code.gs on first save, or by `ensureCodes`
  on any GET for older rows. Public lookup `GET action=code&code=…`. LocalStore makes codes too. Poster: `#/t/<id>/poster`
  (`routes/Poster.svelte`, QR drawn by `components/QrCode.svelte` with `qrcode-generator`, always black on white).
- Phone sign-up page `#/j/<id>` (`routes/Join.svelte`): the poster QR, the home page's code box and the share panel all point
  here. Before the first result it lists "Who's in" (own name in accent, "here" after check-in, waitlist names). Name → Join, then PIN / waitlist place, "I'm here", next match and scores to confirm (links to
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
  players get their old PIN back if they're added again (organizer save or their own sign-up): `Tournaments.removedPins`
  (hidden JSON {playerId: pin}, never in responses, not valid while they're out).
- Drop-outs: `options.dropped` (seeds). `resolve()` turns any unplayed match with a dropped player into a walkover
  (`status:'bye'`, `walkover:true`, real `loser`); swiss pairs only active players in unstarted rounds. Points tables
  count walkovers as a win/loss (byes exclude them); `swissRecord` gives the winner a point but no bye. A walkover GF
  needs no reset. `restructure` carries drops by player and leaves them out while re-placing results.
  `lockSwissRounds`: if a round someone reported into (not frozen yet) clashes with the pairing without dropped
  players, it freezes the pairing with everyone instead. Players drop with Code.gs `drop` (needs a result to exist;
  logged with `restore`); organizers via Edit tab → Drop-outs. `report` refuses matches with a dropped player.
- Discord: organizer pastes a channel webhook in the Share panel → Code.gs `discord` action (validates the link, posts a
  "Connected" test, stores it in hidden `Tournaments.discordWebhook`; GET only says `discord: true`). Code.gs has no engine, so
  the app writes the lines (`lib/announce.ts` `announcements(prev, next, link)`: started, newly settled results with round,
  finals, champion; header + link) and sends them as `announce` with `save` (via the save queue's meta) and with a
  successful `confirm`; Code.gs `announce()` posts them with `allowed_mentions: {parse: []}` and never fails the save.
  Fake Google has a recording `UrlFetchApp` (`g.fetched`, `g.onFetch`); `sheet:fake` shows it at GET /fetched.
- Confirmations: `MatchResult.status` ('reported' | 'confirmed' | 'disputed') + `reportedBy` (Results columns).
  `report` sets 'reported'; `confirm` (opponent's PIN, `ok`) sets confirmed/disputed with a before/after log entry.
  Anything the organizer saves through `applyEdit` has no status (= confirmed). The engine ignores these fields.

## Next up (agreed roadmap)

Everything agreed is done. Ask the owner what's next.

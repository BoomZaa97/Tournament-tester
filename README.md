# Project: Tournament Tester

**Live site:** https://boomzaa97.github.io/Tournament-tester/

Free tournament brackets for any game, where any result can be edited later without breaking the bracket. Every match is kept in a history, so each player gets a profile with their record and head-to-head results.

- **Formats:** single elimination (optional 3rd place match), double elimination (optional grand final reset), round robin (once or twice, with custom points and tiebreakers), Swiss (pairs players on the same score, no rematches, byes handled), groups (round-robin groups like the World Cup)
- **Qualify for the finals:** after Swiss, round robin or groups, the top players (in total or per group) go on to a single or double elimination final. The site suggests who qualified and flags ties at the cut line; the organizer confirms or swaps players, then starts the finals.
- **Bracket maker:** type or paste names, drag seeds around with the arrows or shuffle them, and watch the bracket draw itself live
- **Edit anything, anytime:**
  - Change an old result and every later match updates. Matches that were already played get flagged so you can choose to reset (replay) or keep the score.
  - Add a late entrant, remove someone, put in a sub, reseed, or change the format partway through.
  - Every change goes in the log and can be undone.
- **Run it together, like Challonge:** anyone can create a tournament and becomes its organizer. Send helpers a link to run it with you, let players sign themselves up, and let them report their own scores with a PIN. No accounts.
- **At the venue:**
  - **Join code + door poster:** every tournament has a short code (like `K7QM2X`). People type it in "Join with code" on the home page, or scan the QR code on the printable door poster (Edit tab → Door poster).
  - **Player limit + waitlist:** set the most players; later sign-ups go on a waitlist (with their PIN) and the organizer moves them up in order.
  - **Check-in:** players tap "I'm here" with their PIN; the organizer sees who came and removes the no-shows in one click.
  - **Drop out:** a player (with their PIN) or the organizer can drop someone mid-event. They keep their results; their remaining matches are walkovers.
  - **Confirm scores:** after a player reports a score, their opponent confirms or disputes it. Disputes are flagged for the organizer.
- **Match history:** player pages show W–L record, win rate, titles, head-to-head, and every match across all tournaments
- **Works on phones:** big buttons for entering scores, and it can be added to your home screen
- **Costs nothing:** a static site on GitHub Pages plus a Google Sheet you own. No server to run.

## Run it locally

```bash
npm install
npm run dev
```

## Share it with people

1. Push to GitHub. In the repo, go to **Settings → Pages → Source: GitHub Actions**. Every push to `main` then deploys automatically.
2. Connect a Google Sheet so other people can see your tournaments: [docs/google-sheets-setup.md](docs/google-sheets-setup.md)

Without a sheet, everything is saved only in your browser.

## How it works

| Folder | What |
|---|---|
| `src/core/` | The bracket engine. Plain TypeScript, no UI, fully tested. |
| `src/app/` | The website (Svelte). |
| `apps-script/Code.gs` | The Google Sheets backend. You paste it into your sheet. |
| `test/` | Tests: engine, editing rules, Sheets backend. |

The design rule is that only the **match results** are stored. The bracket itself, meaning who plays whom in each match, is always worked out again from those results (`resolve()` in `src/core/resolve.ts`). That's why an old result can be corrected safely.

```bash
npm test          # run tests
npm run typecheck # check types
npm run build     # build the site into dist/
```

## Roadmap

- [x] Bracket engine + editing rules
- [x] Web app: bracket maker, score entry, change log and undo, player history, Google Sheets
- [x] Swiss format
- [x] Group stage / Swiss / round robin → finals (top cut)
- [x] Organizers, helpers, player sign-up, players report their own scores (PIN)
- [x] Join codes and QR door poster, player limit and waitlist, check-in, drop-outs, score confirmation
- [ ] Rate-limit PIN guesses
- [ ] Discord announcements
- [ ] Import from Challonge

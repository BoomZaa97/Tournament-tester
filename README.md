# Project: Tournament Tester

**Live site:** https://boomzaa97.github.io/Tournament-tester/

Free tournament brackets for any game, where any result can be edited later without breaking the bracket. Every match is kept in a history, so each player gets a profile with their record and head-to-head results.

- **Formats:** single elimination (optional 3rd place match), double elimination (optional grand final reset), round robin (once or twice, with custom points and tiebreakers)
- **Bracket maker:** type or paste names, drag seeds around with the arrows or shuffle them, and watch the bracket draw itself live
- **Edit anything, anytime:**
  - Change an old result and every later match updates. Matches that were already played get flagged so you can choose to reset (replay) or keep the score.
  - Add a late entrant, remove someone, put in a sub, reseed, or change the format partway through.
  - Every change goes in the log and can be undone.
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
- [ ] Swiss format, group stage → playoffs
- [ ] Players report their own scores, Discord announcements
- [ ] Import from Challonge

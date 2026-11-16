# Tournament Manager

Free, low-maintenance tournament brackets for any game, with results you can edit at any time and a full match history.

## How it works

- **Static site** (GitHub Pages): all bracket logic runs in the browser.
- **Google Sheet + Apps Script**: stores the data. It's free, it sits in your own Drive, and you can fix any cell by hand.

## Status

- [x] Phase 1: bracket engine (`src/core`)
  - Single elimination (byes, optional 3rd place match)
  - Double elimination (grand final with optional reset)
  - Round robin (single or double, configurable points and tiebreakers)
  - Edit any result: downstream matches update, already played ones are flagged as conflicts (reset / keep), with undo
  - Edit the tournament itself mid-event: late entrants, removals, reseeding, option or format changes, sub replacements
- [ ] Phase 2: app UI + Google Sheets storage
- [ ] Phase 3: Swiss, groups -> playoffs
- [ ] Phase 4: player profiles, head-to-head, stats

## Design rule

Only the **bracket structure** and the **match results** are stored. Who plays in each match is always
recalculated from those (`resolve()`), so an old result can be corrected without breaking the bracket.

```bash
npm install
npm test
```

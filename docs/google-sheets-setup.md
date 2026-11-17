# Connect a Google Sheet (about 5 minutes, free)

This lets other people see, run and join tournaments, and keeps all data in a Google Sheet that you own.

## Who can do what

| Who | How | Can |
|---|---|---|
| You (site admin) | Your **admin key**, entered in the site's Settings | Everything, on every tournament. Rename players, delete spam. |
| Organizer | Whoever creates a tournament. Their browser gets a secret organizer key for it automatically | Edit or delete **that** tournament, open sign-up, set a player limit, move people up from the waitlist, run check-in, drop players, settle disputed scores, see its player PINs |
| Helper | Opens the organizer's **helper link** (Edit tab → Players and helpers) | Same as the organizer, for that tournament |
| Player | Signs up on the tournament page (if sign-up is open) and gets a **6-digit PIN**, or gets it from the organizer | Report the score of their own unplayed match; confirm or dispute a score their opponent reported; check in ("I'm here") before the start; drop out once it has started. Fixing a result stays with the organizer. |
| Account holder | Makes a username + password on the site's **Log in** page (optional) | The same as above, on any device: logging in brings their PINs and the organizer keys of tournaments they made. Join a tournament with one tap. Change their own display name. |
| Everyone else | The site link | View |

Accounts are optional: without one, keys and PINs are remembered by each browser. The sheet only stores a hash of each
organizer key, so the sheet itself doesn't give it away. PINs are stored in the `Entrants` tab (`pin` column) and never
sent to viewers. To stop anyone guessing them, a tournament refuses every PIN for 10 minutes after 10 wrong ones, and for
6 hours after 40 wrong ones (the organizer can still enter scores and check people in meanwhile). Passwords are never stored: the `Accounts` tab keeps a salted hash made with a secret
(`ACCOUNT_SECRET` script property, created by the script the first time someone makes an account; don't share it or change
it, or every password stops working).

## 1. Make the sheet

1. Go to [sheets.new](https://sheets.new) and name it something like `Tournament Tester data`.
2. Leave it empty. The script creates the tabs (`Players`, `Tournaments`, `Entrants`, `Results`, `Log`, `Waitlist`, `Accounts`) on first save.

## 2. Add the script

1. In the sheet: **Extensions → Apps Script**.
2. Delete everything in `Code.gs` and paste in the whole of [`apps-script/Code.gs`](../apps-script/Code.gs) from this project.
3. Click the save icon.

## 3. Set your admin key

1. In Apps Script, click **Project Settings** (the gear icon on the left).
2. Scroll to **Script properties → Add script property**.
3. Property: `ADMIN_KEY`. Value: a long password only you (and helpers) will know, for example `tiger-maple-4471-cloud`.
4. Click **Save script properties**.

## 4. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**, then **Authorize access** and allow it.
   (Google warns "Google hasn't verified this app". That's expected for your own script: click **Advanced → Go to … (unsafe)**.)
5. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`.

## 5. Connect the site

**On your own device (site admin):** open the site, go to **Settings**, choose **Google Sheet**, paste the URL and your admin key, click **Test and save**.

**For everyone else (to view):** put the URL (not the key!) in `public/config.json` and push:

```json
{
  "sheetsUrl": "https://script.google.com/macros/s/AKfy…/exec"
}
```

Now anyone who opens your site sees the tournaments from the sheet and can create their own.

If you already made tournaments in your browser before connecting, use **Settings → Copy this browser's tournaments to the sheet**.

## Updating the script later

If `Code.gs` changes: paste the new version, then **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**.
The URL stays the same. New columns are added to the tabs by themselves on the next save:

| Tab | Column | What |
|---|---|---|
| Tournaments | `code` | Join code (6 letters/digits, unique). Older tournaments get one the first time they're opened. |
| Tournaments | `maxPlayers` | Player limit for self sign-up (empty = none) |
| Tournaments | `checkIn` | `yes` = check-in is on |
| Entrants | `checkedIn` | When the player tapped "I'm here" (empty = not yet) |
| Results | `status`, `reportedBy` | For scores players reported: `reported` → `confirmed` or `disputed`; empty = entered by the organizer |
| Waitlist (new tab) | `playerId`, `name`, `pin`, `at`, `checkedIn` | People waiting for a spot, oldest first. Not in the bracket. |
| Accounts (new tab) | `username`, `playerId`, `passHash`, `salt`, `orgKeys`, `fails`, `lockedUntil` | Player accounts. `orgKeys` holds the organizer keys of the account's tournaments. Delete a row to delete an account (the player and their results stay). |
| Entrants, Results, Log, Waitlist | `tournament` | The tournament's name, next to its id, so you can tell the rows apart. |
| Tournaments | `category` | Optional division inside the game (Open, U18, Doubles…). Rankings can be split by it. |
| Tournaments | `tier` | Event size: `major`, `semi` or `small` (empty = small). Majors give double ranking points, semi-majors 1.5×. |
| Profiles (new tab) | `id`, `name`, `photo`, `bio`, `links`, `updatedAt` | A player's photo (a small picture stored as text), bio and up to 3 links. `id` is the player's id. Delete a row to clear a profile. |

Players who dropped out are in the Tournaments `options` column (`"dropped": [seed, …]`).

Until the new script is deployed, the site still works: join codes, the player limit, check-in, drop-outs and score
confirmation just show "The site owner needs to update the Google script for this".

## How the sheet stays readable with many tournaments

- Every tab is in the same order: **newest tournament at the top**. In the Entrants, Results, Log and Waitlist tabs each
  tournament's rows sit together in one block, with its name in the `tournament` column. Inside a block: entrants by
  seed, results and log in the order they happened.
- A save only rewrites that tournament's block. Other rows stay where they are, so you can keep a tab open on one
  tournament while people play another.
- The first time the new script runs, it sorts the existing rows into these blocks once (nothing is lost; the
  `LAYOUT` script property records that it's done).
- To look at one tournament only: select the `tournament` column → **Data → Create a filter**, or just use Ctrl+F.
- Open pages ask the sheet "anything new since …?" every 20 seconds, which costs almost nothing, and only load a
  tournament again when it changed. Lists (Tournaments, Players) leave out the logs, the biggest part of the sheet.

## Fixing things by hand

You can edit the sheet directly. Editing a row marks its tournament as changed (the script's `onEdit`), so pages that
have it open show your fix within about 20 seconds.

- **Results** tab: change `winner` to `p1`, `p2`, `draw`, or just type the winner's name. Change `score1` and `score2` as needed.
  Delete a row to un-play a match.
- **Players** tab: rename a player (or use Rename on their page in the app).
- Keep the `tournamentId` column as it is: it's how rows find their tournament. If you move rows around, the next save
  of that tournament puts them back together.
- **Forgotten password:** open the player's page with your admin key and tap **Reset password**; give them the new one.
  5 wrong passwords in a row lock an account for 10 minutes.

If a manual edit makes later matches wrong, the app marks them **Check** and lets you fix them.

## Limits and trade-offs

- Anyone can create a tournament on your site. Delete spam with your admin key (tournament → Edit → Delete).
- Losing a browser's organizer key: open a helper link you sent someone, or edit it with the admin key.
- PIN guesses aren't rate-limited (a guess takes a second or two, and there are a million PINs).


Google's free limits are far more than a tournament needs (about 20,000 requests a day).
Each save takes 1–2 seconds and doesn't get slower as tournaments pile up. Viewers' pages refresh every 20 seconds.
A Google Sheet holds 10 million cells: thousands of tournaments. If it ever gets slow, download a backup
(Settings → Download backup), then delete old tournaments on the site.

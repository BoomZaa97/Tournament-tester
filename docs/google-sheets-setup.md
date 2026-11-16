# Connect a Google Sheet (about 5 minutes, free)

This lets other people see your brackets, and keeps all data in a Google Sheet that you own.
Anyone with your site link can **view**. Only people with your **admin key** can **edit**.

## 1. Make the sheet

1. Go to [sheets.new](https://sheets.new) and name it something like `Tournament Tester data`.
2. Leave it empty. The script creates the tabs (`Players`, `Tournaments`, `Entrants`, `Results`, `Log`) on first save.

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

**On your own device (to edit):** open the site, go to **Settings**, choose **Google Sheet**, paste the URL and your admin key, click **Test connection**, then **Save settings**.

**For everyone else (to view):** put the URL (not the key!) in `public/config.json` and push:

```json
{
  "sheetsUrl": "https://script.google.com/macros/s/AKfy…/exec"
}
```

Now anyone who opens your site sees the brackets from the sheet, read-only.

If you already made tournaments in your browser before connecting, use **Settings → Copy this browser's tournaments to the sheet**.

## Updating the script later

If `Code.gs` changes: paste the new version, then **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**.
The URL stays the same.

## Fixing things by hand

You can edit the sheet directly:

- **Results** tab: change `winner` to `p1`, `p2`, `draw`, or just type the winner's name. Change `score1` and `score2` as needed.
  Delete a row to un-play a match.
- **Players** tab: rename a player (or use Rename on their page in the app).

If a manual edit makes later matches wrong, the app marks them **Check** and lets you fix them.

## Limits

Google's free limits are far more than a tournament needs (about 20,000 requests a day).
Each save takes 1–2 seconds. Viewers' pages refresh every 20 seconds.

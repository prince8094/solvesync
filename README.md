# SolveSync 🚀
**Solve once. Track everywhere.**

A Chrome extension that logs every coding problem you solve — on any platform — to **your own Google Sheet**.
No server, no Apps Script to deploy: users just **sign in with Google** and **paste a sheet link (or its ID)**.

## Your sheet

One tab, **DSA Tracker**, seven columns:

| Date | Platform | Problem | Link | Topics | Approach | Difficulty |
|---|---|---|---|---|---|---|
| 2026-10-11 | LeetCode | 1. Two Sum | https://leetcode.com/problems/two-sum/ | Array, Hash Table | HashMap of seen values | Easy |

Each problem is added **once** (matched by its link), so solving it again never creates a duplicate row.

## Platforms

| Platform | How it's captured | Status |
|---|---|---|
| **LeetCode** | Automatic, plus a **Sync to Sheet** button on every submission page | ✅ main target |
| **Codeforces** | Automatic when you watch a submission turn Accepted; rating + tags looked up from the Codeforces API | 🧪 experimental |
| **AtCoder** | Automatic on *My submissions*; button on a submission's page; difficulty estimate from AtCoder Problems | 🧪 experimental |
| **HackerRank** | Automatic via its submission API; **Sync to Sheet** button on challenge pages | 🧪 experimental |
| **GeeksforGeeks** | Detects the "Problem Solved Successfully" message; **Sync to Sheet** button on problem pages | 🧪 experimental |
| **HackerEarth, CodeChef, anything else** | Click the SolveSync icon → **＋ Add current problem** (pre-filled from the page) | ✅ works everywhere |

"Experimental" means these sites change their pages without notice and I could only test the logic against
simulated pages, not the live sites. The **Sync to Sheet** button and **Add current problem** form are the safety net.

## Using it (end users)

1. Install the extension (a settings page opens).
2. **Sign in with Google.**
3. Paste your Google Sheets link (or just the spreadsheet ID, the long string after `/d/` in the address) and click **Connect sheet** — or click **Create a new sheet for me**. The Google account you signed in with must have edit access to that sheet.

That's all. Solve a problem; a small toast appears ("✅ Two Sum recorded") with an optional **Approach** box.
The popup shows today / this month / streak / total, the last 7 days, difficulty, platforms and top topics.
If you're offline or signed out, problems are queued and sent automatically later.

### Upgrading from the Apps Script version (v1.x)

Nothing to migrate by hand. On update SolveSync deletes the old Apps Script URL and secret token from storage,
keeps any problems still waiting in the retry queue, and opens Settings so you can sign in with Google and pick a sheet.
You can delete the old Apps Script deployment and its `Code.gs`. Your old sheet data stays as it is; the new
**DSA Tracker** tab is added next to it (the old `SolveSync` tab is not read or changed).

## Setting it up (developer — one time)

Google requires the app owner to register an OAuth client. Follow **[docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md)** (≈10 min):
create a Cloud project → enable the Sheets API → consent screen → OAuth client of type *Chrome Extension*
with item ID `piciopmfaoeheehnlnoomkgfdbcgoijb` → paste the client ID into `extension/manifest.json`.

Then: `chrome://extensions` → Developer mode → **Load unpacked** → choose the `extension/` folder.

## How it works

```
Judge website ─► adapter (content script) ─► background worker ─► Google Sheets API
 LeetCode          detects "accepted",         dedupe · history ·    append row to
 AtCoder, ...      reads title/difficulty      retry queue           "DSA Tracker"
```

- `content/net-core.js` watches the page's own network responses (read-only) for sites with a submission API.
- Adapters turn each site's result into the same record: `{platform, problem, url, difficulty, topics, ...}`.
- `background/sheets.js` is the Sheets client (uses the signed-in user's token via `chrome.identity`).
- `background/service-worker.js` dedupes, keeps local stats, and retries failures every minute.

### Adding a platform
1. Create `content/<site>.js`, build a record and call `window.SolveSync.report(record)`
   (add `{manual:true}` as second argument for button clicks; `SolveSync.floatingButton()` gives you the button).
2. Add a `content_scripts` entry in `manifest.json` (load `common.js` first).
3. Dedupe, sheet writing, retries, toast and stats are shared.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing happens on a judge | Reload the tab after installing/updating the extension (Chrome doesn't inject into already-open tabs). Check DevTools → Console, filter `SolveSync`. |
| "Sign-in" errors | See the table in [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md#troubleshooting). |
| "No edit access to this sheet" | The Google account you signed in with can't edit that sheet — share it with them as Editor. |
| Popup says "Sync issue" | Hover the message; fix it (usually sign in again), then press ↻ — queued problems are sent automatically. |
| Stats look empty after reinstalling | Press ↻ in the popup to rebuild them from your sheet. |
| Deleted the `DSA Tracker` tab | It's recreated on the next problem. |

## Roadmap

- [x] Phase 1 — LeetCode → Google Sheets
- [x] Phase 2 — more platforms: Codeforces, AtCoder, HackerRank, GeeksforGeeks; manual add for everything else
- [x] Phase 3 — approach note, topics, difficulty
- [x] Phase 4 — dashboard: today / month / streak, last 7 days, difficulty-, platform- and topic-wise
- [x] Zero-setup onboarding: Google sign-in + paste a sheet link (or auto-create one)
- [ ] Time / space complexity column
- [ ] Automatic HackerEarth, CodeChef, Coding Ninjas (Code360), InterviewBit adapters
- [ ] Full-page dashboard with weak-topic detection ("lots of arrays, no graphs")
- [ ] AI: generate approach + complexity from your submitted code
- [ ] Google OAuth verification (public release without the "unverified app" screen)
- [ ] Firefox / Edge support

## Project layout

```
solvesync/
├── docs/
│   ├── GOOGLE_SETUP.md       one-time Google Cloud setup + publishing notes
│   └── PRIVACY.md            privacy policy template
└── extension/
    ├── manifest.json         Manifest V3 (OAuth client ID goes here)
    ├── background/           service-worker.js · sheets.js
    ├── content/              net-core, common, leetcode(+hook), codeforces, atcoder, hackerrank(+hook), gfg
    ├── popup/                dashboard + "Add current problem"
    ├── options/              sign-in, sheet connection, preferences
    └── icons/
```

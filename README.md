# LeetCommit

Chrome extension (Manifest V3). Detects an **Accepted** submission on
leetcode.com, shows an in-page modal to add notes, and pushes the solution
+ notes to a GitHub repo via the Contents API.

Scoped to **LeetCode only** for v1 (NeetCode dropped for now — see TODO).

## Decisions baked into this build

- **Notes**: separate `notes.md` per problem folder (not a comment header in
  the code file). Newest entry is inserted right under the `# Problem Title`
  header, so the file reads newest-first.
- **Resubmission**: versioned, not overwritten. Each push writes
  `{language}_v{N}.{ext}`, so `python_v1.py`, `python_v2.py`, etc. all stay
  in git history as separate files, not just separate commits.
- **Multi-language**: same folder per problem
  (`easy/two-sum/python_v1.py`, `easy/two-sum/java_v1.java`, ...), versioned
  independently per language.
- **Repo path convention**: `{difficulty}/{slug}/{language}_v{N}.{ext}`,
  editable per-push in the modal before you hit Push.
- **Closed-without-pushing**: the extension does *not* nag you. If you hit
  Submit, get Accepted, and close the modal (or just don't push), the
  detected submission is kept in `chrome.storage.session` and surfaced the
  next time you open the toolbar popup, with a one-click "Push now". No
  repeated prompts, no re-injection into the page.

## How detection actually works

LeetCode's result banner is rendered client-side by React with
non-stable/hashed class names, so DOM text-scraping for "Accepted" is
fragile. Instead, `inject.js` runs in the page's **MAIN world** (declared via
`"world": "MAIN"` in `manifest.json`, Chrome 111+) and patches `fetch` /
`XMLHttpRequest` to watch two real network calls LeetCode's own client makes:

1. `POST /problems/{slug}/submit/` — the request body has your submitted
   `typed_code` and `lang`, and the response has a `submission_id`. This is
   where the code comes from — not scraped from the Monaco editor DOM.
2. `GET /submissions/detail/{id}/check/` — LeetCode polls this until
   `state === "SUCCESS"`. When it resolves with `status_code === 10`
   (Accepted), `inject.js` dispatches a `leetcommit:accepted` CustomEvent on
   `window`, which `content_script.js` (isolated world) picks up — event
   dispatch on the shared DOM is the standard bridge between MAIN and
   ISOLATED worlds in a MV3 extension.

This means Wrong Answer / Runtime Error / TLE submissions never fire
anything, and the code we push is exactly what LeetCode's judge ran, not a
DOM re-read that could race the editor.

Problem **title** and **difficulty** are still read from the DOM (there's no
clean API for those without extra endpoints), with a text-content fallback
scan (`getDifficulty()` in `content_script.js`) rather than a brittle
hashed-class selector — if it ever returns "unknown", the repo path just
falls back to an `unknown/` folder that you can edit before pushing.

## Files

```
LeetCommit/
  manifest.json
  inject.js            # MAIN world: network interception
  content_script.js    # ISOLATED world: modal UI, DOM title/difficulty
  background.js        # service worker: all GitHub API calls
  options.html/.js      # PAT, owner, repo, branch
  popup.html/.js        # connection status + "pending submission" recovery
```

No build step — it's plain JS, loadable as an unpacked extension as-is.

## Setup

1. **Create (or pick) a GitHub repo** to hold solutions, e.g.
   `leetcode-solutions`.
2. **Create a token**: https://github.com/settings/tokens?type=beta →
   fine-grained PAT, scoped to only that repo, with **Contents: Read and
   write** permission. (Skip OAuth device flow — massive overkill for a
   single-user tool pushing to one repo you already own.)
3. **Load the extension**:
   - Chrome → `chrome://extensions`
   - Enable "Developer mode" (top right)
   - "Load unpacked" → select the `LeetCommit` folder
4. **Configure it**: click the LeetCommit toolbar icon → "Open settings" (or
   right-click the icon → Options). Enter the PAT, owner, repo, branch
   (defaults to `main`). Click **Test connection** — it should say
   `Connected to {owner}/{repo}` and confirm push access.

## Testing it end to end

1. Go to any easy LeetCode problem, e.g.
   `https://leetcode.com/problems/two-sum/`.
2. Open DevTools console on that tab — you should NOT see any errors from
   `inject.js` or `content_script.js` on page load. (LeetCode requires
   login to submit, make sure you're signed in.)
3. Write a correct solution, hit **Submit**, wait for LeetCode's own
   "Accepted" banner to render.
4. The LeetCommit modal should appear on top of the page within a second or
   two of the Accepted result. If it doesn't:
   - Check the console for a `leetcommit:accepted` — you can verify the
     event fired by running `window.addEventListener('leetcommit:accepted', e => console.log(e.detail))`
     in the console *before* submitting.
   - Check `chrome://extensions` → LeetCommit → "service worker" link →
     inspect it → console, for any errors from `background.js`.
5. Fill in notes / complexity, confirm the repo path field looks right
   (`easy/two-sum` for that example), click **Push to GitHub**.
6. Check your repo — you should see
   `easy/two-sum/{language}_v1.{ext}` and `easy/two-sum/notes.md`.
7. **Test the negative case**: submit an intentionally wrong solution
   (e.g. `return []`) and confirm no modal appears — this is the "not a
   runtime/wrong-answer result" requirement.
8. **Test resubmission**: submit the same problem Accepted again. Confirm
   it writes `{language}_v2.{ext}` (not overwriting v1) and prepends a new
   dated section to `notes.md`.
9. **Test multi-language**: solve the same problem in a second language,
   confirm it lands in the same `easy/two-sum/` folder as
   `{other-language}_v1.{ext}`.
10. **Test the skip/recovery path**: get an Accepted result, click **Skip**
    instead of Push, then open the toolbar popup — it should show the
    problem under "pending submission" with a **Push now** button. (Popup
    pushes default to an `misc/` folder since difficulty isn't
    re-derived there — edit the path afterward on GitHub if you want it
    elsewhere.)

## Known caveats

- **DOM selectors will eventually break.** `getProblemTitle()` and
  `getDifficulty()` in `content_script.js` depend on LeetCode's current
  markup/text content. If LeetCode redesigns the problem page, these are the
  first things to fix — inspect the title/difficulty badge elements and
  update the selectors. The network-interception detection logic in
  `inject.js` is more durable since it depends on LeetCode's internal REST
  API shape, but that too could change.
- **Fine-grained PAT expiration**: GitHub fine-grained tokens expire (max 1
  year); you'll need to regenerate and re-paste into Options when that
  happens — Test connection will start failing with a 401.
- **`total_correct`/`total_testcases` are best-effort display only** — not
  used for the Accepted decision itself (that's `status_code === 10`).

## TODO / not built yet

- NeetCode support (`neetcode.io`) — deferred per scope decision. NeetCode's
  actual code-run/submit flow needs to be reverse-engineered separately;
  it does not obviously proxy through LeetCode's API for all problems.
- Icons — none included; Chrome will show a default placeholder in the
  toolbar. Drop `icon16.png` / `icon48.png` / `icon128.png` into `icons/`
  and reference them in `manifest.json`'s `action.default_icon` /
  top-level `icons` if you want a custom one.

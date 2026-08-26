# LeetCommit

Chrome extension that pushes **Accepted** LeetCode solutions to your GitHub repo — with notes, complexity, and versioned files.

## What it does

On an Accepted submission, LeetCommit opens a modal so you can add notes and Big-O, then commits to a repo you choose:

```
{difficulty}/{number}-{slug}/{language}_v{N}.{ext}
easy/1-two-sum/python_v1.py
easy/1-two-sum/notes.md
```

Resubmits write `v2`, `v3`, … instead of overwriting. Same problem in another language lands in the same folder. If you skip a push, the popup keeps it as a pending submission until you push or discard.

## How it works

1. Connect GitHub (device flow) and install the GitHub App on one repo.
2. On `leetcode.com`, a MAIN-world script watches LeetCode’s submit/check network calls.
3. Only `status_code === 10` (Accepted) triggers the modal — wrong answers never fire.
4. The service worker commits the exact code LeetCode judged, plus `notes.md`, via the GitHub Contents API.

## Tech stack

- **Chrome Extension Manifest V3** — plain JS, no build step
- **Content scripts** — MAIN world (`inject.js`) + isolated world (`content_script.js`)
- **Service worker** — GitHub API (`background.js`)
- **GitHub App** — Device Flow auth, Contents read/write on the repo you grant

## Install

**[Chrome Web Store](https://chromewebstore.google.com/detail/leetcommit/cebogobinibhehlhjhkfbfphlmhokgco)** — install, then open the toolbar popup → Connect GitHub → Select a repository.

From source (dev):

1. Clone this repo
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select this folder
3. Open the toolbar popup → Connect GitHub → Select a repository

## Roadmap

- **NeetCode** (`neetcode.io`) — detect Accepted runs there and push the same way as LeetCode

## License

Open source. See the repository for license details.

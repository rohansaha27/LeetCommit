---
title: Privacy Policy — LeetCommit
permalink: /privacy
---

# Privacy Policy — LeetCommit

**Effective: August 13, 2026**

LeetCommit is a Chrome extension that detects when you get an **Accepted**
result on leetcode.com and pushes that solution — plus any notes you add —
to a GitHub repository you choose. This page explains exactly what data it
handles, where it goes, and how to remove it.

## The short version

LeetCommit has no backend server. There is no LeetCommit-operated database,
analytics service, or company that receives your data. Everything the
extension stores lives in your own browser, and the only place it ever
sends your code or GitHub token is directly to GitHub's own API, from your
own browser, using credentials only you control.

## Data LeetCommit collects, and why

### GitHub account data
When you connect your GitHub account (via GitHub's OAuth Device Flow), the
extension stores the following in your browser's local extension storage
(`chrome.storage.local`):

- Your GitHub access token
- Your GitHub username and avatar URL
- The GitHub App installation ID, and the owner/repo/branch you selected as
  the push destination

This data is used solely to authenticate requests to GitHub's API on your
behalf and to remember which repository and branch you've chosen. The
GitHub App LeetCommit uses only ever requests **"Contents: Read and
write"** access, and only on the specific repository (or repositories) you
explicitly grant it — it cannot see or modify anything else in your GitHub
account.

### LeetCode submission data
When you submit a solution on leetcode.com and it's marked Accepted,
LeetCommit reads the following directly from the page and from LeetCode's
own network responses (never scraped from unrelated pages or your browsing
history):

- The problem's title, URL slug, and difficulty
- Your submitted code and the language you wrote it in
- The runtime/memory statistics LeetCode itself measured for that
  submission
- Any notes, time complexity, or space complexity you choose to type into
  the extension's popup before pushing

If you don't push right away (e.g. you close the notes prompt), this
information is held temporarily in your browser's session storage
(`chrome.storage.session`) so you can push it later from the toolbar
popup. Session storage is automatically cleared when you close your
browser, and is cleared immediately by the extension once you push or
discard it.

Wrong Answer, Runtime Error, and other non-Accepted results are never read
or transmitted — the extension only activates on a confirmed Accepted
result.

## Where your data goes

- **GitHub (`api.github.com`, `github.com`)** — your code, notes, and
  GitHub token are sent only to GitHub's own servers, to authenticate you
  and to create/update files in the repository you selected. This is
  subject to [GitHub's own Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement).
- **Google Fonts (`fonts.googleapis.com`)** — the extension's popup loads
  one webfont stylesheet for its UI. This is a normal font request and
  never includes your code, token, or any personal data.

LeetCommit does not send your data anywhere else. It does not use
analytics, ad networks, or any third-party tracking service, and it does
not sell or share your data with anyone.

## Data retention and removal

Your GitHub token and connection settings remain in `chrome.storage.local`
until you either:

- Click **Logout** / **Disconnect** in the extension popup, which removes
  all stored account and repository data immediately, or
- Uninstall the extension, which removes all of its local storage
  automatically as part of Chrome's standard extension removal.

You can also revoke LeetCommit's access at any time directly from GitHub,
under **Settings → Applications → Authorized GitHub Apps** on
github.com, independent of the extension itself.

## Children's privacy

LeetCommit is not directed at children and does not knowingly collect data
from children under 13.

## Changes to this policy

If this policy changes, the updated version will be posted here with a
new effective date at the top.

## Contact

Questions or concerns: open an issue at
[github.com/rohansaha27/LeetCommit/issues](https://github.com/rohansaha27/LeetCommit/issues).

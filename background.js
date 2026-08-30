// MV3 service worker. Owns all GitHub API calls (so the extension only
// needs api.github.com in host_permissions, not a content-script CORS
// workaround) and tracks the "pending submission" shown in the toolbar
// popup when a modal gets skipped or closed.

const GITHUB_API = "https://api.github.com";
// Must match GITHUB_CLIENT_ID in settings.js — used to refresh expired
// user-to-server tokens from the GitHub App device flow.
const GITHUB_CLIENT_ID = "Iv23li582YbbQjA4wwt5";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const AUTH_EXPIRED_MSG =
  "GitHub login expired — open the LeetCommit popup and Connect GitHub again.";
const TOKEN_REFRESH_SKEW_MS = 60_000;

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function fromBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function clearAuthTokens() {
  await chrome.storage.local.remove([
    "githubToken",
    "githubRefreshToken",
    "githubTokenExpiresAt",
  ]);
}

async function persistTokenResponse(data) {
  if (!data || typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("invalid token response");
  }
  const update = { githubToken: data.access_token };
  if (typeof data.refresh_token === "string" && data.refresh_token) {
    update.githubRefreshToken = data.refresh_token;
  }
  if (data.expires_in != null && Number.isFinite(Number(data.expires_in))) {
    update.githubTokenExpiresAt = Date.now() + Number(data.expires_in) * 1000;
  } else {
    update.githubTokenExpiresAt = null;
  }
  await chrome.storage.local.set(update);
  return data.access_token;
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") {
    throw new Error("missing refresh token");
  }
  const res = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "token refresh failed");
  }
  return persistTokenResponse(data);
}

async function ensureGithubToken() {
  const cfg = await chrome.storage.local.get([
    "githubToken",
    "githubRefreshToken",
    "githubTokenExpiresAt",
  ]);
  if (!cfg.githubToken) {
    throw new Error(
      "LeetCommit isn't configured yet — Connect GitHub in the extension popup."
    );
  }

  const expiresAt = cfg.githubTokenExpiresAt;
  const shouldRefresh =
    typeof expiresAt === "number" &&
    Date.now() >= expiresAt - TOKEN_REFRESH_SKEW_MS &&
    cfg.githubRefreshToken;

  if (shouldRefresh) {
    try {
      return await refreshAccessToken(cfg.githubRefreshToken);
    } catch (_) {
      await clearAuthTokens();
      throw new Error(AUTH_EXPIRED_MSG);
    }
  }

  return cfg.githubToken;
}

// Authenticated fetch that refreshes once on 401 when a refresh token exists.
async function githubFetch(url, options = {}) {
  let token = await ensureGithubToken();
  const buildHeaders = (t) => ({
    ...authHeaders(t),
    ...(options.headers || {}),
  });

  let res = await fetch(url, { ...options, headers: buildHeaders(token) });
  if (res.status !== 401) return res;

  const { githubRefreshToken } = await chrome.storage.local.get("githubRefreshToken");
  if (!githubRefreshToken) {
    await clearAuthTokens();
    throw new Error(AUTH_EXPIRED_MSG);
  }

  try {
    token = await refreshAccessToken(githubRefreshToken);
  } catch (_) {
    await clearAuthTokens();
    throw new Error(AUTH_EXPIRED_MSG);
  }

  res = await fetch(url, { ...options, headers: buildHeaders(token) });
  if (res.status === 401) {
    await clearAuthTokens();
    throw new Error(AUTH_EXPIRED_MSG);
  }
  return res;
}

async function getConfig() {
  const token = await ensureGithubToken();
  const cfg = await chrome.storage.local.get(["owner", "repo", "branch"]);
  if (!cfg.owner || !cfg.repo) {
    throw new Error(
      "LeetCommit isn't configured yet — Connect GitHub and select a repository in the extension popup."
    );
  }
  return { branch: "main", githubToken: token, ...cfg };
}

async function listDir(owner, repo, path, branch) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await githubFetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub error listing ${path}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function getFile(owner, repo, path, branch) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await githubFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub error reading ${path}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { sha: data.sha, content: fromBase64Utf8(data.content) };
}

async function putFile(owner, repo, path, branch, content, message, sha) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: toBase64Utf8(content),
    branch,
  };
  if (sha) body.sha = sha;
  const res = await githubFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub error writing ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Line-comment token per file extension, used to write the metadata header
// at the top of each pushed solution file.
const COMMENT_PREFIX_BY_EXT = {
  py: "#", java: "//", cpp: "//", c: "//", cs: "//", js: "//", ts: "//",
  php: "//", swift: "//", kt: "//", dart: "//", go: "//", rb: "#",
  scala: "//", rs: "//", rkt: ";;", erl: "%", ex: "#",
};

// Accepts "n^2", "n log n", or full "O(n^2)" and stores canonical O(...).
function formatBigO(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";

  const wrapped = s.match(/^O\s*\(\s*([\s\S]*?)\s*\)\s*$/i);
  if (wrapped) {
    const inner = wrapped[1].trim();
    return inner ? `O(${inner})` : "";
  }

  const bareO = s.match(/^O\s+(.+)$/i);
  if (bareO) {
    const inner = bareO[1].trim();
    return inner ? `O(${inner})` : "";
  }

  return `O(${s})`;
}

// Folder placement is always automatic — easy/medium/hard from the detected
// difficulty, "misc" only if it genuinely couldn't be determined. Re-checked
// here (not just trusted from the caller) so a stale/bad value never lands a
// solution outside the three difficulty folders.
function normalizeDifficultyFolder(difficulty) {
  const v = (difficulty || "").toLowerCase().trim();
  return v === "easy" || v === "medium" || v === "hard" ? v : "misc";
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPushedAt() {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function buildHeaderComment(ext, { difficulty, runtime, memory }) {
  const prefix = COMMENT_PREFIX_BY_EXT[ext] || "#";
  const difficultyFolder = normalizeDifficultyFolder(difficulty);
  const difficultyLabel = difficultyFolder === "misc"
    ? "Unknown"
    : difficultyFolder[0].toUpperCase() + difficultyFolder.slice(1);
  const lines = [
    `Pushed: ${formatPushedAt()}`,
    `Difficulty: ${difficultyLabel}`,
    `Runtime: ${runtime || "Not available"}`,
    `Memory: ${memory || "Not available"}`,
  ];
  return lines.map((line) => `${prefix} ${line}`).join("\n") + "\n\n";
}

async function pushSolution(payload) {
  const { owner, repo, branch } = await getConfig();
  const {
    problemTitle,
    problemUrl,
    slug,
    difficulty,
    language,
    ext,
    code,
    notes,
    timeComplexity,
    spaceComplexity,
    commitMessageOverride,
    runtime,
    memory,
  } = payload;

  const basePath = `${normalizeDifficultyFolder(difficulty)}/${slug}`;

  // Versioned filenames per language: python_v1.py, python_v2.py, ...
  const existing = await listDir(owner, repo, basePath, branch);
  const versionRe = new RegExp(`^${escapeRegExp(language)}_v(\\d+)\\.${escapeRegExp(ext)}$`, "i");
  let maxVersion = 0;
  for (const f of existing) {
    const m = f.name.match(versionRe);
    if (m) maxVersion = Math.max(maxVersion, parseInt(m[1], 10));
  }
  const nextVersion = maxVersion + 1;
  const fileName = `${language}_v${nextVersion}.${ext}`;
  const filePath = `${basePath}/${fileName}`;

  const commitMessage =
    commitMessageOverride || `Add solution: ${problemTitle} (${language}, v${nextVersion})`;

  const fileContent = buildHeaderComment(ext, { difficulty, runtime, memory }) + code;

  await putFile(owner, repo, filePath, branch, fileContent, commitMessage);

  // Append-only notes.md per problem folder.
  const notesPath = `${basePath}/notes.md`;
  const existingNotes = await getFile(owner, repo, notesPath, branch);
  const dateStr = new Date().toISOString().slice(0, 10);
  const section = [
    `## ${language} — v${nextVersion} (${dateStr})`,
    "",
    `- Problem: ${problemUrl}`,
    `- Time complexity: ${formatBigO(timeComplexity) || "_not specified_"}`,
    `- Space complexity: ${formatBigO(spaceComplexity) || "_not specified_"}`,
    `- Solution file: [\`${fileName}\`](./${fileName})`,
    "",
    notes && notes.trim() ? notes.trim() : "_No notes provided._",
    "",
    "---",
    "",
  ].join("\n");

  const newNotesContent = existingNotes
    ? insertAfterHeader(existingNotes.content, section)
    : `# ${problemTitle}\n\n${section}`;

  await putFile(
    owner,
    repo,
    notesPath,
    branch,
    newNotesContent,
    `Update notes: ${problemTitle} (v${nextVersion})`,
    existingNotes ? existingNotes.sha : undefined
  );

  return { fileName, filePath };
}

// Keeps the "# Problem Title" header at the top and inserts newest section
// right after it, so notes.md reads newest-first.
function insertAfterHeader(existingContent, newSection) {
  const headerMatch = existingContent.match(/^# .*\n\n?/);
  if (headerMatch) {
    const header = headerMatch[0];
    const rest = existingContent.slice(header.length);
    return header + newSection + rest;
  }
  return newSection + existingContent;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SUBMISSION_DETECTED") {
    chrome.storage.session.set({
      pendingSubmission: { ...message.payload, tabId: sender.tab && sender.tab.id },
    });
    return false;
  }

  if (message.type === "DISCARD_PENDING") {
    chrome.storage.session.remove("pendingSubmission");
    return false;
  }

  if (message.type === "ENSURE_GITHUB_TOKEN") {
    ensureGithubToken()
      .then((token) => sendResponse({ ok: true, token }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "PUSH_SOLUTION") {
    pushSolution(message.payload)
      .then((result) => {
        chrome.storage.session.remove("pendingSubmission");
        sendResponse({ ok: true, ...result });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    return true; // keep the message channel open for the async response
  }

  return false;
});

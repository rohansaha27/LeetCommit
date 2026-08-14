// MV3 service worker. Owns all GitHub API calls (so the extension only
// needs api.github.com in host_permissions, not a content-script CORS
// workaround) and tracks the "pending submission" shown in the toolbar
// popup when a modal gets skipped or closed.

const GITHUB_API = "https://api.github.com";

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

async function getConfig() {
  const cfg = await chrome.storage.local.get(["githubToken", "owner", "repo", "branch"]);
  if (!cfg.githubToken || !cfg.owner || !cfg.repo) {
    throw new Error("LeetCommit isn't configured yet — set your GitHub token, owner and repo in the extension's Options page.");
  }
  return { branch: "main", ...cfg };
}

async function listDir(owner, repo, path, branch, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub error listing ${path}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function getFile(owner, repo, path, branch, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub error reading ${path}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { sha: data.sha, content: fromBase64Utf8(data.content) };
}

async function putFile(owner, repo, path, branch, token, content, message, sha) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: toBase64Utf8(content),
    branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
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

// Folder placement is always automatic — easy/medium/hard from the detected
// difficulty, "misc" only if it genuinely couldn't be determined. Re-checked
// here (not just trusted from the caller) so a stale/bad value never lands a
// solution outside the three difficulty folders.
function normalizeDifficultyFolder(difficulty) {
  const v = (difficulty || "").toLowerCase().trim();
  return v === "easy" || v === "medium" || v === "hard" ? v : "misc";
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
  const { githubToken: token, owner, repo, branch } = await getConfig();
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
  const existing = await listDir(owner, repo, basePath, branch, token);
  const versionRe = new RegExp(`^${language}_v(\\d+)\\.${ext}$`, "i");
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

  await putFile(owner, repo, filePath, branch, token, fileContent, commitMessage);

  // Append-only notes.md per problem folder.
  const notesPath = `${basePath}/notes.md`;
  const existingNotes = await getFile(owner, repo, notesPath, branch, token);
  const dateStr = new Date().toISOString().slice(0, 10);
  const section = [
    `## ${language} — v${nextVersion} (${dateStr})`,
    "",
    `- Problem: ${problemUrl}`,
    `- Time complexity: ${timeComplexity || "_not specified_"}`,
    `- Space complexity: ${spaceComplexity || "_not specified_"}`,
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
    token,
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

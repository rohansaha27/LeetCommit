const tokenEl = document.getElementById("token");
const ownerEl = document.getElementById("owner");
const repoEl = document.getElementById("repo");
const branchEl = document.getElementById("branch");
const statusEl = document.getElementById("status");

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

chrome.storage.local.get(["githubToken", "owner", "repo", "branch"], (cfg) => {
  tokenEl.value = cfg.githubToken || "";
  ownerEl.value = cfg.owner || "";
  repoEl.value = cfg.repo || "";
  branchEl.value = cfg.branch || "main";
});

document.getElementById("saveBtn").addEventListener("click", () => {
  const cfg = {
    githubToken: tokenEl.value.trim(),
    owner: ownerEl.value.trim(),
    repo: repoEl.value.trim(),
    branch: branchEl.value.trim() || "main",
  };
  chrome.storage.local.set(cfg, () => {
    setStatus("Saved.", "ok");
  });
});

document.getElementById("testBtn").addEventListener("click", async () => {
  setStatus("Testing...");
  const token = tokenEl.value.trim();
  const owner = ownerEl.value.trim();
  const repo = repoEl.value.trim();
  if (!token || !owner || !repo) {
    setStatus("Fill in token, owner and repo first.", "error");
    return;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.status === 404) {
      setStatus("Repo not found, or token can't see it.", "error");
      return;
    }
    if (res.status === 401) {
      setStatus("Token rejected.", "error");
      return;
    }
    if (!res.ok) {
      setStatus(`GitHub error: ${res.status}`, "error");
      return;
    }
    const data = await res.json();
    const perms = data.permissions || {};
    if (!perms.push) {
      setStatus("Connected, but this token can't push to the repo.", "error");
      return;
    }
    setStatus(`Connected to ${data.full_name}.`, "ok");
  } catch (e) {
    setStatus("Network error: " + e.message, "error");
  }
});

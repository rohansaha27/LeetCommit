// Replace with the Client ID of a GitHub App that has "Device Flow" enabled
// and "Contents: Read and write" repository permission. No client secret is
// needed — device flow is a public-client flow. See README.md "Setup".
const GITHUB_CLIENT_ID = "Iv23li582YbbQjA4wwt5";

// The GitHub App's slug (the URL-friendly name from its "Public page" link,
// e.g. github.com/apps/<slug>) — Settings → Developer settings → GitHub Apps
// → your app → General. Used only to open the install/repo-picker screen;
// device flow itself doesn't need it.
const GITHUB_APP_SLUG = "https://github.com/apps/leetcommitv1";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

const branchEl = document.getElementById("branch");
const statusEl = document.getElementById("status");

const connectIdleEl = document.getElementById("connectIdle");
const connectActiveEl = document.getElementById("connectActive");
const connectDoneEl = document.getElementById("connectDone");
const connectBtn = document.getElementById("connectBtn");
const installBtn = document.getElementById("installBtn");
const reopenBtn = document.getElementById("reopenBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const changeRepoBtn = document.getElementById("changeRepoBtn");
const refreshBtn = document.getElementById("refreshBtn");
const userCodeEl = document.getElementById("userCode");
const deviceStatusEl = document.getElementById("deviceStatus");
const connectedNameEl = document.getElementById("connectedName");
const connectedRepoEl = document.getElementById("connectedRepo");
const repoPickerEl = document.getElementById("repoPicker");
const repoSelectEl = document.getElementById("repoSelect");

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

function apiHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

function renderConnectionState(cfg) {
  connectIdleEl.style.display = "none";
  connectActiveEl.classList.remove("active");
  connectDoneEl.style.display = "none";

  if (cfg.githubToken && cfg.owner && cfg.repo) {
    connectDoneEl.style.display = "block";
    connectedNameEl.textContent = `Connected as ${cfg.githubUser || "your GitHub account"}`;
    connectedRepoEl.innerHTML = `Pushing to <b>${cfg.owner}/${cfg.repo}</b>`;

    const repos = cfg.availableRepos || [];
    if (repos.length > 1) {
      repoPickerEl.style.display = "block";
      repoSelectEl.innerHTML = repos
        .map((r) => `<option value="${r.fullName}">${r.fullName}</option>`)
        .join("");
      repoSelectEl.value = `${cfg.owner}/${cfg.repo}`;
    } else {
      repoPickerEl.style.display = "none";
    }
  } else {
    connectIdleEl.style.display = "block";
  }
}

async function loadConfig() {
  const cfg = await chrome.storage.local.get([
    "githubToken",
    "githubUser",
    "installationId",
    "owner",
    "repo",
    "availableRepos",
    "branch",
  ]);
  branchEl.value = cfg.branch || "main";
  renderConnectionState(cfg);
  return cfg;
}

let devicePollTimer = null;
let lastVerificationUri = null;

function stopDevicePolling() {
  if (devicePollTimer) {
    clearTimeout(devicePollTimer);
    devicePollTimer = null;
  }
}

async function startDeviceFlow() {
  if (!GITHUB_CLIENT_ID || GITHUB_CLIENT_ID === "YOUR_GITHUB_APP_CLIENT_ID") {
    setStatus(
      "GitHub isn't set up yet: add a GitHub App Client ID in options.js (see README).",
      "error"
    );
    return;
  }

  setStatus("");
  stopDevicePolling();
  connectIdleEl.style.display = "none";
  connectDoneEl.style.display = "none";
  connectActiveEl.classList.add("active");
  userCodeEl.textContent = "····-····";
  deviceStatusEl.textContent = "Requesting a code from GitHub…";

  let device;
  try {
    const res = await fetch(DEVICE_CODE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID }),
    });
    if (!res.ok) throw new Error(`GitHub error: ${res.status}`);
    device = await res.json();
    if (device.error) throw new Error(device.error_description || device.error);
  } catch (e) {
    connectActiveEl.classList.remove("active");
    connectIdleEl.style.display = "block";
    setStatus("Couldn't start GitHub authorization: " + e.message, "error");
    return;
  }

  userCodeEl.textContent = device.user_code;
  lastVerificationUri = device.verification_uri;
  chrome.tabs.create({ url: device.verification_uri });
  deviceStatusEl.textContent = "Waiting for authorization…";

  pollForToken(device.device_code, (device.interval || 5) * 1000, Date.now() + device.expires_in * 1000);
}

function pollForToken(deviceCode, intervalMs, deadline) {
  devicePollTimer = setTimeout(async () => {
    if (Date.now() > deadline) {
      backToIdle("Code expired. Click Authorize GitHub to try again.");
      return;
    }

    try {
      const res = await fetch(ACCESS_TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = await res.json();

      if (data.access_token) {
        await onDeviceFlowSuccess(data.access_token);
        return;
      }
      if (data.error === "authorization_pending") {
        pollForToken(deviceCode, intervalMs, deadline);
        return;
      }
      if (data.error === "slow_down") {
        pollForToken(deviceCode, intervalMs + 5000, deadline);
        return;
      }
      if (data.error === "expired_token") {
        backToIdle("Code expired. Click Authorize GitHub to try again.");
        return;
      }
      if (data.error === "access_denied") {
        backToIdle("Authorization was denied on GitHub.");
        return;
      }
      throw new Error(data.error_description || data.error || "unknown error");
    } catch (e) {
      backToIdle("Error while waiting for GitHub: " + e.message);
    }
  }, intervalMs);
}

function backToIdle(message) {
  deviceStatusEl.textContent = message;
  connectActiveEl.classList.remove("active");
  connectIdleEl.style.display = "block";
}

// Fetches the repos this GitHub App installation was granted access to, for
// the account the user just authorized. Returns { installationId, repos }.
async function fetchInstalledRepos(token) {
  const installRes = await fetch("https://api.github.com/user/installations", {
    headers: apiHeaders(token),
  });
  if (!installRes.ok) throw new Error(`Couldn't list installations: ${installRes.status}`);
  const installData = await installRes.json();
  const installation = (installData.installations || [])[0];
  if (!installation) return { installationId: null, repos: [] };

  const reposRes = await fetch(
    `https://api.github.com/user/installations/${installation.id}/repositories`,
    { headers: apiHeaders(token) }
  );
  if (!reposRes.ok) throw new Error(`Couldn't list authorized repos: ${reposRes.status}`);
  const reposData = await reposRes.json();
  const repos = (reposData.repositories || []).map((r) => ({
    owner: r.owner.login,
    repo: r.name,
    fullName: r.full_name,
  }));
  return { installationId: installation.id, repos };
}

async function onDeviceFlowSuccess(accessToken) {
  stopDevicePolling();
  deviceStatusEl.textContent = "Authorized! Checking which repo you granted access to…";

  let login = "";
  try {
    const userRes = await fetch("https://api.github.com/user", { headers: apiHeaders(accessToken) });
    if (userRes.ok) login = (await userRes.json()).login || "";
  } catch (e) {
    // Non-fatal.
  }

  let installationId = null;
  let repos = [];
  try {
    ({ installationId, repos } = await fetchInstalledRepos(accessToken));
  } catch (e) {
    connectActiveEl.classList.remove("active");
    connectIdleEl.style.display = "block";
    setStatus("Authorized, but couldn't read repo access: " + e.message, "error");
    return;
  }

  if (repos.length === 0) {
    connectActiveEl.classList.remove("active");
    connectIdleEl.style.display = "block";
    setStatus(
      "Authorized, but no repo is installed yet — click \"1. Install on a repo\", pick one, then Authorize GitHub again.",
      "error"
    );
    return;
  }

  const chosen = repos[0];
  const update = {
    githubToken: accessToken,
    githubUser: login,
    installationId,
    availableRepos: repos,
    owner: chosen.owner,
    repo: chosen.repo,
  };
  await chrome.storage.local.set(update);
  connectActiveEl.classList.remove("active");
  renderConnectionState(update);
  setStatus("Connected to GitHub.", "ok");
}

// GITHUB_APP_SLUG is meant to be the bare slug (e.g. "leetcommitv1"), but
// accept a full app URL too (e.g. "https://github.com/apps/leetcommitv1")
// since that's what you get by copy-pasting the "Public page" link directly.
function installUrl() {
  const raw = GITHUB_APP_SLUG.trim().replace(/\/+$/, "");
  const base = raw.startsWith("http") ? raw : `https://github.com/apps/${raw}`;
  return `${base}/installations/new`;
}

installBtn.addEventListener("click", () => {
  if (!GITHUB_APP_SLUG || GITHUB_APP_SLUG === "YOUR_GITHUB_APP_SLUG") {
    setStatus("GitHub isn't set up yet: add the App slug in options.js (see README).", "error");
    return;
  }
  chrome.tabs.create({ url: installUrl() });
});

connectBtn.addEventListener("click", startDeviceFlow);

reopenBtn.addEventListener("click", () => {
  if (lastVerificationUri) chrome.tabs.create({ url: lastVerificationUri });
});

changeRepoBtn.addEventListener("click", async () => {
  const { installationId } = await chrome.storage.local.get(["installationId"]);
  if (installationId) {
    chrome.tabs.create({ url: `https://github.com/settings/installations/${installationId}` });
  } else {
    setStatus("No installation on file — try Authorize GitHub again.", "error");
  }
});

refreshBtn.addEventListener("click", async () => {
  setStatus("Refreshing…");
  const { githubToken } = await chrome.storage.local.get(["githubToken"]);
  if (!githubToken) {
    setStatus("Not connected.", "error");
    return;
  }
  try {
    const { installationId, repos } = await fetchInstalledRepos(githubToken);
    if (repos.length === 0) {
      setStatus("No repos are authorized anymore. Use Change repository access to add one.", "error");
      return;
    }
    const current = await chrome.storage.local.get(["owner", "repo"]);
    const stillGranted = repos.some((r) => r.owner === current.owner && r.repo === current.repo);
    const chosen = stillGranted ? current : repos[0];
    const update = {
      installationId,
      availableRepos: repos,
      owner: chosen.owner,
      repo: chosen.repo,
    };
    await chrome.storage.local.set(update);
    loadConfig();
    setStatus("Refreshed.", "ok");
  } catch (e) {
    setStatus("Refresh failed: " + e.message, "error");
  }
});

repoSelectEl.addEventListener("change", async () => {
  const [owner, repo] = repoSelectEl.value.split("/");
  await chrome.storage.local.set({ owner, repo });
  loadConfig();
  setStatus(`Switched to ${owner}/${repo}.`, "ok");
});

disconnectBtn.addEventListener("click", async () => {
  stopDevicePolling();
  await chrome.storage.local.remove([
    "githubToken",
    "githubUser",
    "installationId",
    "owner",
    "repo",
    "availableRepos",
  ]);
  renderConnectionState({});
  setStatus("Disconnected.", "ok");
});

document.getElementById("saveBtn").addEventListener("click", () => {
  chrome.storage.local.set({ branch: branchEl.value.trim() || "main" }, () => {
    setStatus("Saved.", "ok");
  });
});

document.getElementById("testBtn").addEventListener("click", async () => {
  setStatus("Testing...");
  const { githubToken, owner, repo } = await chrome.storage.local.get(["githubToken", "owner", "repo"]);
  if (!githubToken || !owner || !repo) {
    setStatus("Authorize GitHub first.", "error");
    return;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: apiHeaders(githubToken) });
    if (res.status === 404) {
      setStatus("Repo not found, or access wasn't granted.", "error");
      return;
    }
    if (res.status === 401) {
      setStatus("Authorization rejected — try Authorize GitHub again.", "error");
      return;
    }
    if (!res.ok) {
      setStatus(`GitHub error: ${res.status}`, "error");
      return;
    }
    const data = await res.json();
    const perms = data.permissions || {};
    if (!perms.push) {
      setStatus("Connected, but push access wasn't granted for this repo.", "error");
      return;
    }
    setStatus(`Connected to ${data.full_name}.`, "ok");
  } catch (e) {
    setStatus("Network error: " + e.message, "error");
  }
});

loadConfig();

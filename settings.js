// Shared GitHub-connection logic used by both popup.html and options.html.
// Handles the GitHub App device flow, repo install/picker, branch, and
// connection testing. All state lives in chrome.storage.local so either
// surface reflects the same thing, and an in-progress device-flow code
// survives the popup closing when a GitHub tab steals focus.

// Replace with the Client ID of a GitHub App that has "Device Flow" enabled
// and "Contents: Read and write" repository permission. No client secret is
// needed — device flow is a public-client flow. See README.md "Setup".
const GITHUB_CLIENT_ID = "Iv23li582YbbQjA4wwt5";

// The GitHub App's slug (the URL-friendly name from its "Public page" link,
// e.g. github.com/apps/<slug>) — Settings → Developer settings → GitHub Apps
// → your app → General. Used to open the install/repo-picker screen.
const GITHUB_APP_SLUG = "https://github.com/apps/leetcommitv1";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

const statusDotEl = document.getElementById("statusDot");
const statusEl = document.getElementById("status");
const branchEl = document.getElementById("branch");

const connectIdleEl = document.getElementById("connectIdle");
const connectActiveEl = document.getElementById("connectActive");
const connectNeedsRepoEl = document.getElementById("connectNeedsRepo");
const connectDoneEl = document.getElementById("connectDone");
const connectBtn = document.getElementById("connectBtn");
const reopenBtn = document.getElementById("reopenBtn");
const cancelBtn = document.getElementById("cancelBtn");
const selectRepoBtn = document.getElementById("selectRepoBtn");
const needsRepoAvatarEl = document.getElementById("needsRepoAvatar");
const needsRepoNameEl = document.getElementById("needsRepoName");
const needsRepoDisconnectBtn = document.getElementById("needsRepoDisconnectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const switchRepoBtn = document.getElementById("switchRepoBtn");
const refreshBtn = document.getElementById("refreshBtn");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const userCodeEl = document.getElementById("userCode");
const deviceStatusEl = document.getElementById("deviceStatus");
const repoLinkEl = document.getElementById("repoLink");
const connectedRepoEl = document.getElementById("connectedRepo");
const connectedNameEl = document.getElementById("connectedName");
const avatarImgEl = document.getElementById("avatarImg");
const repoPickerEl = document.getElementById("repoPicker");
const repoSelectEl = document.getElementById("repoSelect");

function setStatus(text, cls) {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (cls ? " " + cls : "");
}

function apiHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

function showIdle() {
  connectIdleEl.style.display = "block";
  connectActiveEl.style.display = "none";
  connectNeedsRepoEl.style.display = "none";
  connectDoneEl.style.display = "none";
  if (statusDotEl) statusDotEl.className = "dot";
}

function showActive() {
  connectIdleEl.style.display = "none";
  connectActiveEl.style.display = "block";
  connectNeedsRepoEl.style.display = "none";
  connectDoneEl.style.display = "none";
  if (statusDotEl) statusDotEl.className = "dot pending";
}

function showNeedsRepo(cfg) {
  connectIdleEl.style.display = "none";
  connectActiveEl.style.display = "none";
  connectNeedsRepoEl.style.display = "block";
  connectDoneEl.style.display = "none";
  if (statusDotEl) statusDotEl.className = "dot pending";

  needsRepoNameEl.textContent = cfg.githubUser ? `Connected as ${cfg.githubUser}` : "Connected to GitHub";
  if (cfg.githubAvatar) {
    needsRepoAvatarEl.src = cfg.githubAvatar;
    needsRepoAvatarEl.classList.add("show");
  } else {
    needsRepoAvatarEl.classList.remove("show");
  }
}

function showDone(cfg) {
  connectIdleEl.style.display = "none";
  connectActiveEl.style.display = "none";
  connectNeedsRepoEl.style.display = "none";
  connectDoneEl.style.display = "block";
  if (statusDotEl) statusDotEl.className = "dot ok";

  connectedRepoEl.textContent = `${cfg.owner}/${cfg.repo}`;
  repoLinkEl.href = `https://github.com/${cfg.owner}/${cfg.repo}`;
  connectedNameEl.textContent = cfg.githubUser ? `as ${cfg.githubUser}` : "";
  if (cfg.githubAvatar) {
    avatarImgEl.src = cfg.githubAvatar;
    avatarImgEl.classList.add("show");
  } else {
    avatarImgEl.classList.remove("show");
  }

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
}

// Populates the branch <select> for the given repo, preferring the
// currently-saved branch if it still exists, else the repo's default
// branch. Falls back to a single "main" option if the fetch fails (e.g.
// offline) so the field never ends up empty.
async function loadBranches(token, owner, repo, currentBranch) {
  branchEl.disabled = true;
  if (!branchEl.options.length) {
    branchEl.innerHTML = `<option>${currentBranch || "main"}</option>`;
  }
  try {
    const [repoRes, branchesRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: apiHeaders(token) }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, { headers: apiHeaders(token) }),
    ]);
    const repoData = repoRes.ok ? await repoRes.json() : null;
    const branchesData = branchesRes.ok ? await branchesRes.json() : [];

    const names = Array.isArray(branchesData) ? branchesData.map((b) => b.name) : [];
    const defaultBranch = (repoData && repoData.default_branch) || "main";
    if (!names.includes(defaultBranch)) names.unshift(defaultBranch);

    const selected = currentBranch && names.includes(currentBranch) ? currentBranch : defaultBranch;
    branchEl.innerHTML = names
      .map((n) => `<option value="${n}"${n === selected ? " selected" : ""}>${n}</option>`)
      .join("");

    if (selected !== currentBranch) {
      await chrome.storage.local.set({ branch: selected });
    }
  } catch (e) {
    // Non-fatal — leave the single fallback option in place.
  } finally {
    branchEl.disabled = false;
  }
}

async function renderConnected(cfg) {
  showDone(cfg);
  await loadBranches(cfg.githubToken, cfg.owner, cfg.repo, cfg.branch);
}

function installUrl() {
  const raw = GITHUB_APP_SLUG.trim().replace(/\/+$/, "");
  const base = raw.startsWith("http") ? raw : `https://github.com/apps/${raw}`;
  return `${base}/installations/new`;
}

let devicePollTimer = null;

function stopDevicePolling() {
  if (devicePollTimer) {
    clearTimeout(devicePollTimer);
    devicePollTimer = null;
  }
}

async function loadConfig() {
  const cfg = await chrome.storage.local.get([
    "githubToken",
    "githubUser",
    "githubAvatar",
    "installationId",
    "owner",
    "repo",
    "availableRepos",
    "branch",
    "pendingDevice",
  ]);

  if (cfg.githubToken && cfg.owner && cfg.repo) {
    await renderConnected(cfg);
    refreshRepos(false);
    return cfg;
  }

  const pending = cfg.pendingDevice;
  if (pending && pending.expiresAt > Date.now()) {
    showActive();
    userCodeEl.textContent = pending.userCode;
    deviceStatusEl.textContent = "Waiting for authorization…";
    checkToken(pending, Math.max(0, pending.nextCheckAt - Date.now()));
    return cfg;
  }
  if (pending) {
    await chrome.storage.local.remove("pendingDevice");
  }

  if (cfg.githubToken) {
    // Step 1 (authorize) is done but step 2 (pick a repo) isn't. Check in
    // case the repo was picked while this page was closed, otherwise show
    // the "select a repository" prompt.
    showNeedsRepo(cfg);
    await tryCompleteRepoSetup(cfg.githubToken, cfg.githubUser, cfg.githubAvatar);
    return cfg;
  }

  showIdle();
  return cfg;
}

// Step 1: authorize with GitHub (device flow only — no repo selection yet).
// Persists the device code before anything else so the flow survives the
// popup closing when the verification tab steals focus.
async function startConnect() {
  if (!GITHUB_CLIENT_ID || GITHUB_CLIENT_ID === "YOUR_GITHUB_APP_CLIENT_ID") {
    setStatus("GitHub isn't set up yet: add a GitHub App Client ID in settings.js (see README).", "error");
    return;
  }

  setStatus("");
  connectBtn.disabled = true;

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
    connectBtn.disabled = false;
    setStatus("Couldn't start GitHub authorization: " + e.message, "error");
    return;
  }

  const pending = {
    deviceCode: device.device_code,
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    intervalMs: (device.interval || 5) * 1000,
    expiresAt: Date.now() + device.expires_in * 1000,
    nextCheckAt: Date.now() + (device.interval || 5) * 1000,
  };
  await chrome.storage.local.set({ pendingDevice: pending });

  showActive();
  userCodeEl.textContent = pending.userCode;
  deviceStatusEl.textContent = "Waiting for authorization…";
  connectBtn.disabled = false;

  chrome.tabs.create({ url: pending.verificationUri });

  checkToken(pending, pending.intervalMs);
}

function checkToken(pending, delayMs) {
  stopDevicePolling();
  devicePollTimer = setTimeout(async () => {
    if (Date.now() > pending.expiresAt) {
      await chrome.storage.local.remove("pendingDevice");
      showIdle();
      setStatus("Code expired. Click Connect GitHub to try again.", "error");
      return;
    }

    try {
      const res = await fetch(ACCESS_TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: pending.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = await res.json();

      if (data.access_token) {
        await onDeviceFlowSuccess(data.access_token);
        return;
      }
      if (data.error === "authorization_pending") {
        pending.nextCheckAt = Date.now() + pending.intervalMs;
        await chrome.storage.local.set({ pendingDevice: pending });
        checkToken(pending, pending.intervalMs);
        return;
      }
      if (data.error === "slow_down") {
        pending.intervalMs += 5000;
        pending.nextCheckAt = Date.now() + pending.intervalMs;
        await chrome.storage.local.set({ pendingDevice: pending });
        checkToken(pending, pending.intervalMs);
        return;
      }
      if (data.error === "expired_token") {
        await chrome.storage.local.remove("pendingDevice");
        showIdle();
        setStatus("Code expired. Click Connect GitHub to try again.", "error");
        return;
      }
      if (data.error === "access_denied") {
        await chrome.storage.local.remove("pendingDevice");
        showIdle();
        setStatus("Authorization was denied on GitHub.", "error");
        return;
      }
      throw new Error(data.error_description || data.error || "unknown error");
    } catch (e) {
      showIdle();
      setStatus("Error while waiting for GitHub: " + e.message, "error");
    }
  }, delayMs);
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
  deviceStatusEl.textContent = "Authorized! Checking for a connected repo…";

  let login = "";
  let avatar = "";
  try {
    const userRes = await fetch("https://api.github.com/user", { headers: apiHeaders(accessToken) });
    if (userRes.ok) {
      const user = await userRes.json();
      login = user.login || "";
      avatar = user.avatar_url || "";
    }
  } catch (e) {
    // Non-fatal.
  }

  await chrome.storage.local.set({ githubToken: accessToken, githubUser: login, githubAvatar: avatar });
  await chrome.storage.local.remove("pendingDevice");

  await tryCompleteRepoSetup(accessToken, login, avatar);
}

// Step 2: checks whether a repo has been installed yet for this token. If
// so, completes the connection; otherwise shows the "select a repository"
// prompt. Called right after authorizing, and again whenever the popup
// reopens while step 2 is still pending, in case it was finished on GitHub
// while this page was closed.
async function tryCompleteRepoSetup(token, login, avatar) {
  let installationId = null;
  let repos = [];
  try {
    ({ installationId, repos } = await fetchInstalledRepos(token));
  } catch (e) {
    showNeedsRepo({ githubUser: login, githubAvatar: avatar });
    setStatus("Couldn't check repo access: " + e.message, "error");
    return;
  }

  if (repos.length === 0) {
    showNeedsRepo({ githubUser: login, githubAvatar: avatar });
    return;
  }

  const chosen = repos[0];
  const update = { installationId, availableRepos: repos, owner: chosen.owner, repo: chosen.repo };
  await chrome.storage.local.set(update);
  await renderConnected({ ...update, githubToken: token, githubUser: login, githubAvatar: avatar });
  setStatus("");
}

// Re-checks installed repos against GitHub. Called silently when a
// connected user opens the popup/options page, and on-demand from the
// Refresh chip. Note this deliberately keeps the currently-active repo
// selected if it's still granted (so opening the popup doesn't yank you
// off the repo you're mid-push to) — if you granted access to an
// *additional* repo without removing the old one, the repo picker below
// will show it, but the active one won't auto-switch. Use Refresh + the
// picker (or remove the old repo's access on GitHub) to actually switch.
async function refreshRepos(showFeedback) {
  const { githubToken, githubUser, githubAvatar, owner, repo, branch } = await chrome.storage.local.get([
    "githubToken",
    "githubUser",
    "githubAvatar",
    "owner",
    "repo",
    "branch",
  ]);
  if (!githubToken) return;
  if (showFeedback) setStatus("Refreshing…");
  try {
    const { installationId, repos } = await fetchInstalledRepos(githubToken);
    if (repos.length === 0) {
      if (showFeedback) setStatus("No repos are authorized anymore. Use Switch repo to add one.", "error");
      return;
    }
    const stillGranted = repos.some((r) => r.owner === owner && r.repo === repo);
    const chosen = stillGranted ? { owner, repo } : repos[0];
    const update = { installationId, availableRepos: repos, owner: chosen.owner, repo: chosen.repo };
    await chrome.storage.local.set(update);
    await renderConnected({ ...update, githubToken, githubUser, githubAvatar, branch: stillGranted ? branch : undefined });
    if (showFeedback) {
      setStatus(stillGranted ? "Refreshed." : `Switched to ${chosen.owner}/${chosen.repo}.`, "ok");
    }
  } catch (e) {
    if (showFeedback) setStatus("Refresh failed: " + e.message, "error");
  }
}

connectBtn.addEventListener("click", startConnect);

copyCodeBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(userCodeEl.textContent.trim());
    copyCodeBtn.classList.add("copied");
    setTimeout(() => copyCodeBtn.classList.remove("copied"), 1200);
  } catch (e) {
    // Clipboard access denied — user can still select/copy the code manually.
  }
});

reopenBtn.addEventListener("click", async () => {
  const { pendingDevice } = await chrome.storage.local.get(["pendingDevice"]);
  if (pendingDevice) chrome.tabs.create({ url: pendingDevice.verificationUri });
});

cancelBtn.addEventListener("click", async () => {
  stopDevicePolling();
  await chrome.storage.local.remove("pendingDevice");
  showIdle();
});

// Step 2: opens GitHub's repo-install picker. Since opening a tab closes
// this popup, the result is picked up next time it reopens (loadConfig
// re-checks via tryCompleteRepoSetup).
selectRepoBtn.addEventListener("click", () => {
  if (!GITHUB_APP_SLUG || GITHUB_APP_SLUG === "YOUR_GITHUB_APP_SLUG") {
    setStatus("GitHub isn't set up yet: add the App slug in settings.js (see README).", "error");
    return;
  }
  chrome.tabs.create({ url: installUrl() });
});

switchRepoBtn.addEventListener("click", async () => {
  const { installationId, githubToken } = await chrome.storage.local.get(["installationId", "githubToken"]);
  let id = installationId;

  // installationId can be missing on storage left over from before this
  // field existed. Re-derive it live from the token rather than dead-ending.
  if (!id && githubToken) {
    try {
      const fresh = await fetchInstalledRepos(githubToken);
      id = fresh.installationId;
      if (id) await chrome.storage.local.set({ installationId: id });
    } catch (e) {
      setStatus("Couldn't reach GitHub: " + e.message, "error");
      return;
    }
  }

  if (id) {
    chrome.tabs.create({ url: `https://github.com/settings/installations/${id}` });
  } else {
    setStatus("Couldn't find your GitHub App installation. Try Connect GitHub again.", "error");
  }
});

refreshBtn.addEventListener("click", () => refreshRepos(true));

repoSelectEl.addEventListener("change", async () => {
  const [owner, repo] = repoSelectEl.value.split("/");
  // Switching repos drops the previously-saved branch — it belonged to the
  // old repo and may not exist in the new one. loadBranches resolves a
  // fresh default for whichever repo is now selected.
  await chrome.storage.local.set({ owner, repo });
  await chrome.storage.local.remove("branch");
  const cfg = await chrome.storage.local.get(["githubToken", "githubUser", "githubAvatar", "availableRepos"]);
  await renderConnected({ owner, repo, ...cfg });
  setStatus(`Switched to ${owner}/${repo}.`, "ok");
});

async function disconnectAll() {
  stopDevicePolling();
  await chrome.storage.local.remove([
    "githubToken",
    "githubUser",
    "githubAvatar",
    "installationId",
    "owner",
    "repo",
    "availableRepos",
    "pendingDevice",
  ]);
  showIdle();
  setStatus("Disconnected.", "ok");
}

disconnectBtn.addEventListener("click", disconnectAll);
needsRepoDisconnectBtn.addEventListener("click", disconnectAll);

branchEl.addEventListener("change", () => {
  chrome.storage.local.set({ branch: branchEl.value }, () => setStatus(`Branch switched to ${branchEl.value}.`, "ok"));
});

loadConfig();

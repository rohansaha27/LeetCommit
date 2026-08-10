const EXT_BY_LANG = {
  python: "py",
  python3: "py",
  java: "java",
  "c++": "cpp",
  cpp: "cpp",
  c: "c",
  "c#": "cs",
  csharp: "cs",
  javascript: "js",
  typescript: "ts",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  dart: "dart",
  go: "go",
  golang: "go",
  ruby: "rb",
  scala: "scala",
  rust: "rs",
};

function extFor(lang) {
  return EXT_BY_LANG[(lang || "").toLowerCase()] || "txt";
}

document.getElementById("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function checkConfig() {
  const cfg = await chrome.storage.local.get(["githubToken", "owner", "repo"]);
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  if (cfg.githubToken && cfg.owner && cfg.repo) {
    dot.className = "dot ok";
    text.textContent = `Configured: ${cfg.owner}/${cfg.repo}`;
  } else {
    dot.className = "dot bad";
    text.textContent = "Not configured yet";
  }
}

async function renderPending() {
  const { pendingSubmission } = await chrome.storage.session.get("pendingSubmission");
  const section = document.getElementById("pendingSection");
  if (!pendingSubmission) {
    section.innerHTML = `<div class="empty">No pending submission. Solve something on LeetCode and hit Submit — an Accepted result will show a push prompt automatically.</div>`;
    return;
  }

  const { title, slug, lang, code, detectedAt } = pendingSubmission;
  const minutesAgo = Math.round((Date.now() - detectedAt) / 60000);

  section.innerHTML = `
    <div class="pending">
      <div class="title">${title}</div>
      <div class="meta">${lang} &middot; detected ${minutesAgo <= 0 ? "just now" : minutesAgo + "m ago"} &middot; skipped or modal closed</div>
      <button id="pushBtn">Push now</button>
      <button class="secondary" id="discardBtn">Discard</button>
    </div>
  `;

  document.getElementById("discardBtn").addEventListener("click", async () => {
    await chrome.storage.session.remove("pendingSubmission");
    renderPending();
  });

  document.getElementById("pushBtn").addEventListener("click", () => {
    const btn = document.getElementById("pushBtn");
    btn.disabled = true;
    btn.textContent = "Pushing...";

    chrome.runtime.sendMessage(
      {
        type: "PUSH_SOLUTION",
        payload: {
          problemTitle: title,
          problemUrl: `https://leetcode.com/problems/${slug}/`,
          slug,
          difficulty: "misc",
          language: (lang || "unknown").toLowerCase(),
          ext: extFor(lang),
          code,
          notes: "Pushed from the LeetCommit popup without notes (modal was skipped).",
          timeComplexity: "",
          spaceComplexity: "",
          commitMessageOverride: "",
        },
      },
      (response) => {
        if (response && response.ok) {
          btn.textContent = `Pushed as ${response.fileName}`;
          setTimeout(renderPending, 1200);
        } else {
          btn.disabled = false;
          btn.textContent = "Push now";
          alert("Push failed: " + ((response && response.error) || "unknown error"));
        }
      }
    );
  });
}

checkConfig();
renderPending();

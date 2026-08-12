// Popup-only addition on top of settings.js: surfaces a submission that was
// detected but never pushed (modal skipped or closed) with a one-click push.

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

async function renderPending() {
  const { pendingSubmission } = await chrome.storage.session.get("pendingSubmission");
  const section = document.getElementById("pendingSection");
  if (!pendingSubmission) {
    section.innerHTML = "";
    return;
  }

  const { title, slug, lang, code, detectedAt } = pendingSubmission;
  const minutesAgo = Math.round((Date.now() - detectedAt) / 60000);

  section.innerHTML = `
    <div class="pending">
      <div class="title">${title}</div>
      <div class="meta">${lang} &middot; detected ${minutesAgo <= 0 ? "just now" : minutesAgo + "m ago"}</div>
      <div class="btn-row">
        <button type="button" class="push-btn" id="pushBtn">Push now</button>
        <button type="button" class="discard-btn" id="discardBtn">Discard</button>
      </div>
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

renderPending();

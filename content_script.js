// Isolated-world content script. Listens for the "leetcommit:accepted"
// event dispatched by inject.js (MAIN world), pulls a bit of extra context
// out of the DOM (title/difficulty), and shows an in-page modal so the user
// can add notes before pushing to GitHub.

(function () {
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
    racket: "rkt",
    erlang: "erl",
    elixir: "ex",
  };

  function extFor(lang) {
    return EXT_BY_LANG[(lang || "").toLowerCase()] || "txt";
  }

  function getProblemTitle() {
    const titleEl = document.querySelector('[data-cy="question-title"], a[href^="/problems/"] div.text-title-large, div.text-title-large');
    if (titleEl && titleEl.textContent.trim()) return titleEl.textContent.trim();
    // Fallback: "<Number>. <Title> - LeetCode"
    const docTitle = document.title.replace(/\s*-\s*LeetCode.*$/, "").trim();
    return docTitle || "Untitled Problem";
  }

  function findDifficultyIn(root) {
    const candidates = Array.from(root.querySelectorAll("div, span, button"));
    for (const el of candidates) {
      const text = el.textContent && el.textContent.trim();
      if (text === "Easy" || text === "Medium" || text === "Hard") {
        // Guard against matching something buried deep in an unrelated list.
        if (el.children.length === 0) return text.toLowerCase();
      }
    }
    return null;
  }

  function getDifficulty() {
    // Search near the title first — a page-wide scan can match a difficulty
    // badge belonging to an unrelated sidebar entry (e.g. "Similar
    // Questions") before it reaches the current problem's own badge. Only
    // fall back to scanning the whole document if nothing turns up nearby.
    const titleEl = document.querySelector('[data-cy="question-title"], a[href^="/problems/"] div.text-title-large, div.text-title-large');
    if (titleEl) {
      let ancestor = titleEl;
      for (let i = 0; i < 6 && ancestor.parentElement; i++) ancestor = ancestor.parentElement;
      const nearby = findDifficultyIn(ancestor);
      if (nearby) return nearby;
    }
    return findDifficultyIn(document) || "unknown";
  }

  // Folder name gets the question number prefixed (e.g. "1-two-sum"), read
  // off the "N. Title" text LeetCode shows. The URL slug itself is kept
  // separate from this — the problem link must stay the plain "two-sum"
  // form, only the repo folder name gets the number.
  function folderSlugFor(title, slug) {
    const m = title.match(/^(\d+)\./);
    return m ? `${m[1]}-${slug}` : slug;
  }

  function buildModal(detail) {
    const host = document.createElement("div");
    host.id = "leetcommit-host";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    const title = getProblemTitle();
    const difficulty = getDifficulty();
    // Folder placement is always automatic — easy/medium/hard from the
    // detected difficulty, "misc" only if the DOM scan couldn't tell.
    const diffFolder = ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "misc";
    const slug = detail.slug;
    const problemUrl = `https://leetcode.com/problems/${slug}/`;
    const folderSlug = folderSlugFor(title, slug);
    const ext = extFor(detail.lang);

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.5);
          z-index: 2147483647; display: flex; align-items: center; justify-content: center;
          font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        .modal {
          background: #1a1a1a; color: #f0efec; width: 560px; max-width: 92vw;
          max-height: 88vh; overflow-y: auto; border-radius: 10px; padding: 20px 24px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        }
        h2 { margin: 0 0 4px; font-size: 18px; }
        .sub { color: #9a9a9a; font-size: 13px; margin-bottom: 16px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 6px; }
        .badge.easy { background: #1d3b2a; color: #4caf50; }
        .badge.medium { background: #3b331d; color: #ffb800; }
        .badge.hard { background: #3b1d1d; color: #ff5252; }
        .badge.unknown { background: #333; color: #aaa; }
        label { display: block; font-size: 12px; color: #b0b0b0; margin: 12px 0 4px; }
        input[type=text], textarea {
          width: 100%; box-sizing: border-box; background: #262626; color: #f0f0f0;
          border: 1px solid #3a3a3a; border-radius: 6px; padding: 8px 10px; font-size: 13px;
          font-family: inherit;
        }
        textarea { min-height: 90px; resize: vertical; }
        textarea.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
        .row { display: flex; gap: 10px; }
        .row > div { flex: 1; }
        .path-row { display: flex; align-items: center; gap: 6px; }
        .path-prefix {
          background: #262626; border: 1px solid #3a3a3a; border-radius: 6px; padding: 8px 10px;
          color: #9a9a9a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
          white-space: nowrap;
        }
        .path-row input[type=text] { flex: 1; }
        .code-preview {
          background: #0f0f0f; border: 1px solid #2a2a2a; border-radius: 6px; padding: 10px;
          max-height: 160px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px; white-space: pre; margin-top: 4px;
        }
        .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        button {
          border: none; border-radius: 6px; padding: 9px 16px; font-size: 13px; cursor: pointer;
        }
        .btn-skip { background: #2a2a2a; color: #ccc; }
        .btn-push { background: #7ffc94; color: #0f0f0f; font-weight: 700; }
        .btn-push:disabled { background: #3a5c43; color: #a3a3a3; cursor: default; }
        .status { font-size: 12px; margin-top: 10px; min-height: 16px; }
        .status.error { color: #ff5252; }
        .status.ok { color: #7ffc94; }
      </style>
      <div class="overlay">
        <div class="modal">
          <h2>${title} <span class="badge ${difficulty}">${difficulty}</span></h2>
          <div class="sub">Accepted &middot; ${detail.lang} &middot; ${detail.totalCorrect || "?"}/${detail.totalTestcases || "?"} testcases</div>

          <label>Destination folder (auto-detected from difficulty)</label>
          <div class="path-row">
            <span class="path-prefix">${diffFolder}/</span>
            <input type="text" id="repoSlug" value="${folderSlug}" />
          </div>

          <label>Solution code</label>
          <div class="code-preview" id="codePreview"></div>

          <label>Notes (approach, complexity, what you learned)</label>
          <textarea id="notes" placeholder="e.g. Two-pointer approach after sorting. O(n log n) time, O(1) space. Missed the edge case where..."></textarea>

          <div class="row">
            <div>
              <label>Time complexity</label>
              <input type="text" id="timeComplexity" placeholder="n^2" />
            </div>
            <div>
              <label>Space complexity</label>
              <input type="text" id="spaceComplexity" placeholder="1" />
            </div>
          </div>

          <label>Commit message (optional override)</label>
          <input type="text" id="commitMsg" placeholder="Add solution: ${title}" />

          <div class="status" id="status"></div>
          <div class="actions">
            <button class="btn-skip" id="skipBtn">Skip</button>
            <button class="btn-push" id="pushBtn">Push to GitHub</button>
          </div>
        </div>
      </div>
    `;

    shadow.getElementById("codePreview").textContent = detail.code;

    function close() {
      host.remove();
    }

    shadow.getElementById("skipBtn").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "DISCARD_PENDING" });
      close();
    });

    shadow.getElementById("pushBtn").addEventListener("click", () => {
      const pushBtn = shadow.getElementById("pushBtn");
      const statusEl = shadow.getElementById("status");
      pushBtn.disabled = true;
      statusEl.textContent = "Pushing...";
      statusEl.className = "status";

      const slugValue = shadow.getElementById("repoSlug").value.trim() || folderSlug;

      chrome.runtime.sendMessage(
        {
          type: "PUSH_SOLUTION",
          payload: {
            problemTitle: title,
            problemUrl,
            slug: slugValue,
            difficulty: diffFolder,
            language: (detail.lang || "unknown").toLowerCase(),
            ext,
            code: detail.code,
            notes: shadow.getElementById("notes").value,
            timeComplexity: shadow.getElementById("timeComplexity").value,
            spaceComplexity: shadow.getElementById("spaceComplexity").value,
            commitMessageOverride: shadow.getElementById("commitMsg").value.trim(),
            runtime: detail.runtime,
            memory: detail.memory,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            statusEl.textContent = "Error: " + chrome.runtime.lastError.message;
            statusEl.className = "status error";
            pushBtn.disabled = false;
            return;
          }
          if (response && response.ok) {
            statusEl.textContent = `Pushed as ${response.fileName}`;
            statusEl.className = "status ok";
            setTimeout(close, 1200);
          } else {
            statusEl.textContent = "Error: " + ((response && response.error) || "unknown error");
            statusEl.className = "status error";
            pushBtn.disabled = false;
          }
        }
      );
    });
  }

  window.addEventListener("leetcommit:accepted", (e) => {
    const detail = JSON.parse(e.detail);
    if (!detail || !detail.code) return;

    // Let the background script know a submission is pending, so the
    // toolbar popup can offer a "push" affordance even if this modal
    // gets closed/skipped or the tab is later revisited.
    const detectedTitle = getProblemTitle();
    chrome.runtime.sendMessage({
      type: "SUBMISSION_DETECTED",
      payload: {
        title: detectedTitle,
        slug: detail.slug,
        folderSlug: folderSlugFor(detectedTitle, detail.slug),
        lang: detail.lang,
        code: detail.code,
        difficulty: getDifficulty(),
        runtime: detail.runtime,
        memory: detail.memory,
        detectedAt: Date.now(),
      },
    });

    // Avoid stacking multiple modals if somehow triggered twice.
    const existing = document.getElementById("leetcommit-host");
    if (existing) existing.remove();

    buildModal(detail);
  });
})();

// Runs in the page's MAIN world (has access to the real window.fetch/XHR,
// not the isolated content-script copies). Its only job is to watch the
// network traffic LeetCode's own React app generates when you hit "Submit",
// and announce an Accepted result back out to the isolated-world content
// script via a CustomEvent. We never touch the DOM here.

(function () {
  const SUBMIT_URL_RE = /\/problems\/([^/]+)\/submit\/?$/;
  // LeetCode has shipped this as both /submissions/detail/{id}/check/ and
  // /submissions/detail/{id}/v2/check/ — match either so a future version
  // bump doesn't silently stop detection again.
  const CHECK_URL_RE = /\/submissions\/detail\/(\d+)\/(?:\w+\/)?check\/?$/;

  // submissionId -> { slug, lang, code, questionId }
  const pendingBySubmissionId = new Map();
  // slug -> most recent submit payload, used to line up the POST with the
  // submission id that comes back in its response.
  const lastSubmitBySlug = new Map();
  // submission ids we've already reported, so repeated polls after SUCCESS
  // don't fire the event twice.
  const reported = new Set();

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function handleSubmitRequestBody(slug, rawBody) {
    const body = safeJsonParse(rawBody);
    if (!body) return;
    lastSubmitBySlug.set(slug, {
      slug,
      lang: body.lang || body.language || "unknown",
      code: body.typed_code || body.code || "",
      questionId: body.question_id || null,
      submittedAt: Date.now(),
    });
  }

  function handleSubmitResponseBody(slug, rawBody) {
    const body = safeJsonParse(rawBody);
    if (!body) return;
    const submissionId = body.submission_id;
    if (!submissionId) return;
    const pending = lastSubmitBySlug.get(slug);
    if (pending) {
      pendingBySubmissionId.set(String(submissionId), pending);
    }
  }

  function handleCheckResponseBody(submissionId, rawBody) {
    const key = String(submissionId);
    if (reported.has(key)) return;
    const body = safeJsonParse(rawBody);
    if (!body || body.state !== "SUCCESS") return;

    const pending = pendingBySubmissionId.get(key);
    // status_code 10 === "Accepted" in LeetCode's submission result enum.
    const isAccepted = body.status_code === 10 || body.status_msg === "Accepted";

    reported.add(key);
    pendingBySubmissionId.delete(key);

    if (!isAccepted || !pending) return;

    window.dispatchEvent(
      new CustomEvent("leetcommit:accepted", {
        detail: JSON.stringify({
          slug: pending.slug,
          lang: pending.lang,
          code: pending.code,
          questionId: pending.questionId,
          submissionId: key,
          totalCorrect: body.total_correct,
          totalTestcases: body.total_testcases,
          runtime: body.status_runtime,
          memory: body.status_memory,
        }),
      })
    );
  }

  // ---- fetch() patch ----
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const method = (init && init.method) || (typeof input !== "string" && input && input.method) || "GET";

    const submitMatch = url && SUBMIT_URL_RE.exec(url);
    if (submitMatch && method.toUpperCase() === "POST" && init && init.body) {
      handleSubmitRequestBody(submitMatch[1], init.body);
    }

    const response = await originalFetch.apply(this, arguments);

    const checkMatch = url && CHECK_URL_RE.exec(url);
    if (submitMatch || checkMatch) {
      response
        .clone()
        .text()
        .then((text) => {
          if (submitMatch) handleSubmitResponseBody(submitMatch[1], text);
          if (checkMatch) handleCheckResponseBody(checkMatch[1], text);
        })
        .catch(() => {});
    }

    return response;
  };

  // ---- XMLHttpRequest patch (in case LeetCode's client uses XHR instead) ----
  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function (method, url) {
    this.__leetcommit = { method, url };
    return originalOpen.apply(this, arguments);
  };

  OriginalXHR.prototype.send = function (body) {
    const meta = this.__leetcommit;
    if (meta) {
      const submitMatch = SUBMIT_URL_RE.exec(meta.url);
      if (submitMatch && meta.method.toUpperCase() === "POST" && body) {
        handleSubmitRequestBody(submitMatch[1], body);
      }

      this.addEventListener("loadend", () => {
        try {
          if (submitMatch) handleSubmitResponseBody(submitMatch[1], this.responseText);
          const checkMatch = CHECK_URL_RE.exec(meta.url);
          if (checkMatch) handleCheckResponseBody(checkMatch[1], this.responseText);
        } catch (e) {
          /* ignore */
        }
      });
    }
    return originalSend.apply(this, arguments);
  };
})();

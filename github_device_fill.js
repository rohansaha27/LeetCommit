// Isolated-world content script on GitHub's device-authorization page
// (github.com/login/device). Fills the 8 one-character code boxes from the
// device code we already generated in settings.js, so the user doesn't have
// to copy/type it by hand. Deliberately never touches the Continue/Authorize
// button — that click stays a real user action, same as before this script
// existed.
//
// Why this exists: GitHub's own "?user_code=" query-param prefill only
// covers the "select account" interstitial when more than one session is
// active — the interstitial's own "Continue" link drops the query string,
// so the actual code-entry form on the next page always renders empty.
(function () {
  const FIELD_IDS = [
    "user-code-0", "user-code-1", "user-code-2", "user-code-3",
    "user-code-5", "user-code-6", "user-code-7", "user-code-8",
  ];

  function fillCode(userCode) {
    const digits = (userCode || "").replace(/[^0-9A-Za-z]/g, "");
    if (digits.length !== 8) return false;

    const inputs = FIELD_IDS.map((id) => document.getElementById(id));
    if (inputs.some((el) => !el)) return false;
    // Don't clobber anything the user may have already started typing.
    if (inputs.some((el) => el.value)) return true;

    inputs.forEach((el, i) => {
      el.value = digits[i];
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return true;
  }

  async function tryFill() {
    const { pendingDevice } = await chrome.storage.local.get("pendingDevice");
    if (!pendingDevice || !pendingDevice.userCode) return false;
    if (pendingDevice.expiresAt && pendingDevice.expiresAt < Date.now()) return false;
    return fillCode(pendingDevice.userCode);
  }

  // The code-entry form can render slightly after this script runs,
  // especially right after the account-picker interstitial redirects here —
  // poll briefly instead of trying exactly once.
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    if ((await tryFill()) || attempts > 20) clearInterval(timer);
  }, 250);
})();

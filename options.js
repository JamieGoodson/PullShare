// Persists options to chrome.storage.sync. Keep the defaults in sync with
// SETTINGS_DEFAULTS in content.js.
const SETTINGS_DEFAULTS = { showLineCounts: true, showCopyAsPrompt: true };

const status = document.getElementById("status");

// Briefly shows the "Saved" confirmation.
function confirmSaved() {
  status.classList.add("show");
  clearTimeout(status._timer);
  status._timer = setTimeout(() => status.classList.remove("show"), 1200);
}

// Load the saved values (or defaults) into the checkboxes on open, then save
// each one back as it changes.
chrome.storage.sync.get(SETTINGS_DEFAULTS).then((settings) => {
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    const checkbox = document.getElementById(key);
    if (!checkbox) continue;
    checkbox.checked = settings[key];
    checkbox.addEventListener("change", async () => {
      await chrome.storage.sync.set({ [key]: checkbox.checked });
      confirmSaved();
    });
  }
});

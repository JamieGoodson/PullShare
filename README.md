# GitHub PR Link

A minimal Chrome extension that adds a copy button to GitHub pull request
pages. Clicking it copies the PR title and URL to your clipboard as a link.

## Install (unpacked, for development)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `gh-pr-link/` folder.
4. Open any GitHub PR — a copy button appears in the PR header.

## Notes

- Works across GitHub's in-page (pjax/Turbo) navigation, so the button persists
  when you move between PRs without a full page reload.
- No special permissions are required; clipboard writes happen from your button
  click. A `document.execCommand` fallback covers older browsers.
- Icons are optional for unpacked dev loads. If Chrome complains about missing
  icon files, either add 16/48/128 px PNGs under `icons/` or remove the `icons`
  block from `manifest.json`.

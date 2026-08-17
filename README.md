# PullShare

With the PullShare Chrome extension, one click turns any GitHub PR into a clean, shareable link.

**Example:** [Update frontend-design skill](https://github.com/anthropics/skills/pull/1293) _(+39 / -26)_

It also adds a **Copy as prompt** button to every review comment thread, which copies the comment, the file path and the code lines it's anchored to — ready to paste into Claude:

````
Please address this GitHub PR review comment.

PR: Sunset v1 multitask scoring
Link: https://github.com/PolyAI-LDN/poly_core/pull/44964#discussion_r3795664987
File: src/data/callamari/processors/multitask_processor.py
Lines: 1029-1032

```python
elif v2_result is None and v2_call_summary_result is None:
    # Nothing to persist: v1 is sunset and v2 produced neither a score
    # nor a summary. Like the v1 parse failure above, the row stays
    # PROCESSING so the conversation can be retried.
```

Comment:

@MorhafAlshibly:
is there a mechanism to retry the PROCESSING conversations even when acking the the notification
````

Replies in the thread are included too, along with any suggested changes.

## Install (unpacked, for development)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder.
4. Open any GitHub PR — a copy button appears in the PR header, and a **Copy as prompt** button on each review thread.

## Settings

Open the extension's options (right-click the toolbar icon → **Options**, or via `chrome://extensions` → **Details** → **Extension options**) to toggle:

- **Include line counts** — the diffstat, e.g. _(+243 / -12)_, in the copied link.
- **“Copy as prompt” on review comments** — the per-thread button.

Both are on by default.

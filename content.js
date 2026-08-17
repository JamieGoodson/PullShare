// Injects a "Copy MD" button into the GitHub PR header that copies the PR
// title and URL to the clipboard as an HTML link (<a href="url">title</a>),
// with a markdown link as the plain-text fallback. Slack's desktop app reads
// the text/html flavor on paste and renders it as a proper hyperlink.

const BUTTON_ID = "gh-pr-md-copy-btn";
const PROMPT_BUTTON_CLASS = "gh-pr-prompt-copy-btn";

// Setting keys and their defaults, shared with the options page.
// `showLineCounts` controls whether the diffstat suffix (e.g. "(+256 / -2,531)")
// is appended; `showCopyAsPrompt` controls the per-review-thread button.
const SETTINGS_DEFAULTS = { showLineCounts: true, showCopyAsPrompt: true };

// Last known settings, kept in sync so the (synchronous) injection pass can
// decide whether to add prompt buttons without awaiting storage each time.
// Prompt buttons wait for the first read so a disabled setting never flashes
// them onto the page.
let settings = { ...SETTINGS_DEFAULTS };
let settingsLoaded = false;

// Reads settings from chrome.storage.sync, falling back to defaults if storage
// is unavailable (e.g. the API isn't present or the read fails).
async function getSettings() {
  try {
    return await chrome.storage.sync.get(SETTINGS_DEFAULTS);
  } catch (_) {
    return { ...SETTINGS_DEFAULTS };
  }
}

// Inlined so no web_accessible_resources entry is needed. Sized to 16px to
// match GitHub's octicons; uses currentColor to inherit the button color.
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
// Prompt glyph (lines feeding into a cursor), used on the "Copy as prompt"
// button. 14px to sit next to the small text label in a review thread header;
// fills with currentColor so it follows GitHub's light/dark button text.
const PROMPT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M6.08203 7.06934C5.67261 5.8408 6.84079 4.67261 8.06934 5.08203L13.9248 7.03418C15.2515 7.47678 15.3849 9.30482 14.1318 9.93164L12.0195 10.9873C12.0058 10.9942 11.9942 11.0058 11.9873 11.0195L10.9316 13.1309C10.3049 14.3841 8.47675 14.2516 8.03418 12.9248L6.08203 7.06934ZM7.52246 6.52246C7.51066 6.53426 7.50442 6.54638 7.50195 6.55566C7.50031 6.56203 7.49783 6.57343 7.50488 6.59473L9.45801 12.4502C9.46641 12.4754 9.47516 12.4831 9.47949 12.4863C9.48716 12.4919 9.50129 12.4985 9.52051 12.5C9.54003 12.5014 9.55532 12.4966 9.56348 12.4922C9.568 12.4898 9.57818 12.4842 9.58984 12.4609L10.6455 10.3486C10.7975 10.0446 11.0446 9.79754 11.3486 9.64551L13.4609 8.58984C13.4843 8.57812 13.4898 8.56794 13.4922 8.56348C13.4966 8.5553 13.5014 8.54005 13.5 8.52051C13.4985 8.50127 13.4919 8.48716 13.4863 8.47949C13.4831 8.47516 13.4753 8.46543 13.4502 8.45703L7.59473 6.50488C7.57357 6.49788 7.56205 6.50031 7.55566 6.50195C7.5464 6.50441 7.53425 6.51069 7.52246 6.52246Z"/><path d="M3.75 8a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h2Z"/><path d="M3.75 5a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h2Z"/><path d="M9.25 2a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h7.5Z"/></svg>';

// Returns the canonical PR URL (strips any #fragment or ?query).
function getCanonicalUrl() {
  return location.origin + location.pathname;
}

// Returns the PR title text, or null if it can't be found.
function getTitle() {
  // New React PageHeader markup; falls back to the legacy selector.
  const el =
    document.querySelector('[data-component="PH_Title"] .markdown-title') ||
    document.querySelector(".js-issue-title");
  const text = el && el.textContent.trim();
  return text || null;
}

// Returns { additions, deletions } from the PR header diffstat (e.g.
// { additions: 132, deletions: 2531 }). Either field is null when not found.
function getDiffStat() {
  // Prefer the screen-reader summary ("Lines changed: 132 additions & 2531
  // deletions"), which carries the unabbreviated numbers and is the most
  // stable across GitHub's markup revisions.
  for (const el of document.querySelectorAll(".sr-only")) {
    const text = el.textContent;
    const add = text.match(/([\d,]+)\s+additions?/i);
    const del = text.match(/([\d,]+)\s+deletions?/i);
    if (add || del) {
      return {
        additions: add ? parseInt(add[1].replace(/,/g, ""), 10) : null,
        deletions: del ? parseInt(del[1].replace(/,/g, ""), 10) : null,
      };
    }
  }
  // Fall back to the colored "+N"/"-N" spans (new fgColor-* classes, older
  // color-fg-* / text-green / text-red names).
  const parse = (el) => {
    if (!el) return null;
    const m = el.textContent.replace(/,/g, "").match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  };
  return {
    additions: parse(
      document.querySelector(".fgColor-success") ||
        document.querySelector("#diffstat .color-fg-success") ||
        document.querySelector("#diffstat .text-green")
    ),
    deletions: parse(
      document.querySelector(".fgColor-danger") ||
        document.querySelector("#diffstat .color-fg-danger") ||
        document.querySelector("#diffstat .text-red")
    ),
  };
}

// Escapes a string for safe interpolation into HTML attribute/text contexts.
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Copies a link to the clipboard as both text/html (an anchor tag) and
// text/plain (a markdown link). Apps that understand rich text — like the
// Slack desktop app — pick up the HTML flavor and render a real hyperlink;
// everything else falls back to the markdown. Falls back to execCommand with
// a copy event listener when the async ClipboardItem API is unavailable.
async function copyLink(title, url, stat) {
  // Build the diffstat suffix, e.g. "(+256 / -2,531)". Each side is included
  // only when non-zero, so a deletions-only PR reads "(-2,531)" and a PR with
  // no line changes gets no suffix at all. Rendered italic, after the link.
  const fmt = (n) => n.toLocaleString("en-US");
  const parts = [];
  if (stat && stat.additions) parts.push(`+${fmt(stat.additions)}`);
  if (stat && stat.deletions) parts.push(`-${fmt(stat.deletions)}`);
  const diff = parts.join(" / ");
  const htmlSuffix = diff ? ` <i>(${diff})</i>` : "";
  const mdSuffix = diff ? ` _(${diff})_` : "";
  const html = `<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>${htmlSuffix}`;
  const markdown = `[${title}](${url})${mdSuffix}`;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch (e) {
    const onCopy = (ev) => {
      ev.clipboardData.setData("text/html", html);
      ev.clipboardData.setData("text/plain", markdown);
      ev.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }
    document.removeEventListener("copy", onCopy);
    return ok;
  }
}

async function onClick(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  const title = getTitle();
  if (!title) {
    flash(btn, "No title found");
    return;
  }
  // Append the diffstat (italic) when available and enabled in settings,
  // e.g. "Add endpoint (+243 / -12)".
  const { showLineCounts } = await getSettings();
  const stat = showLineCounts ? getDiffStat() : null;
  const ok = await copyLink(title, getCanonicalUrl(), stat);
  flash(btn, ok);
}

// Briefly swaps the icon to a checkmark (or keeps the copy icon on failure)
// and updates the tooltip, then restores the original state.
function flash(btn, ok) {
  btn.innerHTML = ok ? CHECK_ICON : COPY_ICON;
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => {
    btn.innerHTML = COPY_ICON;
    btn.title = btn.dataset.label;
  }, 1500);
}

// ---------------------------------------------------------------------------
// "Copy as prompt" — copies a review thread (file path, the diff lines it is
// anchored to, and every comment in the thread) as plain text ready to paste
// into Claude.
// ---------------------------------------------------------------------------

// The PR URL without any /files, /commits, … suffix, so thread permalinks
// (#discussion_rNNN) resolve to the Conversation tab.
function getPrUrl() {
  const m = location.pathname.match(/^(.*\/pull\/\d+)/);
  return location.origin + (m ? m[1] : location.pathname);
}

// The file the thread is anchored to. Review threads on the Conversation tab
// carry it in the header link; on the Files tab it comes from the enclosing
// file container.
function getThreadPath(thread) {
  const link = thread.querySelector("a.text-mono");
  if (link && link.textContent.trim()) return link.textContent.trim();

  // Hidden inputs on the reply / suggestion forms.
  for (const input of thread.querySelectorAll('input[name="path"]')) {
    if (input.value) return input.value;
  }

  const file = thread.closest("[data-tagsearch-path], [data-path], .file");
  if (!file) return null;
  const attr =
    file.getAttribute("data-tagsearch-path") || file.getAttribute("data-path");
  if (attr) return attr;
  const info = file.querySelector(".file-info a, .file-header a.Link--primary");
  return (info && (info.title || info.textContent.trim())) || null;
}

// Removes the indentation shared by every non-blank line, so a deeply nested
// snippet reads cleanly in the pasted prompt.
function dedent(lines) {
  let min = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    min = Math.min(min, line.match(/^[ \t]*/)[0].length);
  }
  if (!isFinite(min) || min === 0) return lines;
  return lines.map((line) => line.slice(min));
}

// Turns diff-table rows into { code, first, last }, or null if none of them
// hold code. When the rows combine additions, deletions and/or context the +/-
// prefixes are kept so the change stays legible; a single-sided hunk is copied
// as plain code. Line numbers come from the new-file (right) side where one
// exists, so the reported range matches the file on disk.
function rowsToCode(rows) {
  const entries = [];
  for (const tr of rows) {
    const cell = tr.querySelector(".blob-code-inner");
    if (!cell) continue;

    // Newer markup puts the diff character in an attribute (rendered via CSS);
    // older markup encodes it in a class.
    const deletion = !!tr.querySelector(".blob-code-deletion");
    const marker =
      cell.getAttribute("data-code-marker") ||
      (tr.querySelector(".blob-code-addition") ? "+" : deletion ? "-" : " ");

    let text = cell.textContent.replace(/\n+$/, "");
    if (cell.hasAttribute("data-code-marker") && text.startsWith(marker)) {
      text = text.slice(marker.length);
    }

    const cells = [...tr.querySelectorAll("td[data-line-number]")];
    const numCell = cells[cells.length - 1] || null;
    entries.push({
      marker,
      text,
      num: numCell
        ? parseInt(numCell.getAttribute("data-line-number"), 10)
        : null,
      // A deleted line's number refers to the base revision, not the new file.
      isNew: !deletion,
    });
  }
  if (!entries.length) return null;

  const numbers = entries
    .filter((e) => e.isNew && Number.isFinite(e.num))
    .map((e) => e.num);
  const mixed = new Set(entries.map((e) => e.marker)).size > 1;
  const body = dedent(entries.map((e) => e.text));

  return {
    code: entries
      .map((e, i) => (mixed ? `${e.marker}${body[i]}` : body[i]))
      .join("\n"),
    first: numbers.length ? Math.min(...numbers) : null,
    last: numbers.length ? Math.max(...numbers) : null,
  };
}

// On the Files tab a thread lives in a row of the file's own diff table rather
// than carrying its own copy of the hunk, so the commented line is the nearest
// code row above it. Other comment rows in between are skipped; a hunk header
// or the top of the table ends the search.
function getEnclosingDiffCode(thread) {
  const row = thread.closest("tr");
  if (!row) return null;
  for (let prev = row.previousElementSibling; prev; prev = prev.previousElementSibling) {
    if (prev.querySelector(".blob-code-inner")) return rowsToCode([prev]);
    if (!prev.querySelector(".js-comment-body")) return null;
  }
  return null;
}

// The code a thread is anchored to, or null when it isn't in the DOM (GitHub
// loads some hunks lazily). `:scope` matters here: without it the selector also
// matches rows whose diff-table ancestor sits *outside* the thread, which is
// exactly the case on the Files tab.
function getThreadCode(thread) {
  const own = [...thread.querySelectorAll(":scope table.diff-table tr")].filter(
    // Suggested changes render their own diff rows inside the comment body.
    (tr) => !tr.closest(".js-comment-body, .js-suggested-changes-blob")
  );
  return own.length ? rowsToCode(own) : getEnclosingDiffCode(thread);
}

// Converts a rendered comment body to rough markdown: code blocks stay fenced,
// list items keep their bullets, everything else becomes plain paragraphs.
function commentToText(body) {
  const blocks = body.children.length ? [...body.children] : [body];
  const parts = [];
  for (const node of blocks) {
    const tag = node.tagName;
    if (tag === "PRE") {
      parts.push("```\n" + node.textContent.replace(/\n+$/, "") + "\n```");
    } else if (tag === "UL" || tag === "OL") {
      parts.push(
        [...node.querySelectorAll("li")]
          .map((li) => `- ${li.textContent.trim()}`)
          .join("\n")
      );
    } else if (node.querySelector(".blob-code-inner")) {
      // A suggested change: keep only the proposed (addition) lines.
      const suggested = [...node.querySelectorAll("tr")]
        .filter((tr) => tr.querySelector(".blob-code-addition"))
        .map((tr) => tr.querySelector(".blob-code-inner").textContent);
      if (suggested.length) {
        parts.push(
          "Suggested change:\n```\n" + dedent(suggested).join("\n") + "\n```"
        );
      }
    } else {
      parts.push(node.textContent.trim());
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

// Every comment in the thread, oldest first, as { author, text, url }.
function getThreadComments(thread) {
  const comments = [];
  for (const body of thread.querySelectorAll(".js-comment-body")) {
    const container = body.closest(".js-comment") || thread;
    const author = container.querySelector("a.author");
    const permalink = container.querySelector('a[href*="#discussion_r"]');
    const text = commentToText(body);
    if (!text) continue;
    comments.push({
      author: author ? author.textContent.trim() : null,
      text,
      url: permalink ? getPrUrl() + "#" + permalink.href.split("#").pop() : null,
    });
  }
  return comments;
}

// Assembles the prompt text for a review thread.
function buildPrompt(thread) {
  const comments = getThreadComments(thread);
  if (!comments.length) return null;

  const path = getThreadPath(thread);
  const code = getThreadCode(thread);
  const title = getTitle();

  const lines = ["Please address this GitHub PR review comment.", ""];
  if (title) lines.push(`PR: ${title}`);
  lines.push(`Link: ${comments[0].url || getPrUrl()}`);
  if (path) lines.push(`File: ${path}`);
  if (code && code.first) {
    lines.push(
      code.first === code.last
        ? `Line: ${code.first}`
        : `Lines: ${code.first}-${code.last}`
    );
  }
  if (code) {
    lines.push("", "```", code.code, "```");
  }

  lines.push("", "", comments.length > 1 ? "Comments:" : "Comment:");
  for (const c of comments) {
    lines.push("", `${c.author ? "@" + c.author : "Reviewer"}:`, c.text);
  }
  return lines.join("\n") + "\n";
}

// Copies plain text, falling back to execCommand where the async API is
// blocked (e.g. when the document isn't focused).
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const onCopy = (ev) => {
      ev.clipboardData.setData("text/plain", text);
      ev.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (__) {
      ok = false;
    }
    document.removeEventListener("copy", onCopy);
    return ok;
  }
}

// Briefly shows the outcome on a prompt button, then restores its label.
function flashPrompt(btn, ok) {
  btn.innerHTML = ok ? CHECK_ICON : PROMPT_ICON;
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => {
    btn.innerHTML = PROMPT_ICON;
  }, 1500);
}

async function onPromptClick(e) {
  e.preventDefault();
  e.stopPropagation(); // Don't collapse the thread we were clicked inside.
  const btn = e.currentTarget;
  const thread = btn.closest("[data-pullshare-thread]");
  const prompt = thread && buildPrompt(thread);
  if (!prompt) {
    flashPrompt(btn, false);
    return;
  }
  const ok = await copyText(prompt);
  flashPrompt(btn, ok);
}

// Review threads, deduped: `review-thread-collapsible` also carries the
// `js-resolvable-timeline-thread-container` class and wraps a `.js-line-comments`
// block, so keep only the outermost match.
function findReviewThreads() {
  const candidates = [
    ...document.querySelectorAll(
      "review-thread-collapsible, .js-resolvable-timeline-thread-container, .js-line-comments"
    ),
  ];
  return candidates.filter(
    (el) => !candidates.some((other) => other !== el && other.contains(el))
  );
}

// Adds a "Copy as prompt" button to each review thread that doesn't have one.
function injectPromptButtons() {
  if (!settingsLoaded || !settings.showCopyAsPrompt) return;

  for (const thread of findReviewThreads()) {
    if (thread.querySelector("." + PROMPT_BUTTON_CLASS)) continue;
    if (!thread.querySelector(".js-comment-body")) continue; // No comments yet.

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${PROMPT_BUTTON_CLASS} btn btn-sm`;
    btn.innerHTML = PROMPT_ICON;
    btn.title = "Copy this review comment, file path and code as a prompt";
    btn.addEventListener("click", onPromptClick);
    thread.setAttribute("data-pullshare-thread", "");

    // Preferred home: the thread header, to the right of the file path.
    const pathLink = thread.querySelector("a.text-mono");
    const actions = thread.querySelector(".timeline-comment-actions");
    if (pathLink && pathLink.parentElement) {
      pathLink.parentElement.after(btn);
    } else if (actions) {
      actions.prepend(btn);
    }
  }
}

// Drops the buttons again when the setting is turned off.
function removePromptButtons() {
  for (const btn of document.querySelectorAll("." + PROMPT_BUTTON_CLASS)) {
    btn.remove();
  }
}

// Inserts the button into the PR header if it isn't already there.
function injectButton() {
  if (document.getElementById(BUTTON_ID)) return;

  // The actions container holds the merge-status/Code buttons on the PR header.
  // New React markup first, then the legacy selector.
  const actions =
    document.querySelector('[data-component="PH_Actions"] .d-flex') ||
    document.querySelector('[data-component="PH_Actions"]') ||
    document.querySelector(".gh-header-actions");
  const titleEl =
    document.querySelector('[data-component="PH_Title"]') ||
    document.querySelector(".js-issue-title");
  if (!titleEl) return; // Not a PR page (or header not yet rendered).

  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.className = "btn btn-sm";
  btn.innerHTML = COPY_ICON;
  btn.setAttribute("aria-label", "Copy PR as a share-ready link");
  btn.dataset.label = "Copy PR as a share-ready link";
  btn.title = btn.dataset.label;
  btn.addEventListener("click", onClick);

  if (actions) {
    actions.insertBefore(btn, actions.firstChild);
  } else {
    // Fallback: place it next to the title.
    titleEl.parentElement.appendChild(btn);
  }
}

// Runs both injections. Debounced, because the MutationObserver below fires
// often on a busy PR page (and once for our own insertions).
let injectTimer = null;
function inject() {
  clearTimeout(injectTimer);
  injectTimer = setTimeout(() => {
    injectButton();
    injectPromptButtons();
  }, 50);
}

// GitHub uses pjax/Turbo for in-page navigation, so re-inject on those events
// and observe DOM changes to survive header re-renders and lazily-loaded
// review threads.
inject();
getSettings().then((loaded) => {
  settings = loaded;
  settingsLoaded = true;
  if (settings.showCopyAsPrompt) inject();
});

document.addEventListener("pjax:end", inject);
document.addEventListener("turbo:render", inject);
document.addEventListener("turbo:load", inject);

const observer = new MutationObserver(inject);
observer.observe(document.body, { childList: true, subtree: true });

// Reflect option changes without a reload.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      settings[key] = newValue;
    }
    if (settings.showCopyAsPrompt) inject();
    else removePromptButtons();
  });
} catch (_) {
  // Storage events unavailable; the settings read above still applies.
}

// Injects a "Copy MD" button into the GitHub PR header that copies the PR
// title and URL to the clipboard as an HTML link (<a href="url">title</a>),
// with a markdown link as the plain-text fallback. Slack's desktop app reads
// the text/html flavor on paste and renders it as a proper hyperlink.

const BUTTON_ID = "gh-pr-md-copy-btn";

// Inlined so no web_accessible_resources entry is needed. Sized to 16px to
// match GitHub's octicons; uses currentColor to inherit the button color.
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

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
  // Append the diffstat (italic) when available, e.g. "Add endpoint (+243 / -12)".
  const ok = await copyLink(title, getCanonicalUrl(), getDiffStat());
  flash(btn, ok);
}

// Briefly swaps the icon to a checkmark (or keeps the copy icon on failure)
// and updates the tooltip, then restores the original state.
function flash(btn, ok) {
  btn.innerHTML = ok ? CHECK_ICON : COPY_ICON;
  btn.title = ok ? "Copied!" : "Copy failed";
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => {
    btn.innerHTML = COPY_ICON;
    btn.title = btn.dataset.label;
  }, 1500);
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
  btn.setAttribute("aria-label", "Copy PR title and URL as a markdown link");
  btn.dataset.label = "Copy PR title and URL as a markdown link";
  btn.title = btn.dataset.label;
  btn.addEventListener("click", onClick);

  if (actions) {
    actions.insertBefore(btn, actions.firstChild);
  } else {
    // Fallback: place it next to the title.
    titleEl.parentElement.appendChild(btn);
  }
}

// GitHub uses pjax/Turbo for in-page navigation, so re-inject on those events
// and observe DOM changes to survive header re-renders.
injectButton();

document.addEventListener("pjax:end", injectButton);
document.addEventListener("turbo:render", injectButton);
document.addEventListener("turbo:load", injectButton);

const observer = new MutationObserver(() => injectButton());
observer.observe(document.body, { childList: true, subtree: true });

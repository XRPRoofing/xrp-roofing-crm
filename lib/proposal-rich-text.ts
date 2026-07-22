// Backward-compatible rich text for proposal scope / notes.
//
// Existing proposals store scope as PLAIN TEXT (rendered with
// `whitespace-pre-line`). The editor can now also produce lightweight HTML
// (bold, bullet / numbered lists). To avoid changing how existing proposals
// look, everything runs through these helpers:
//   - plain-text content keeps rendering exactly as before;
//   - HTML content is sanitized down to a tiny safe allowlist before it is
//     shown on the public customer page.
//
// No new dependencies: the sanitizer is a conservative allowlist that only
// keeps the formatting tags the editor itself emits and strips everything
// else (scripts, attributes, styles, event handlers, etc.).

const ALLOWED_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ul",
  "ol",
  "li",
  "p",
  "br",
  "div",
  "span",
]);

/** Does this string contain the formatting markup our editor emits? */
export function isHtmlContent(value: string | undefined | null): boolean {
  if (!value) return false;
  return /<(b|strong|i|em|u|ul|ol|li|p|br|div|span)(\s|>|\/)/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Convert stored plain text into equivalent HTML (line breaks preserved). */
export function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/**
 * Sanitize editor HTML to a safe allowlist. Removes disallowed tags (keeping
 * their text), and strips ALL attributes so no inline styles / event handlers /
 * javascript: URLs can reach the public proposal page.
 */
export function sanitizeProposalHtml(value: string): string {
  if (!value) return "";
  let out = value;
  // Drop entire dangerous blocks (script/style and their contents).
  out = out.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  // Rewrite every remaining tag: keep it only if allowed, and drop attributes.
  out = out.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g, (_match, slash: string, rawTag: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    return `<${slash ? "/" : ""}${tag}>`;
  });
  return out;
}

/** Render-ready HTML for either plain-text or HTML content. */
export function toRenderableHtml(value: string | undefined | null): string {
  if (!value) return "";
  return isHtmlContent(value) ? sanitizeProposalHtml(value) : plainTextToHtml(value);
}

/** Flatten HTML content back to plain text (for search, snippets, exports). */
export function htmlToPlainText(value: string | undefined | null): string {
  if (!value) return "";
  if (!isHtmlContent(value)) return value;
  return value
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Shared parser for line-item / scope-of-work text so it renders as a clean,
 * professional list instead of one bold paragraph. Authors type plain text with
 * line breaks and optional markers:
 *   - "•", "-" or "*"        -> bullet list
 *   - "1." / "1)" etc.       -> numbered list
 *   - anything else          -> paragraph (consecutive lines are joined)
 * The same parsed blocks are rendered on the customer invoice page (React) and
 * the PDF export (HTML string), so formatting is preserved in both.
 */

export type ScopeBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "numbers"; items: string[] };

export function parseScope(text: string): ScopeBlock[] {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ScopeBlock[] = [];

  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
    if (bullets.length) {
      blocks.push({ type: "bullets", items: bullets });
      bullets = [];
    }
    if (numbers.length) {
      blocks.push({ type: "numbers", items: numbers });
      numbers = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }

    const bullet = line.match(/^[-•*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);

    if (bullet) {
      if (paragraph.length || numbers.length) flush();
      bullets.push(bullet[1].trim());
    } else if (numbered) {
      if (paragraph.length || bullets.length) flush();
      numbers.push(numbered[1].trim());
    } else {
      if (bullets.length || numbers.length) flush();
      paragraph.push(line);
    }
  }

  flush();
  return blocks;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Render scope text as an escaped HTML fragment for the PDF export. */
export function scopeToHtml(text: string): string {
  const blocks = parseScope(text);
  if (!blocks.length) return "";

  return blocks
    .map((block) => {
      if (block.type === "paragraph") {
        return `<p style="margin:0 0 8px;">${escapeHtml(block.text)}</p>`;
      }
      const tag = block.type === "bullets" ? "ul" : "ol";
      const items = block.items.map((item) => `<li style="margin:0 0 4px;">${escapeHtml(item)}</li>`).join("");
      return `<${tag} style="margin:0 0 8px;padding-left:20px;">${items}</${tag}>`;
    })
    .join("");
}

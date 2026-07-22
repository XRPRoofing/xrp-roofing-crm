import { toRenderableHtml } from "@/lib/proposal-rich-text";

/**
 * Read-only renderer for proposal scope / notes. Plain-text content renders
 * exactly as before (line breaks preserved); HTML content is sanitized to a
 * safe allowlist first.
 */
export default function ProposalRichContent({
  value,
  className,
}: {
  value: string | undefined | null;
  className?: string;
}) {
  const html = toRenderableHtml(value);
  return (
    <div
      className={`proposal-rich-content whitespace-pre-line ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

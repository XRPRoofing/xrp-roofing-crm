import { parseScope } from "@/lib/scope-format";

/**
 * Renders line-item / scope text as clean paragraphs and bullet/numbered lists
 * with normal font weight (no bold blocks), wrapping nicely on mobile.
 */
export default function ScopeText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseScope(text);

  if (!blocks.length) return null;

  return (
    <div className={`space-y-2 text-sm font-normal leading-6 text-slate-700 ${className}`}>
      {blocks.map((block, index) => {
        if (block.type === "paragraph") {
          return (
            <p key={index} className="break-words">
              {block.text}
            </p>
          );
        }

        if (block.type === "bullets") {
          return (
            <ul key={index} className="list-disc space-y-1 break-words pl-5 marker:text-blue-600">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }

        return (
          <ol key={index} className="list-decimal space-y-1 break-words pl-5 marker:font-semibold marker:text-blue-600">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}

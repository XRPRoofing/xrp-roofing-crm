"use client";

import { useEffect, useRef } from "react";
import { isHtmlContent, plainTextToHtml, toRenderableHtml } from "@/lib/proposal-rich-text";

type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
};

type Command = "bold" | "insertUnorderedList" | "insertOrderedList" | "undo" | "redo";

function exec(command: Command) {
  // execCommand is deprecated but remains the most broadly supported way to do
  // inline formatting inside a contentEditable across desktop + mobile browsers.
  document.execCommand(command);
}

/**
 * Stable rich-text editor for proposal scope / notes.
 *
 * It is intentionally UNCONTROLLED: React never rewrites the DOM while the user
 * types, which is what previously caused the cursor to jump and text to
 * disappear. We seed `innerHTML` only when the incoming `value` differs from
 * what this instance last emitted (e.g. loading a proposal, applying a
 * template, or another synced editor changing it), and we push changes up on
 * input + blur so nothing is lost when switching sections or tapping away.
 */
export default function RichTextEditor({
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  className,
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastEmitted = useRef<string>("\u0000");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastEmitted.current) {
      el.innerHTML = value ? (isHtmlContent(value) ? toRenderableHtml(value) : plainTextToHtml(value)) : "";
      lastEmitted.current = value;
    }
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML === "<br>" ? "" : el.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  }

  function runCommand(command: Command) {
    if (disabled) return;
    ref.current?.focus();
    exec(command);
    emit();
  }

  return (
    <div className={className}>
      {!disabled && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-1">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("bold")} className="h-7 w-7 rounded text-sm font-bold text-gray-700 transition hover:bg-white" title="Bold" aria-label="Bold">B</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("insertUnorderedList")} className="h-7 w-7 rounded text-base text-gray-700 transition hover:bg-white" title="Bulleted list" aria-label="Bulleted list">•</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("insertOrderedList")} className="h-7 w-7 rounded text-xs font-semibold text-gray-700 transition hover:bg-white" title="Numbered list" aria-label="Numbered list">1.</button>
          <span className="mx-0.5 h-5 w-px bg-gray-200" />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("undo")} className="h-7 w-7 rounded text-sm text-gray-700 transition hover:bg-white" title="Undo" aria-label="Undo">↶</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("redo")} className="h-7 w-7 rounded text-sm text-gray-700 transition hover:bg-white" title="Redo" aria-label="Redo">↷</button>
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        className={`proposal-rich-text min-h-[8rem] w-full rounded-md border border-gray-200 px-3 py-2 text-sm normal-case leading-7 tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50 ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white"}`}
      />
    </div>
  );
}

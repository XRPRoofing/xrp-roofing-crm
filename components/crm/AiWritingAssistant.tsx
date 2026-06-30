"use client";

import { useCallback, useState } from "react";
import { Sparkles, X, RotateCcw, Copy, Check, ChevronDown, ChevronRight, Wand2, Send } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AiAction = { label: string; instruction: string };

type AiActionGroup = { title: string; actions: AiAction[] };

interface AiWriteButtonProps {
  /** Current text content from the associated textarea */
  getText: () => string;
  /** Callback to replace the textarea content with AI result */
  onReplace: (text: string) => void;
  /** Callback to insert AI result below existing content */
  onInsert?: (text: string) => void;
  /** Optional context hint (e.g. "proposal scope of work") */
  context?: string;
  /** Optional className for the button */
  className?: string;
  /** Button size variant */
  size?: "sm" | "md";
}

// ---------------------------------------------------------------------------
// Preset action groups
// ---------------------------------------------------------------------------

const REWRITE_ACTIONS: AiAction[] = [
  { label: "Make Professional", instruction: "Rewrite this text to sound more professional and polished." },
  { label: "Make Friendly", instruction: "Rewrite this text to sound warm, friendly, and approachable." },
  { label: "Make Shorter", instruction: "Rewrite this text to be significantly shorter while keeping the key points." },
  { label: "Make Longer", instruction: "Expand this text with more detail while keeping the same meaning." },
  { label: "Make More Clear", instruction: "Rewrite this text to be clearer and easier to understand." },
  { label: "Fix Grammar & Spelling", instruction: "Fix all grammar, spelling, and punctuation errors. Keep the meaning and tone the same." },
  { label: "Simplify", instruction: "Simplify this text so a homeowner with no roofing knowledge can easily understand it." },
  { label: "Add More Detail", instruction: "Add more specific detail and information to this text." },
  { label: "Improve Readability", instruction: "Improve the readability of this text. Use shorter sentences and clearer structure." },
];

const ROOFING_ACTIONS: AiAction[] = [
  { label: "Write Scope of Work", instruction: "Write a professional roofing Scope of Work based on these notes. Use proper roofing terminology and organize into clear sections." },
  { label: "Improve Scope of Work", instruction: "Improve this Scope of Work to be more professional, detailed, and well-organized. Keep all roofing terminology accurate." },
  { label: "Generate Proposal Summary", instruction: "Generate a professional proposal summary for a roofing project based on this text." },
  { label: "Homeowner-Friendly Language", instruction: "Rewrite this using homeowner-friendly language. Explain any roofing terms in simple words." },
  { label: "Generate Warranty Wording", instruction: "Generate professional warranty wording for a roofing project based on this text." },
  { label: "Write Inspection Findings", instruction: "Write professional inspection findings based on these notes. Be specific and organized." },
  { label: "Insurance Supplement Explanation", instruction: "Write a clear explanation of this insurance supplement for the homeowner." },
  { label: "Follow-Up After Inspection", instruction: "Write a professional follow-up message to send after a roof inspection." },
  { label: "Appointment Reminder", instruction: "Write a friendly appointment reminder message based on this text." },
  { label: "Payment Reminder", instruction: "Write a professional but friendly payment reminder based on this text." },
  { label: "Thank-You Message", instruction: "Write a sincere thank-you message to a customer based on this context." },
  { label: "Review Request", instruction: "Write a friendly message requesting a Google review from a satisfied customer." },
];

const ACTION_GROUPS: AiActionGroup[] = [
  { title: "Rewrite", actions: REWRITE_ACTIONS },
  { title: "Roofing-Specific", actions: ROOFING_ACTIONS },
];

// ---------------------------------------------------------------------------
// AI API call
// ---------------------------------------------------------------------------

async function callAiRewrite(
  text: string,
  instruction: string,
  context?: string,
): Promise<string> {
  const res = await fetch("/api/ai/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, instruction, context }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((err as { error?: string }).error || `Request failed (${res.status})`);
  }

  const data = (await res.json()) as { result: string };
  return data.result;
}

// ---------------------------------------------------------------------------
// AiWriteButton — the entry point rendered beside each textarea
// ---------------------------------------------------------------------------

export function AiWriteButton({
  getText,
  onReplace,
  onInsert,
  context,
  className = "",
  size = "sm",
}: AiWriteButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 font-bold text-purple-700 transition hover:border-purple-300 hover:bg-purple-100 active:scale-95 ${
          size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
        } ${className}`}
        title="AI Writing Assistant"
      >
        <Sparkles className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
        AI Assist
      </button>

      {open && (
        <AiWritingModal
          initialText={getText()}
          context={context}
          onReplace={(text) => {
            onReplace(text);
            setOpen(false);
          }}
          onInsert={
            onInsert
              ? (text) => {
                  onInsert(text);
                  setOpen(false);
                }
              : undefined
          }
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// AiWritingModal — full AI assistant UI
// ---------------------------------------------------------------------------

function AiWritingModal({
  initialText,
  context,
  onReplace,
  onInsert,
  onClose,
}: {
  initialText: string;
  context?: string;
  onReplace: (text: string) => void;
  onInsert?: (text: string) => void;
  onClose: () => void;
}) {
  const [originalText] = useState(initialText);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<string | null>("Rewrite");
  const [lastInstruction, setLastInstruction] = useState("");
  const runAction = useCallback(
    async (instruction: string) => {
      if (!originalText.trim()) {
        setError("No text to process. Please type something first.");
        return;
      }
      setLoading(true);
      setError("");
      setResult("");
      setCopied(false);
      setLastInstruction(instruction);
      try {
        const text = await callAiRewrite(originalText, instruction, context);
        setResult(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [originalText, context],
  );

  const handleRegenerate = useCallback(() => {
    if (lastInstruction) runAction(lastInstruction);
  }, [lastInstruction, runAction]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  const handleCustomSubmit = useCallback(() => {
    const trimmed = customPrompt.trim();
    if (trimmed) runAction(trimmed);
  }, [customPrompt, runAction]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            <h2 className="text-sm font-bold text-gray-900">AI Writing Assistant</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Action groups */}
          {ACTION_GROUPS.map((group) => (
            <div key={group.title}>
              <button
                type="button"
                onClick={() => setExpandedGroup(expandedGroup === group.title ? null : group.title)}
                className="flex w-full items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 transition hover:text-gray-700"
              >
                {expandedGroup === group.title ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {group.title}
              </button>
              {expandedGroup === group.title && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={loading}
                      onClick={() => runAction(action.instruction)}
                      className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700 disabled:opacity-50"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Custom prompt */}
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">Custom Instruction</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleCustomSubmit();
                  }
                }}
                placeholder='e.g. "Translate to Spanish" or "Make this more persuasive"'
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-purple-300 focus:bg-white"
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={loading || !customPrompt.trim()}
                className="shrink-0 rounded-lg bg-purple-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-purple-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Loading indicator */}
          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-purple-100 bg-purple-50 px-4 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600" />
              <span className="text-sm font-semibold text-purple-700">Generating...</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          {/* Preview: Original vs AI */}
          {result && !loading && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Original</p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                    {originalText}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-purple-500">AI Generated</p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                    {result}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onReplace(result)}
                  className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-purple-700"
                >
                  <Wand2 className="mr-1 inline h-3.5 w-3.5" />
                  Replace Original
                </button>
                {onInsert && (
                  <button
                    type="button"
                    onClick={() => onInsert(result)}
                    className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700 transition hover:bg-purple-100"
                  >
                    Insert Below
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-100"
                >
                  {copied ? (
                    <><Check className="mr-1 inline h-3.5 w-3.5 text-green-600" />Copied</>
                  ) : (
                    <><Copy className="mr-1 inline h-3.5 w-3.5" />Copy</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-100"
                >
                  <RotateCcw className="mr-1 inline h-3.5 w-3.5" />
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-2.5">
          <p className="text-[11px] text-gray-400">AI-generated content is a suggestion. Always review before using.</p>
        </div>
      </div>
    </div>
  );
}

export default AiWriteButton;

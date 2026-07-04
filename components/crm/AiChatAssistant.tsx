"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  X,
  Minus,
  Maximize2,
  RotateCcw,
  Copy,
  Check,
  Send,
  Trash2,
  ChevronDown,
  ChevronRight,
  Wand2,
  FileText,
  GripHorizontal,
} from "lucide-react";
import { useAiChat, type ChatMessage } from "./AiChatContext";

// ---------------------------------------------------------------------------
// Preset actions (same as existing AiWritingAssistant)
// ---------------------------------------------------------------------------

type AiAction = { label: string; instruction: string };
type AiActionGroup = { title: string; actions: AiAction[] };

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
  { label: "Insurance Supplement", instruction: "Write a clear explanation of this insurance supplement for the homeowner." },
  { label: "Follow-Up Message", instruction: "Write a professional follow-up message to send after a roof inspection." },
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

interface ChatHistoryMsg {
  role: "user" | "assistant";
  content: string;
}

async function callAiChat(
  message: string,
  history: ChatHistoryMsg[],
  currentPage?: string,
): Promise<string> {
  const res = await fetch("/api/ai/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "chat", message, messages: history, currentPage }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((err as { error?: string }).error || `Request failed (${res.status})`);
  }

  const data = (await res.json()) as { result: string };
  return data.result;
}

// ---------------------------------------------------------------------------
// Simple markdown renderer
// ---------------------------------------------------------------------------

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Bold
    line = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Italic
    line = line.replace(/\*(.*?)\*/g, "<em>$1</em>");
    // Inline code
    line = line.replace(/`(.*?)`/g, '<code class="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono">$1</code>');

    // Bullet list
    if (/^[\-\*]\s/.test(line)) {
      elements.push(
        <li key={i} className="ml-4 list-disc" dangerouslySetInnerHTML={{ __html: line.replace(/^[\-\*]\s/, "") }} />,
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      elements.push(
        <li key={i} className="ml-4 list-decimal" dangerouslySetInnerHTML={{ __html: line.replace(/^\d+\.\s/, "") }} />,
      );
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === "") {
      elements.push(<br key={i} />);
      continue;
    }

    elements.push(<p key={i} className="mb-1" dangerouslySetInnerHTML={{ __html: line }} />);
  }

  return <div className="text-sm leading-relaxed">{elements}</div>;
}

// ---------------------------------------------------------------------------
// Floating AI Button
// ---------------------------------------------------------------------------

export function AiFloatingButton() {
  const { isOpen, isMinimized, openChat, maximizeChat, messages } = useAiChat();

  if (isOpen && !isMinimized) return null;

  return (
    <button
      type="button"
      onClick={isMinimized ? maximizeChat : openChat}
      className="fixed bottom-[84px] right-6 z-[90] flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 hover:scale-105 active:scale-95 lg:bottom-6"
      title="AI Assistant"
    >
      <Sparkles className="h-5 w-5" />
      {messages.length > 0 && isMinimized && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {messages.filter((m) => m.role === "assistant").length}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat Panel
// ---------------------------------------------------------------------------

export function AiChatPanel() {
  const {
    isOpen,
    isMinimized,
    messages,
    pendingFieldContext,
    activeFieldContext,
    closeChat,
    minimizeChat,
    addMessage,
    clearMessages,
    confirmFieldContext,
    dismissFieldContext,
  } = useAiChat();

  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const sendMessage = useCallback(
    async (text: string, instruction?: string) => {
      if (!text.trim() && !instruction) return;

      // Build the user message content
      let userContent: string;
      if (instruction && activeFieldContext?.text) {
        // Quick action with field context: include both
        userContent = `${instruction}\n\nText:\n${activeFieldContext.text}`;
      } else if (instruction) {
        userContent = instruction;
      } else {
        userContent = text;
      }

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: userContent,
        timestamp: Date.now(),
      };
      addMessage(userMsg);
      setInput("");
      setLoading(true);
      setError("");

      try {
        // Build conversation history from existing messages
        const history: ChatHistoryMsg[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const result = await callAiChat(userContent, history, pathname);

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: result,
          timestamp: Date.now(),
          isApplyable: true,
        };
        addMessage(assistantMsg);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Something went wrong";
        setError(errMsg);
        const errorAssistantMsg: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: `⚠️ ${errMsg}`,
          timestamp: Date.now(),
        };
        addMessage(errorAssistantMsg);
      } finally {
        setLoading(false);
      }
    },
    [activeFieldContext, addMessage, messages, pathname],
  );

  const handleSubmit = useCallback(() => {
    if (input.trim()) sendMessage(input);
  }, [input, sendMessage]);

  const handleActionClick = useCallback(
    (instruction: string) => {
      if (!activeFieldContext?.text) {
        setError("No text loaded. Click 'Use Current Text' first or type your request.");
        return;
      }
      sendMessage(activeFieldContext.text, instruction);
      setShowActions(false);
    },
    [activeFieldContext, sendMessage],
  );

  const handleCopy = useCallback((text: string, id: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const handleReplace = useCallback(
    (text: string) => {
      if (activeFieldContext?.onReplace) {
        activeFieldContext.onReplace(text);
      }
    },
    [activeFieldContext],
  );

  const handleInsertBelow = useCallback(
    (text: string) => {
      if (activeFieldContext?.onInsert) {
        activeFieldContext.onInsert(text);
      }
    },
    [activeFieldContext],
  );

  const handleRegenerate = useCallback(
    (userMsgContent: string) => {
      sendMessage(activeFieldContext?.text || userMsgContent, userMsgContent);
    },
    [activeFieldContext, sendMessage],
  );

  // Drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;
      setDragging(true);
      const panelEl = (e.target as HTMLElement).closest("[data-ai-panel]");
      if (panelEl) {
        const rect = panelEl.getBoundingClientRect();
        dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
    },
    [isMaximized],
  );

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const handleUp = () => setDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  if (!isOpen || isMinimized) return null;

  return (
    <div
      data-ai-panel
      className={`${
        isMaximized
          ? "fixed inset-4 z-[95] flex flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
          : "fixed bottom-20 right-6 z-[95] flex w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl sm:max-h-[600px]"
      } ${!isMaximized && !position ? "max-h-[600px]" : ""}`}
      style={!isMaximized && position ? { left: position.x, top: position.y, bottom: "auto", right: "auto", maxHeight: "600px" } : undefined}
    >
      {/* Header */}
      <div
        className="flex shrink-0 cursor-grab items-center justify-between border-b border-gray-100 px-4 py-2.5 active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-3.5 w-3.5 text-gray-300" />
          <Sparkles className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-bold text-gray-900">AI Assistant</h2>
          {activeFieldContext && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              {activeFieldContext.fieldLabel || "Field loaded"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={clearMessages} className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600" title="Clear conversation">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={minimizeChat} className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600" title="Minimize">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setIsMaximized(!isMaximized)} className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600" title={isMaximized ? "Restore" : "Maximize"}>
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={closeChat} className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-red-500" title="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Pending field context confirmation */}
      {pendingFieldContext && (
        <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold text-blue-800">
            Share &ldquo;{pendingFieldContext.fieldLabel || "Current text"}&rdquo; with AI Assistant?
          </p>
          <p className="mb-2 line-clamp-2 text-xs text-blue-700 opacity-80">
            {pendingFieldContext.text.slice(0, 120)}{pendingFieldContext.text.length > 120 ? "..." : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmFieldContext}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700"
            >
              Use Current Text
            </button>
            <button
              type="button"
              onClick={dismissFieldContext}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 transition hover:bg-gray-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !pendingFieldContext && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-blue-300" />
            <p className="text-sm font-semibold text-gray-600">AI Writing Assistant</p>
            <p className="mt-1 text-xs text-gray-400">
              Ask me to help write proposals, emails, SMS messages, or improve any text.
            </p>
            <button
              type="button"
              onClick={() => setShowActions(!showActions)}
              className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-100"
            >
              Quick Actions
            </button>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-100 bg-gray-50 text-gray-800"
              }`}
            >
              {msg.role === "assistant" ? renderMarkdown(msg.content) : (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}

              {/* Apply actions for assistant messages */}
              {msg.role === "assistant" && msg.isApplyable && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-200 pt-2">
                  {activeFieldContext?.onReplace && (
                    <button
                      type="button"
                      onClick={() => handleReplace(msg.content)}
                      className="rounded bg-blue-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-blue-700"
                    >
                      <Wand2 className="mr-0.5 inline h-3 w-3" /> Replace
                    </button>
                  )}
                  {activeFieldContext?.onInsert && (
                    <button
                      type="button"
                      onClick={() => handleInsertBelow(msg.content)}
                      className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100"
                    >
                      Insert Below
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.content, msg.id)}
                    className="rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-bold text-gray-600 transition hover:bg-gray-50"
                  >
                    {copiedId === msg.id ? <><Check className="mr-0.5 inline h-3 w-3 text-green-600" />Copied</> : <><Copy className="mr-0.5 inline h-3 w-3" />Copy</>}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const prevUserMsg = messages.slice(0, idx).reverse().find((m) => m.role === "user");
                      if (prevUserMsg) handleRegenerate(prevUserMsg.content);
                    }}
                    className="rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-bold text-gray-600 transition hover:bg-gray-50"
                  >
                    <RotateCcw className="mr-0.5 inline h-3 w-3" /> Regenerate
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
              <span className="text-xs font-semibold text-blue-700">Thinking...</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && !loading && messages.length === 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions panel */}
      {showActions && (
        <div className="shrink-0 border-t border-gray-100 px-4 py-3 max-h-48 overflow-y-auto">
          {ACTION_GROUPS.map((group) => (
            <div key={group.title} className="mb-2">
              <button
                type="button"
                onClick={() => setExpandedGroup(expandedGroup === group.title ? null : group.title)}
                className="flex w-full items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-gray-500 transition hover:text-gray-700"
              >
                {expandedGroup === group.title ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {group.title}
              </button>
              {expandedGroup === group.title && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {group.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={loading}
                      onClick={() => handleActionClick(action.instruction)}
                      className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-semibold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowActions(!showActions)}
            className={`shrink-0 rounded-lg p-2 transition ${showActions ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
            title="Quick actions"
          >
            <FileText className="h-4 w-4" />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={activeFieldContext ? "Ask about the loaded text..." : "Type your request..."}
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
            disabled={loading}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            className="shrink-0 rounded-lg bg-blue-600 p-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
            title="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-gray-400">
          AI-generated content is a suggestion. Always review before using.
        </p>
      </div>
    </div>
  );
}

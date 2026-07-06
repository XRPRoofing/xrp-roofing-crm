"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  /** If this is an AI response, store for apply actions */
  isApplyable?: boolean;
}

export interface FieldContext {
  /** The text content from the active field */
  text: string;
  /** Label/description of the field (e.g. "Proposal Scope of Work") */
  fieldLabel?: string;
  /** Callback to replace the field's content */
  onReplace?: (text: string) => void;
  /** Callback to insert below the field's content */
  onInsert?: (text: string) => void;
}

/**
 * Structured context about the CRM record the user is currently viewing
 * (a customer, job, proposal, or invoice). Published by pages so the AI
 * assistant automatically understands who/what is being discussed.
 */
export interface RecordContext {
  /** Type of record: "Customer" | "Job" | "Proposal" | "Invoice" | etc. */
  kind: string;
  /** Primary label — usually the customer or record name */
  title?: string;
  /** Arbitrary key/value details (Proposal #, Address, Amount, Status, etc.) */
  details?: Record<string, string | number | null | undefined>;
}

interface AiChatContextValue {
  /** Whether the chat panel is open */
  isOpen: boolean;
  /** Whether the chat is minimized (button only) */
  isMinimized: boolean;
  /** Chat messages history */
  messages: ChatMessage[];
  /** Currently pending field context (user must confirm before sending) */
  pendingFieldContext: FieldContext | null;
  /** Active field context (confirmed and available for apply actions) */
  activeFieldContext: FieldContext | null;
  /** Open the chat panel */
  openChat: () => void;
  /** Close the chat panel */
  closeChat: () => void;
  /** Minimize the chat panel */
  minimizeChat: () => void;
  /** Maximize the chat panel (un-minimize) */
  maximizeChat: () => void;
  /** Toggle minimize state */
  toggleMinimize: () => void;
  /** Add a message to the conversation */
  addMessage: (msg: ChatMessage) => void;
  /** Clear all messages */
  clearMessages: () => void;
  /** Set pending field context (from AI Assist button click) */
  setPendingFieldContext: (ctx: FieldContext | null) => void;
  /** Confirm and activate the pending field context */
  confirmFieldContext: () => void;
  /** Dismiss pending field context without sending */
  dismissFieldContext: () => void;
  /** Set active field context directly */
  setActiveFieldContext: (ctx: FieldContext | null) => void;
  /** The CRM record the user is currently viewing (customer/job/proposal/invoice) */
  recordContext: RecordContext | null;
  /** Publish the currently-viewed CRM record so the AI is context-aware */
  setRecordContext: (ctx: RecordContext | null) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AiChatContext = createContext<AiChatContextValue | null>(null);

export function useAiChat() {
  const ctx = useContext(AiChatContext);
  if (!ctx) throw new Error("useAiChat must be used within AiChatProvider");
  return ctx;
}

/** Safe version that returns null instead of throwing when outside provider */
export function useAiChatSafe() {
  return useContext(AiChatContext);
}

/**
 * Publish the currently-viewed CRM record to the AI assistant so it is
 * automatically context-aware. Pass `null` (e.g. when no record is open) to
 * clear it. Automatically clears on unmount. Safe to call outside the
 * provider (no-op).
 *
 * Example:
 *   useAiRecordContext(selectedProposal ? {
 *     kind: "Proposal",
 *     title: selectedProposal.customerName,
 *     details: { "Proposal #": selectedProposal.proposalNumber, Address: selectedProposal.address, Amount: total, Status: selectedProposal.status },
 *   } : null);
 */
export function useAiRecordContext(ctx: RecordContext | null) {
  const chat = useContext(AiChatContext);
  const setRecordContext = chat?.setRecordContext;
  // Serialize so the effect only re-runs when the meaningful content changes.
  const serialized = ctx ? JSON.stringify(ctx) : null;
  useEffect(() => {
    if (!setRecordContext) return;
    setRecordContext(serialized ? (JSON.parse(serialized) as RecordContext) : null);
    return () => setRecordContext(null);
  }, [serialized, setRecordContext]);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AiChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingFieldContext, setPendingFieldContext] = useState<FieldContext | null>(null);
  const [activeFieldContext, setActiveFieldContext] = useState<FieldContext | null>(null);
  const [recordContext, setRecordContext] = useState<RecordContext | null>(null);

  const openChat = useCallback(() => {
    setIsOpen(true);
    setIsMinimized(false);
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
    setIsMinimized(false);
    setPendingFieldContext(null);
  }, []);

  const minimizeChat = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const maximizeChat = useCallback(() => {
    setIsMinimized(false);
  }, []);

  const toggleMinimize = useCallback(() => {
    setIsMinimized((prev) => !prev);
  }, []);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setActiveFieldContext(null);
  }, []);

  const confirmFieldContext = useCallback(() => {
    if (pendingFieldContext) {
      setActiveFieldContext(pendingFieldContext);
      setPendingFieldContext(null);
    }
  }, [pendingFieldContext]);

  const dismissFieldContext = useCallback(() => {
    setPendingFieldContext(null);
  }, []);

  return (
    <AiChatContext.Provider
      value={{
        isOpen,
        isMinimized,
        messages,
        pendingFieldContext,
        activeFieldContext,
        openChat,
        closeChat,
        minimizeChat,
        maximizeChat,
        toggleMinimize,
        addMessage,
        clearMessages,
        setPendingFieldContext,
        confirmFieldContext,
        dismissFieldContext,
        setActiveFieldContext,
        recordContext,
        setRecordContext,
      }}
    >
      {children}
    </AiChatContext.Provider>
  );
}

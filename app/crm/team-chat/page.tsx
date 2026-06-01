"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle, SendHorizonal, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatChatTimestamp, getInitials, teamChatRoomId, teamChatTableName, type TeamChatMessage } from "@/lib/team-chat";

function getUserName(metadata: Record<string, unknown> | undefined, email?: string) {
  if (typeof metadata?.full_name === "string" && metadata.full_name.trim()) return metadata.full_name.trim();
  if (typeof metadata?.name === "string" && metadata.name.trim()) return metadata.name.trim();
  return email?.split("@")[0] || "CRM User";
}

function getAvatarUrl(metadata: Record<string, unknown> | undefined) {
  if (typeof metadata?.avatar_url === "string" && metadata.avatar_url.trim()) return metadata.avatar_url.trim();
  if (typeof metadata?.picture === "string" && metadata.picture.trim()) return metadata.picture.trim();
  return null;
}

export default function TeamChatPage() {
  const supabase = useMemo(() => createClient(), []);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; avatarUrl: string | null } | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadChat() {
      setLoading(true);
      setError("");

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!mounted) return;

      if (userError || !userData.user) {
        setError("You must be logged in to use Team Chat.");
        setLoading(false);
        return;
      }

      setCurrentUser({
        id: userData.user.id,
        name: getUserName(userData.user.user_metadata, userData.user.email),
        avatarUrl: getAvatarUrl(userData.user.user_metadata),
      });

      const { data, error: messagesError } = await supabase
        .from(teamChatTableName)
        .select("id, room_id, user_id, user_name, user_avatar_url, message, created_at")
        .eq("room_id", teamChatRoomId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (!mounted) return;

      if (messagesError) {
        setError(`Team Chat database is not ready: ${messagesError.message}`);
        setLoading(false);
        return;
      }

      setMessages((data || []) as TeamChatMessage[]);
      setLoading(false);
    }

    loadChat();

    const channel = supabase
      .channel("team-chat-general")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: teamChatTableName, filter: `room_id=eq.${teamChatRoomId}` },
        (payload) => {
          const nextMessage = payload.new as TeamChatMessage;
          setMessages((currentMessages) => currentMessages.some((item) => item.id === nextMessage.id) ? currentMessages : [...currentMessages, nextMessage]);
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage || !currentUser) return;

    setSending(true);
    setError("");

    const { data, error: sendError } = await supabase
      .from(teamChatTableName)
      .insert({
        room_id: teamChatRoomId,
        user_id: currentUser.id,
        user_name: currentUser.name,
        user_avatar_url: currentUser.avatarUrl,
        message: trimmedMessage,
      })
      .select("id, room_id, user_id, user_name, user_avatar_url, message, created_at")
      .single();

    if (sendError) {
      setError(sendError.message);
      setSending(false);
      return;
    }

    if (data) {
      const savedMessage = data as TeamChatMessage;
      setMessages((currentMessages) => currentMessages.some((item) => item.id === savedMessage.id) ? currentMessages : [...currentMessages, savedMessage]);
    }

    setMessage("");
    setSending(false);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">Team Chat</p>
            <h1 className="mt-2 text-3xl font-black text-[#07183f]">General Chat</h1>
            <p className="mt-2 text-slate-600">One shared room for authenticated CRM users. No private messages, channels, or team setup.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-black text-blue-700">
            <UsersRound className="h-5 w-5" /> All CRM Users
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-orange-100 p-3 text-orange-600"><MessageCircle className="h-5 w-5" /></span>
            <div>
              <h2 className="font-black text-[#07183f]">General Chat</h2>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{messages.length} messages</p>
            </div>
          </div>
        </div>

        <div className="h-[55vh] space-y-4 overflow-y-auto bg-slate-50/70 p-4 sm:p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm font-bold text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading chat...</div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <MessageCircle className="h-12 w-12 text-orange-500" />
              <p className="mt-4 font-black text-[#07183f]">No messages yet</p>
              <p className="mt-1 text-sm text-slate-500">Start the General Chat with the first team update.</p>
            </div>
          ) : (
            messages.map((chatMessage) => {
              const isMine = chatMessage.user_id === currentUser?.id;
              return (
                <article key={chatMessage.id} className={`flex gap-3 ${isMine ? "flex-row-reverse" : ""}`}>
                  {chatMessage.user_avatar_url ? (
                    <img src={chatMessage.user_avatar_url} alt={chatMessage.user_name} className="h-11 w-11 rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#07183f] text-sm font-black text-white">{getInitials(chatMessage.user_name)}</div>
                  )}
                  <div className={`max-w-3xl rounded-3xl border px-4 py-3 shadow-sm ${isMine ? "border-blue-100 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-black ${isMine ? "text-blue-100" : "text-slate-500"}`}>
                      <span>{chatMessage.user_name}</span>
                      <span>{formatChatTimestamp(chatMessage.created_at)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6">{chatMessage.message}</p>
                  </div>
                </article>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{error}</div>
        )}

        <form onSubmit={sendMessage} className="flex gap-3 border-t border-slate-100 bg-white p-4">
          <input value={message} onChange={(event) => setMessage(event.target.value)} className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Message General Chat..." maxLength={1000} />
          <button disabled={sending || !message.trim() || !currentUser} className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
            Send
          </button>
        </form>
      </section>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AtSign, ImagePlus, Loader2, MessageCircle, SendHorizonal, SmilePlus, UsersRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { extractMentions, formatChatTimestamp, getInitials, markTeamChatRead, quickChatEmojis, teamChatRoomId, teamChatTableName, type TeamChatAttachment, type TeamChatMessage } from "@/lib/team-chat";

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

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderMessageText(message: string) {
  return message.split(/(@[\w.-]+)/g).map((part, index) => {
    if (part.startsWith("@")) {
      return <span key={`${part}-${index}`} className="rounded-full bg-orange-100 px-1.5 py-0.5 font-black text-orange-700">{part}</span>;
    }

    return part;
  });
}

export default function TeamChatPage() {
  const supabase = useMemo(() => createClient(), []);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<TeamChatAttachment[]>([]);
  const [showEmojis, setShowEmojis] = useState(false);
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
        .select("id, room_id, user_id, user_name, user_avatar_url, message, mentions, attachments, created_at")
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
      markTeamChatRead();
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
          markTeamChatRead();
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
    if ((!trimmedMessage && attachments.length === 0) || !currentUser) return;

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
        mentions: extractMentions(trimmedMessage),
        attachments,
      })
      .select("id, room_id, user_id, user_name, user_avatar_url, message, mentions, attachments, created_at")
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
    setAttachments([]);
    setShowEmojis(false);
    setSending(false);
  }

  async function handlePhotoUpload(files: FileList | null) {
    if (!files?.length) return;

    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, 4 - attachments.length);
    const nextAttachments = await Promise.all(imageFiles.map(async (file) => ({
      id: `${Date.now()}-${file.name}`,
      name: file.name,
      type: file.type,
      dataUrl: await fileToDataUrl(file),
    })));
    setAttachments((currentAttachments) => [...currentAttachments, ...nextAttachments].slice(0, 4));
  }

  function insertMention() {
    setMessage((currentMessage) => `${currentMessage}${currentMessage.endsWith(" ") || currentMessage.length === 0 ? "" : " "}@`);
  }

  return (
    <div className="flex h-[calc(100dvh-11.5rem)] flex-col gap-3 overflow-hidden lg:h-auto lg:gap-5 lg:overflow-visible">
      <section className="shrink-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
        <div className="flex items-center justify-between gap-3 lg:gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600 sm:text-sm">Team Chat</p>
            <h1 className="mt-1 text-xl font-black text-[#07183f] sm:mt-2 sm:text-3xl">General Chat</h1>
            <p className="crm-board-subtitle mt-2 hidden text-slate-600 sm:block">One shared room for authenticated CRM users. No private messages, channels, or team setup.</p>
          </div>
          <div className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 sm:px-4 sm:py-3 sm:text-sm">
            <UsersRound className="h-5 w-5" /> <span className="hidden sm:inline">All CRM Users</span>
          </div>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:rounded-[2rem]">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-orange-100 p-3 text-orange-600"><MessageCircle className="h-5 w-5" /></span>
            <div>
              <h2 className="font-black text-[#07183f]">General Chat</h2>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{messages.length} messages</p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-4 sm:p-6 lg:h-[55vh] lg:flex-none">
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
                    <Image src={chatMessage.user_avatar_url} alt={chatMessage.user_name} width={44} height={44} unoptimized className="h-11 w-11 rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#07183f] text-sm font-black text-white">{getInitials(chatMessage.user_name)}</div>
                  )}
                  <div className={`max-w-3xl rounded-3xl border px-4 py-3 shadow-sm ${isMine ? "border-blue-100 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-black ${isMine ? "text-blue-100" : "text-slate-500"}`}>
                      <span>{chatMessage.user_name}</span>
                      <span>{formatChatTimestamp(chatMessage.created_at)}</span>
                    </div>
                    {chatMessage.message && <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6">{renderMessageText(chatMessage.message)}</p>}
                    {chatMessage.attachments?.length > 0 && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {chatMessage.attachments.map((attachment) => (
                          <a key={attachment.id} href={attachment.dataUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-white/30 bg-white/10">
                            <Image src={attachment.dataUrl} alt={attachment.name} width={420} height={280} unoptimized className="h-40 w-full object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
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

        <form onSubmit={sendMessage} className="shrink-0 space-y-3 border-t border-slate-100 bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:p-4">
          {attachments.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-4">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="relative overflow-hidden rounded-2xl border border-slate-200">
                  <Image src={attachment.dataUrl} alt={attachment.name} width={240} height={160} unoptimized className="h-28 w-full object-cover" />
                  <button type="button" onClick={() => setAttachments((currentAttachments) => currentAttachments.filter((item) => item.id !== attachment.id))} className="absolute right-2 top-2 rounded-full bg-slate-950/70 p-1 text-white"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
          {showEmojis && (
            <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              {quickChatEmojis.map((emoji) => (
                <button key={emoji} type="button" onClick={() => setMessage((currentMessage) => `${currentMessage}${emoji}`)} className="rounded-xl bg-white px-3 py-2 text-xl shadow-sm hover:bg-orange-50">{emoji}</button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={insertMention} className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-[#07183f] hover:bg-white sm:p-3"><AtSign className="h-5 w-5" /></button>
            <button type="button" onClick={() => setShowEmojis((current) => !current)} className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-[#07183f] hover:bg-white sm:p-3"><SmilePlus className="h-5 w-5" /></button>
            <label className="shrink-0 cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-[#07183f] hover:bg-white sm:p-3">
              <ImagePlus className="h-5 w-5" />
              <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => handlePhotoUpload(event.target.files)} />
            </label>
            <input value={message} onChange={(event) => setMessage(event.target.value)} className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50 sm:px-4" placeholder="Message General Chat..." maxLength={1000} />
            <button disabled={sending || (!message.trim() && attachments.length === 0) || !currentUser} className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-orange-500 px-3 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

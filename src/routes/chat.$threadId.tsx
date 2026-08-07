import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { BrandLogo } from "@/components/BrandLogo";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ModeSelector } from "@/components/ModeSelector";
import { useSession } from "@/lib/auth";
import { isPremium, spendCredits, useHydrated } from "@/lib/storage";
import { MODES, type ChatMode } from "@/lib/models";
import { streamChat, type ChatRequestType, type SendMessage } from "@/lib/streamChat";
import {
  createConversation,
  deleteConversation,
  getConversation,
  insertMessage,
  listMessages,
  touchConversation,
  updateConversation,
  type Conversation,
  type Message,
} from "@/lib/conversations";
import { ArrowUp, Paperclip, Plus, Square, X, FileText, Loader2, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/chat/$threadId")({
  validateSearch: searchSchema,
  component: ChatPage,
});

type Attachment = { name: string; mime: string; dataUrl: string };

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(f);
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ChatPage() {
  const { threadId } = Route.useParams();
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const hydrated = useHydrated();
  const { user, loading: sessionLoading } = useSession();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState(q ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSentRef = useRef(false);

  useEffect(() => {
    if (!hydrated || !user) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const conv = await getConversation(threadId);
        if (!alive) return;
        if (!conv) {
          toast.error("Conversation not found");
          navigate({ to: "/history" });
          return;
        }
        setConversation(conv);
        const msgs = await listMessages(threadId);
        if (!alive) return;
        setMessages(msgs);
      } catch (e) {
        toast.error((e as Error).message || "Failed to load conversation");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [threadId, user, hydrated, navigate]);

  const setMode = useCallback(
    async (mode: ChatMode) => {
      if (!conversation) return;
      setConversation({ ...conversation, mode });
      try {
        await updateConversation(conversation.id, { mode });
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [conversation],
  );

  const send = useCallback(
    async (text: string, atts: Attachment[]) => {
      if (!conversation || !user) return;
      const trimmed = text.trim();
      if (!trimmed && atts.length === 0) return;
      const mode = conversation.mode;
      const cost = MODES[mode].cost;
      if (!isPremium() && !spendCredits(cost)) {
        toast.error("Not enough credits. Try Basic mode, wait for top-up, or upgrade to Premium.");
        return;
      }

      const attSummaries = atts.map((a) => ({
        name: a.name,
        kind: a.mime.startsWith("image/") ? ("image" as const) : ("pdf" as const),
      }));

      let userMsg: Message;
      try {
        userMsg = await insertMessage(user.id, conversation.id, "user", trimmed, attSummaries);
      } catch (e) {
        toast.error((e as Error).message || "Failed to save message");
        return;
      }

      const isFirst = messages.length === 0;
      const newTitle = isFirst && trimmed ? trimmed.slice(0, 60) : undefined;
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setConversation({
        ...conversation,
        title: newTitle ?? conversation.title,
        updated_at: new Date().toISOString(),
      });
      touchConversation(conversation.id, newTitle).catch(() => {});

      setInput("");
      setAttachments([]);
      setStreamText("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const wire: SendMessage[] = nextMessages.map((m, i) => {
        const isLast = i === nextMessages.length - 1;
        return {
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          attachments: isLast ? atts : undefined,
        };
      });

      let acc = "";
      let savedId: string | undefined;
      let savedAt: string | undefined;
      const requestType: ChatRequestType = atts.some((a) => a.mime === "application/pdf")
        ? "pdf_analysis"
        : mode === "deep"
          ? "deep_research"
          : "chat";
      try {
        const result = await streamChat(
          wire,
          mode,
          (delta) => {
            acc += delta;
            setStreamText(acc);
          },
          controller.signal,
          conversation.id,
          requestType,
        );
        savedId = result.messageId;
        savedAt = result.createdAt;
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          toast.error((e as Error).message || "Streaming failed");
        } else {
          acc = acc + "\n\n_(stopped)_";
        }
      }

      try {
        if (!acc.trim()) {
          // Nothing streamed (denied / failed) — keep the transcript unchanged.
        } else if (savedId) {
          // The server already persisted this assistant message.
          setMessages((prev) => [
            ...prev,
            {
              id: savedId,
              conversation_id: conversation.id,
              user_id: user.id,
              role: "assistant",
              content: acc,
              attachments: [],
              created_at: savedAt ?? new Date().toISOString(),
            } as Message,
          ]);
          touchConversation(conversation.id).catch(() => {});
        } else {
          const assistantMsg = await insertMessage(user.id, conversation.id, "assistant", acc, []);
          setMessages((prev) => [...prev, assistantMsg]);
          touchConversation(conversation.id).catch(() => {});
        }
      } catch (e) {
        toast.error((e as Error).message || "Failed to save reply");
      } finally {
        setStreaming(false);
        setStreamText("");
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation, user, messages],
  );

  // auto-send from ?q= or PDF pending
  useEffect(() => {
    if (!conversation || autoSentRef.current || loading) return;
    const pendingRaw =
      typeof window !== "undefined"
        ? sessionStorage.getItem(`fs.pending.${conversation.id}`)
        : null;
    if (pendingRaw && messages.length === 0) {
      autoSentRef.current = true;
      try {
        const pending = JSON.parse(pendingRaw) as { prompt: string; attachments: Attachment[] };
        sessionStorage.removeItem(`fs.pending.${conversation.id}`);
        void send(pending.prompt, pending.attachments);
      } catch {
        sessionStorage.removeItem(`fs.pending.${conversation.id}`);
      }
      return;
    }
    if (q && messages.length === 0) {
      autoSentRef.current = true;
      void send(q, []);
      navigate({
        to: "/chat/$threadId",
        params: { threadId: conversation.id },
        replace: true,
      });
    }
  }, [conversation, messages.length, q, send, navigate, loading]);

  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamText]);

  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming, threadId]);

  const empty = useMemo(() => messages.length === 0, [messages]);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const arr: Attachment[] = [];
    for (const f of Array.from(files)) {
      if (f.size > 15 * 1024 * 1024) {
        toast.error(`${f.name} is too large (15MB max)`);
        continue;
      }
      const dataUrl = await fileToDataUrl(f);
      arr.push({ name: f.name, mime: f.type || "application/octet-stream", dataUrl });
    }
    setAttachments((p) => [...p, ...arr]);
  }

  async function newChat() {
    if (!user) return;
    try {
      const conv = await createConversation(user.id, conversation?.mode ?? "standard");
      navigate({ to: "/chat/$threadId", params: { threadId: conv.id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function rename() {
    if (!conversation) return;
    const next = prompt("Rename conversation", conversation.title);
    if (!next || next === conversation.title) return;
    setConversation({ ...conversation, title: next });
    try {
      await updateConversation(conversation.id, { title: next });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove() {
    if (!conversation) return;
    if (!confirm("Delete this conversation?")) return;
    try {
      await deleteConversation(conversation.id);
      navigate({ to: "/history" });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (hydrated && !sessionLoading && !user) {
    return <Navigate to="/auth" />;
  }

  return (
    <AppShell hideHeader>
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-border/60 bg-background/85 px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur-xl">
        <div className="flex items-center gap-1">
          <Link
            to="/"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-200 active:bg-white/5"
            aria-label="Home"
          >
            <BrandLogo size={22} />
          </Link>
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-[13.5px] font-medium leading-tight text-foreground">
              {conversation?.title || "New chat"}
            </div>
            <div className="truncate text-[10.5px] text-muted-foreground">
              {conversation ? MODES[conversation.mode].label : "…"}
            </div>
          </div>
          {conversation && (
            <>
              <button
                onClick={rename}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 active:bg-white/5"
                aria-label="Rename"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={remove}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 active:bg-white/5"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={newChat}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 active:bg-white/5"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          {conversation && <ModeSelector value={conversation.mode} onChange={setMode} />}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-col gap-5 overflow-y-auto pb-2"
        style={{ minHeight: "calc(100dvh - 260px)" }}
      >
        {loading && (
          <div className="flex items-center justify-center gap-2 pt-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[12px]">Loading conversation…</span>
          </div>
        )}
        {!loading && empty && (
          <div className="mt-10 flex flex-col items-center gap-3 px-6 text-center">
            <BrandLogo size={52} />
            <h2 className="text-[19px] font-medium tracking-tight text-foreground">
              How can I help you today?
            </h2>
            <p className="max-w-[260px] text-[12.5px] leading-relaxed text-muted-foreground">
              {conversation ? MODES[conversation.mode].desc : ""}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {streaming && (
          <div>
            {streamText ? (
              <div className="pr-1">
                <ChatMarkdown text={streamText} />
                <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-primary" />
              </div>
            ) : (
              <ThinkingBubble mode={conversation?.mode ?? "standard"} />
            )}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-[76px] z-30 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-md">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <div
                  key={i}
                  className="glass flex items-center gap-1.5 rounded-full py-1 pl-2 pr-1 text-[11px]"
                >
                  {a.mime.startsWith("image/") ? (
                    <img src={a.dataUrl} alt="" className="h-4 w-4 rounded object-cover" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-primary" />
                  )}
                  <span className="max-w-[120px] truncate">{a.name}</span>
                  <button
                    onClick={() => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                    className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10"
                    aria-label="Remove attachment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1 rounded-[26px] border border-border bg-surface/95 p-1.5 backdrop-blur-xl">
            <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:text-foreground active:bg-white/5">
              <Paperclip className="h-[18px] w-[18px]" />
              <input
                type="file"
                className="hidden"
                multiple
                accept="image/*,application/pdf"
                onChange={(e) => {
                  void onFiles(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!streaming) void send(input, attachments);
                }
              }}
              rows={1}
              placeholder="Message FloatingSpace…"
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[14.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
              style={{
                height: Math.min(160, Math.max(40, input.split("\n").length * 24)),
              }}
            />
            {streaming ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition duration-200 active:scale-95"
                aria-label="Stop"
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => void send(input, attachments)}
                disabled={!input.trim() && attachments.length === 0}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition duration-200 active:scale-95 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
                aria-label="Send"
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const time = formatTime(message.created_at);
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end pl-8 animate-msg-in">
        <div className="rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-[14.5px] leading-relaxed text-primary-foreground">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {message.attachments.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-[10.5px]"
                >
                  <FileText className="h-3 w-3" />
                  <span className="max-w-[140px] truncate">{a.name}</span>
                </div>
              ))}
            </div>
          )}
          {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
        </div>
        <div className="mt-1.5 pr-1 text-[10px] text-muted-foreground">{time}</div>
      </div>
    );
  }
  return (
    <div className="animate-msg-in pr-1">
      <ChatMarkdown text={message.content} />
      <div className="mt-1.5 text-[10px] text-muted-foreground">{time}</div>
    </div>
  );
}

function ThinkingBubble({ mode }: { mode: ChatMode }) {
  return (
    <div className="flex items-center gap-2">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      <span className="text-[12.5px] text-muted-foreground">
        {mode === "deep" ? "Researching…" : "Thinking…"}
      </span>
    </div>
  );
}
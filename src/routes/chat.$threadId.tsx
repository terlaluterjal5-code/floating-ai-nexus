import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { BrandLogo } from "@/components/BrandLogo";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ModeSelector } from "@/components/ModeSelector";
import {
  cryptoRandom,
  getThread,
  isPremium,
  newThread,
  spendCredits,
  upsertThread,
  useHydrated,
  type ChatMessage,
  type ChatThread,
} from "@/lib/storage";
import { MODES, type ChatMode } from "@/lib/models";
import { streamChat, type SendMessage } from "@/lib/streamChat";
import { ArrowUp, Paperclip, Plus, Square, X, FileText, Loader2 } from "lucide-react";
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

function ChatPage() {
  const { threadId } = Route.useParams();
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const hydrated = useHydrated();

  const [thread, setThread] = useState<ChatThread | null>(null);
  const [input, setInput] = useState(q ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSentRef = useRef(false);

  // load or create thread
  useEffect(() => {
    if (!hydrated) return;
    const t = getThread(threadId);
    if (t) {
      setThread(t);
    } else {
      const nt = { ...newThread("standard"), id: threadId };
      upsertThread(nt);
      setThread(nt);
    }
  }, [threadId, hydrated]);

  const persist = useCallback((next: ChatThread) => {
    setThread(next);
    upsertThread(next);
  }, []);

  const setMode = useCallback(
    (mode: ChatMode) => {
      if (!thread) return;
      persist({ ...thread, mode, updatedAt: Date.now() });
    },
    [thread, persist],
  );

  const send = useCallback(
    async (text: string, atts: Attachment[]) => {
      if (!thread) return;
      const trimmed = text.trim();
      if (!trimmed && atts.length === 0) return;
      const mode = thread.mode;
      const cost = MODES[mode].cost;
      if (!isPremium() && !spendCredits(cost)) {
        toast.error("Not enough credits. Try Basic mode, wait for top-up, or upgrade to Premium.");
        return;
      }

      const userMsg: ChatMessage = {
        id: cryptoRandom(),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
        attachments: atts.map((a) => ({
          name: a.name,
          kind: a.mime.startsWith("image/") ? "image" : "pdf",
        })),
      };
      const nextMessages = [...thread.messages, userMsg];
      const nextTitle =
        thread.messages.length === 0 && trimmed
          ? trimmed.slice(0, 48)
          : thread.title;
      const withUser: ChatThread = {
        ...thread,
        messages: nextMessages,
        title: nextTitle,
        updatedAt: Date.now(),
      };
      persist(withUser);
      setInput("");
      setAttachments([]);
      setStreamText("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const wire: SendMessage[] = nextMessages.map((m, i) => {
        const isLast = i === nextMessages.length - 1;
        return {
          role: m.role,
          content: m.content,
          attachments: isLast ? atts : undefined,
        };
      });

      try {
        let acc = "";
        await streamChat(
          wire,
          mode,
          (delta) => {
            acc += delta;
            setStreamText(acc);
          },
          controller.signal,
        );
        const assistantMsg: ChatMessage = {
          id: cryptoRandom(),
          role: "assistant",
          content: acc,
          createdAt: Date.now(),
        };
        const done: ChatThread = {
          ...withUser,
          messages: [...nextMessages, assistantMsg],
          updatedAt: Date.now(),
        };
        persist(done);
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          const assistantMsg: ChatMessage = {
            id: cryptoRandom(),
            role: "assistant",
            content: (streamText || "") + "\n\n_(stopped)_",
            createdAt: Date.now(),
          };
          persist({
            ...withUser,
            messages: [...nextMessages, assistantMsg],
            updatedAt: Date.now(),
          });
        } else {
          toast.error((e as Error).message || "Something went wrong");
        }
      } finally {
        setStreaming(false);
        setStreamText("");
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thread, persist],
  );

  // auto-send if ?q= present and thread empty
  useEffect(() => {
    if (!thread || autoSentRef.current) return;
    if (q && thread.messages.length === 0) {
      autoSentRef.current = true;
      void send(q, []);
      navigate({
        to: "/chat/$threadId",
        params: { threadId: thread.id },
        replace: true,
      });
    }
  }, [thread, q, send, navigate]);

  // scroll to bottom on new content
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread?.messages, streamText]);

  // focus input
  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming, threadId]);

  const empty = useMemo(() => !thread || thread.messages.length === 0, [thread]);

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

  function newChat() {
    const t = newThread(thread?.mode ?? "standard");
    upsertThread(t);
    navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
  }

  return (
    <AppShell
      hideHeader
    >
      {/* Custom sticky header for chat */}
      <div className="sticky top-0 z-30 -mx-4 mb-3 px-4 pt-[calc(env(safe-area-inset-top)+10px)]">
        <div className="glass flex items-center gap-2 rounded-2xl px-2.5 py-2">
          <Link
            to="/"
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/80 transition active:scale-95"
            aria-label="Home"
          >
            <BrandLogo size={26} />
          </Link>
          <div className="flex-1 truncate px-1">
            <div className="truncate text-[13px] font-semibold leading-tight text-foreground/95">
              {thread?.title || "New chat"}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              {thread ? MODES[thread.mode].label : "…"}
            </div>
          </div>
          <button
            onClick={newChat}
            className="glass flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          {thread && <ModeSelector value={thread.mode} onChange={setMode} />}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-col gap-3 overflow-y-auto pb-2"
        style={{ minHeight: "calc(100dvh - 260px)" }}
      >
        {empty && (
          <div className="mt-8 flex flex-col items-center gap-3 px-6 text-center">
            <BrandLogo size={64} />
            <h2 className="text-lg font-semibold text-gradient">
              How can I help you today?
            </h2>
            <p className="text-[12px] text-muted-foreground">
              {thread ? MODES[thread.mode].desc : ""}
            </p>
          </div>
        )}
        {thread?.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {streaming && (
          <div className="animate-fade-in">
            {streamText ? (
              <div className="pl-1 pr-2">
                <ChatMarkdown text={streamText} />
                <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-primary" />
              </div>
            ) : (
              <ThinkingBubble mode={thread?.mode ?? "standard"} />
            )}
          </div>
        )}
      </div>

      {/* Composer */}
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
                    <img
                      src={a.dataUrl}
                      alt=""
                      className="h-4 w-4 rounded object-cover"
                    />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-gradient" />
                  )}
                  <span className="max-w-[120px] truncate">{a.name}</span>
                  <button
                    onClick={() =>
                      setAttachments((p) => p.filter((_, idx) => idx !== i))
                    }
                    className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10"
                    aria-label="Remove attachment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="glass flex items-end gap-1.5 rounded-3xl p-1.5 shadow-2xl shadow-black/40">
            <label className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition active:scale-90 hover:text-foreground">
              <Paperclip className="h-4.5 w-4.5" />
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
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[14px] outline-none placeholder:text-muted-foreground"
              style={{
                height: Math.min(160, Math.max(36, input.split("\n").length * 22)),
              }}
            />
            {streaming ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground active:scale-90"
                aria-label="Stop"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => void send(input, attachments)}
                disabled={!input.trim() && attachments.length === 0}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-brand-foreground shadow-lg shadow-primary/40 transition active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send"
              >
                <ArrowUp className="h-4.5 w-4.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end pl-6 animate-fade-in">
        <div className="rounded-2xl bg-brand-gradient px-3.5 py-2 text-[14px] text-brand-foreground shadow-lg shadow-primary/20">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {message.attachments.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px]"
                >
                  <FileText className="h-3 w-3" />
                  <span className="max-w-[140px] truncate">{a.name}</span>
                </div>
              ))}
            </div>
          )}
          {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="animate-fade-in pl-1 pr-2">
      <ChatMarkdown text={message.content} />
    </div>
  );
}

function ThinkingBubble({ mode }: { mode: ChatMode }) {
  return (
    <div className="flex items-center gap-2 pl-1">
      <div className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-brand-gradient opacity-40 blur-md animate-float-orb" />
        <Loader2 className="relative h-4 w-4 animate-spin text-gradient" />
      </div>
      <span className="text-[12px] font-medium text-muted-foreground">
        {mode === "deep" ? "Researching…" : "Thinking…"}
      </span>
    </div>
  );
}
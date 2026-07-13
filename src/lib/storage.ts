import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatMode } from "./models";

export type UIMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; kind: "pdf" | "image" }[];
  createdAt: number;
};

export type ChatThread = {
  id: string;
  title: string;
  mode: ChatMode;
  pinned?: boolean;
  messages: ChatMessage[];
  updatedAt: number;
  createdAt: number;
};

export type GeneratedImage = {
  id: string;
  prompt: string;
  dataUrl: string;
  createdAt: number;
};

const THREADS_KEY = "fs.threads.v1";
const IMAGES_KEY = "fs.images.v1";
const CREDITS_KEY = "fs.credits.v1";
const PREMIUM_KEY = "fs.premium.v1";
const LAST_TOPUP_KEY = "fs.lastTopup.v1";

export const MAX_CREDITS = 1000;
const START_CREDITS = 250;
const TOPUP_PER_MIN = 2; // +2 credits per minute of use

// ---------- generic ls store ----------
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
  if (typeof window !== "undefined")
    window.dispatchEvent(new StorageEvent("storage", { key: "fs.tick" }));
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => cb();
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  emit();
}

// ---------- threads ----------
export function getThreads(): ChatThread[] {
  return read<ChatThread[]>(THREADS_KEY, []);
}
export function saveThreads(threads: ChatThread[]) {
  write(THREADS_KEY, threads);
}
export function upsertThread(thread: ChatThread) {
  const all = getThreads();
  const idx = all.findIndex((t) => t.id === thread.id);
  if (idx >= 0) all[idx] = thread;
  else all.unshift(thread);
  all.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  saveThreads(all);
}
export function getThread(id: string): ChatThread | undefined {
  return getThreads().find((t) => t.id === id);
}
export function deleteThread(id: string) {
  saveThreads(getThreads().filter((t) => t.id !== id));
}
export function togglePin(id: string) {
  const all = getThreads();
  const t = all.find((x) => x.id === id);
  if (!t) return;
  t.pinned = !t.pinned;
  saveThreads(all);
}
export function newThread(mode: ChatMode): ChatThread {
  const now = Date.now();
  return {
    id: cryptoRandom(),
    title: "New chat",
    mode,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function useThreads(): ChatThread[] {
  return useSyncExternalStore(
    subscribe,
    () => getThreads(),
    () => [] as ChatThread[],
  );
}

// ---------- images ----------
export function getImages(): GeneratedImage[] {
  return read<GeneratedImage[]>(IMAGES_KEY, []);
}
export function addImage(img: GeneratedImage) {
  const all = getImages();
  all.unshift(img);
  write(IMAGES_KEY, all.slice(0, 40));
}
export function deleteImage(id: string) {
  write(
    IMAGES_KEY,
    getImages().filter((i) => i.id !== id),
  );
}
export function useImages(): GeneratedImage[] {
  return useSyncExternalStore(
    subscribe,
    () => getImages(),
    () => [] as GeneratedImage[],
  );
}

// ---------- credits ----------
export function getCredits(): number {
  const v = read<number | null>(CREDITS_KEY, null);
  if (v == null) {
    write(CREDITS_KEY, START_CREDITS);
    return START_CREDITS;
  }
  return v;
}
export function spendCredits(n: number): boolean {
  const cur = getCredits();
  if (cur < n) return false;
  write(CREDITS_KEY, Math.max(0, cur - n));
  return true;
}
export function addCredits(n: number) {
  write(CREDITS_KEY, Math.min(MAX_CREDITS, getCredits() + n));
}
export function isPremium(): boolean {
  return read<boolean>(PREMIUM_KEY, false);
}
export function setPremium(v: boolean) {
  write(PREMIUM_KEY, v);
  if (v) write(CREDITS_KEY, MAX_CREDITS);
}
export function useCredits(): number {
  return useSyncExternalStore(
    subscribe,
    () => getCredits(),
    () => START_CREDITS,
  );
}
export function usePremium(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isPremium(),
    () => false,
  );
}

// gradual top-up: +TOPUP_PER_MIN credits every minute the app is open
export function useAutoTopup() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tick = () => {
      if (isPremium()) return;
      const last = read<number>(LAST_TOPUP_KEY, Date.now());
      const now = Date.now();
      const minutes = Math.floor((now - last) / 60000);
      if (minutes > 0) {
        addCredits(minutes * TOPUP_PER_MIN);
        write(LAST_TOPUP_KEY, now);
      }
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);
}

// ---------- helpers ----------
export function cryptoRandom() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}
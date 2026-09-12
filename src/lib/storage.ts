import { useEffect, useState } from "react";
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


const EMPTY_THREADS: ChatThread[] = [];
const EMPTY_IMAGES: GeneratedImage[] = [];

// ---------- generic ls store ----------
const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();
function bumpKey(key: string) {
  cache.delete(key);
}
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key) bumpKey(e.key);
    else cache.clear();
    cb();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  if (cache.has(key)) return cache.get(key) as T;
  try {
    const raw = window.localStorage.getItem(key);
    const val = raw ? (JSON.parse(raw) as T) : fallback;
    cache.set(key, val);
    return val;
  } catch {
    return fallback;
  }
}
function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  cache.set(key, value);
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
  const [v, setV] = useState<ChatThread[]>(EMPTY_THREADS);
  useEffect(() => {
    setV(getThreads());
    return subscribe(() => setV(getThreads()));
  }, []);
  return v;
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
  const [v, setV] = useState<GeneratedImage[]>(EMPTY_IMAGES);
  useEffect(() => {
    setV(getImages());
    return subscribe(() => setV(getImages()));
  }, []);
  return v;
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
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  addImage,
  cryptoRandom,
  deleteImage,
  isPremium,
  spendCredits,
  useImages,
} from "@/lib/storage";
import { IMAGE_COST } from "@/lib/models";
import { Loader2, Sparkles, Download, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/image")({
  head: () => ({
    meta: [
      { title: "AI Image Generator — FloatingSpace" },
      {
        name: "description",
        content: "Generate ultra-realistic HD images with FloatingSpace AI.",
      },
    ],
  }),
  component: ImagePage,
});

const SUGGESTIONS = [
  "A cinematic portrait of an astronaut floating over Earth at sunrise",
  "A futuristic Tokyo skyline at night, neon reflections in the rain",
  "A hyperrealistic close-up of a hummingbird mid-flight, macro photography",
  "An ultra-detailed cyberpunk street market, cinematic lighting",
];

function ImagePage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const images = useImages();

  async function generate() {
    const p = prompt.trim();
    if (!p) return;
    if (!isPremium() && !spendCredits(IMAGE_COST)) {
      toast.error("Not enough credits for image generation.");
      return;
    }
    setLoading(true);
    try {
      const { authedFetch } = await import("@/lib/authedFetch");
      const res = await authedFetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p }),
      });
      if (!res.ok) {
        const text = await res.text();
        try {
          const j = JSON.parse(text) as { error?: { message?: string } };
          throw new Error(j.error?.message || text || `Failed (${res.status})`);
        } catch {
          throw new Error(text || `Failed (${res.status})`);
        }
      }
      const { dataUrl } = (await res.json()) as { dataUrl: string };
      addImage({ id: cryptoRandom(), prompt: p, dataUrl, createdAt: Date.now() });
      setPrompt("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <section className="mt-2">
        <div className="mb-3 flex items-center gap-2 px-1">
          <div className="rounded-xl bg-primary/12 p-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Image Generator
            </h1>
            <p className="text-[11px] text-muted-foreground">
              Ultra realistic HD · Cinematic lighting · {IMAGE_COST} credits per image
            </p>
          </div>
        </div>

        <div className="border border-border bg-surface/60 rounded-2xl p-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Describe the image you want to create…"
            className="w-full resize-none bg-transparent px-2 py-2 text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Gemini 3 Pro Image
            </span>
            <button
              onClick={generate}
              disabled={loading || !prompt.trim()}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-foreground transition active:scale-95 disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Generate
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setPrompt(s)}
              className="border border-border bg-surface/60 rounded-full px-2.5 py-1 text-[11px] text-muted-foreground transition active:scale-95 hover:text-foreground"
            >
              {s.split(",")[0]}
            </button>
          ))}
        </div>
      </section>

      {loading && (
        <div className="mt-4 aspect-square w-full overflow-hidden rounded-2xl border border-border bg-surface/60">
          <div className="relative h-full w-full">
            <div className="absolute inset-0 animate-shimmer" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Rendering…
              </span>
            </div>
          </div>
        </div>
      )}

      <section className="mt-5">
        <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Recent
        </h2>
        {images.length === 0 && !loading && (
          <div className="border border-border bg-surface/60 rounded-2xl p-6 text-center">
            <p className="text-[12px] text-muted-foreground">
              Your generated images will appear here.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <div key={img.id} className="border border-border bg-surface/60 group relative overflow-hidden rounded-2xl">
              <img src={img.dataUrl} alt={img.prompt} className="aspect-square w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                <p className="line-clamp-2 text-[10px] text-white/90">{img.prompt}</p>
              </div>
              <div className="absolute right-1.5 top-1.5 flex gap-1">
                <a
                  href={img.dataUrl}
                  download={`floatingspace-${img.id}.png`}
                  className="border border-border bg-surface/60 flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
                  aria-label="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  onClick={() => deleteImage(img.id)}
                  className="border border-border bg-surface/60 flex h-7 w-7 items-center justify-center rounded-full text-destructive transition active:scale-90"
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
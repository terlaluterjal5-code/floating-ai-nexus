import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { createConversation } from "@/lib/conversations";
import { useSession } from "@/lib/auth";
import { FileText, Upload, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/pdf")({
  head: () => ({
    meta: [
      { title: "PDF Analyzer — FloatingSpace" },
      { name: "description", content: "Upload a PDF and let FloatingSpace analyze, summarize, and explain it." },
    ],
  }),
  component: PdfPage,
});

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(f);
  });
}

const TASKS = [
  { label: "Summarize", prompt: "Give me a comprehensive summary of this document with the key points, structure, and main takeaways." },
  { label: "Extract key info", prompt: "Extract all important information from this PDF: dates, names, numbers, decisions, and action items." },
  { label: "Create a report", prompt: "Create a detailed structured report based on this document with sections, findings, and recommendations." },
  { label: "Q&A", prompt: "Read this document carefully. I'll ask questions about it. Confirm you've read it, then wait for my questions." },
];

function PdfPage() {
  const nav = useNavigate();
  const { user } = useSession();
  const [file, setFile] = useState<{ name: string; mime: string; dataUrl: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(f: File | null) {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      toast.error("PDF is too large (15MB max)");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(f);
      setFile({ name: f.name, mime: f.type || "application/pdf", dataUrl, size: f.size });
    } finally {
      setBusy(false);
    }
  }

  async function launchWithPrompt(prompt: string) {
    if (!file) return;
    if (!user) {
      nav({ to: "/auth" });
      return;
    }
    try {
      const conv = await createConversation(user.id, "deep", `PDF · ${file.name.slice(0, 40)}`);
      sessionStorage.setItem(
        `fs.pending.${conv.id}`,
        JSON.stringify({ prompt, attachments: [file] }),
      );
      nav({ to: "/chat/$threadId", params: { threadId: conv.id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <AppShell>
      <div className="mb-3 mt-2 flex items-center gap-2 px-1">
        <div className="rounded-xl bg-brand-gradient/20 p-1.5">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-gradient">PDF Analyzer</h1>
          <p className="text-[11px] text-muted-foreground">
            Upload a PDF and let FloatingSpace read, summarize, and analyze it.
          </p>
        </div>
      </div>

      {!file ? (
        <label className="glass mt-2 flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/15 p-6 text-center transition active:scale-[0.98]">
          <div className="rounded-2xl bg-brand-gradient/20 p-3">
            <Upload className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-foreground">
              {busy ? "Loading…" : "Tap to upload a PDF"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Up to 15MB</div>
          </div>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        <>
          <div className="glass flex items-center gap-3 rounded-2xl p-3">
            <div className="rounded-xl bg-brand-gradient/25 p-2.5">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{file.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB · Ready
              </div>
            </div>
            <button
              onClick={() => setFile(null)}
              className="text-[11px] text-muted-foreground hover:text-destructive"
            >
              Remove
            </button>
          </div>

          <h2 className="mb-2 mt-5 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            What should I do with it?
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {TASKS.map((t) => (
              <button
                key={t.label}
                onClick={() => launchWithPrompt(t.prompt)}
                className="glass flex flex-col items-start gap-2 rounded-2xl p-3 text-left transition active:scale-[0.97]"
              >
                <div className="rounded-lg bg-brand-gradient/20 p-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-[13px] font-semibold">{t.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
import ReactMarkdown from "react-markdown";

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-p:leading-relaxed prose-p:my-2 prose-li:my-0.5 prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl prose-code:text-primary prose-strong:text-foreground prose-a:text-primary">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}
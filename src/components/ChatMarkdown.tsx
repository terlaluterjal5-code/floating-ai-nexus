import ReactMarkdown from "react-markdown";

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-[14.5px] leading-[1.72] prose-headings:font-semibold prose-headings:tracking-tight prose-headings:mt-5 prose-headings:mb-2 prose-h1:text-[18px] prose-h2:text-[16px] prose-h3:text-[15px] prose-p:my-2.5 prose-p:leading-[1.72] prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-1 prose-pre:my-3 prose-pre:bg-black/45 prose-pre:border prose-pre:border-border prose-pre:rounded-xl prose-pre:text-[13px] prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-strong:text-foreground prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-primary/40 prose-blockquote:not-italic prose-table:text-[13px] prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-hr:border-border">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

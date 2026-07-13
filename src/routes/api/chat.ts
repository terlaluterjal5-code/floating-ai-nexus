import { createFileRoute } from "@tanstack/react-router";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { MODES, type ChatMode } from "@/lib/models";

type Attachment = { name: string; mime: string; dataUrl: string };
type ClientMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};
type Body = { messages: ClientMessage[]; mode: ChatMode };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const { messages, mode } = body;
        if (!Array.isArray(messages) || !mode || !MODES[mode]) {
          return new Response("Bad request", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const cfg = MODES[mode];
        const payloadMessages = [
          { role: "system", content: cfg.system },
          ...messages.map((m) => {
            if (m.role === "assistant" || !m.attachments?.length) {
              return { role: m.role, content: m.content };
            }
            const parts: unknown[] = [{ type: "text", text: m.content || "Analyze the attached file(s)." }];
            for (const a of m.attachments) {
              if (a.mime.startsWith("image/")) {
                parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
              } else {
                parts.push({
                  type: "file",
                  file: { filename: a.name, file_data: a.dataUrl },
                });
              }
            }
            return { role: m.role, content: parts };
          }),
        ];

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: payloadMessages,
            stream: true,
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text();
          return new Response(text || "Upstream error", { status: upstream.status });
        }

        // Passthrough SSE
        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
// silence unused-import if provider helper import ever added later
void createLovableAiGatewayProvider;
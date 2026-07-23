import { createFileRoute } from "@tanstack/react-router";
import { IMAGE_MODEL, IMAGE_PROMPT_PREFIX } from "@/lib/models";

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { prompt } = (await request.json()) as { prompt?: string };
        if (!prompt || typeof prompt !== "string") {
          return new Response("Prompt required", { status: 400 });
        }
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: IMAGE_MODEL,
            messages: [
              {
                role: "user",
                content: `${IMAGE_PROMPT_PREFIX} ${prompt}`,
              },
            ],
            modalities: ["image", "text"],
          }),
        });
        if (!upstream.ok) {
          const text = await upstream.text();
          return new Response(text || "Upstream error", { status: upstream.status });
        }
        const data = (await upstream.json()) as {
          choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
        };
        const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (!url) return new Response("No image returned", { status: 502 });
        return new Response(JSON.stringify({ dataUrl: url }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
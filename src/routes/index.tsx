import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FloatingSpace — AI Chat by ZNTech" },
      { name: "description", content: "Chat, create images, and analyze PDFs in one simple AI workspace." },
      { property: "og:title", content: "FloatingSpace — AI Chat by ZNTech" },
      { property: "og:description", content: "Chat, create images, and analyze PDFs in one simple AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <Navigate to="/chat" replace />;
}

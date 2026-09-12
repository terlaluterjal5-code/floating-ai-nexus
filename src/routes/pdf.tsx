import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/pdf")({
  head: () => ({
    meta: [
      { title: "PDF Analyzer — FloatingSpace" },
      {
        name: "description",
        content: "Upload a PDF and let FloatingSpace analyze, summarize, and explain it.",
      },
    ],
  }),
  component: () => <Navigate to="/chat" replace />,
});

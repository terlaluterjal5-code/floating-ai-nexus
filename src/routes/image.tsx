import { createFileRoute, Navigate } from "@tanstack/react-router";

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
  component: () => <Navigate to="/chat" replace />,
});

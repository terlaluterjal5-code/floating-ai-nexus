export type ChatMode = "basic" | "standard" | "deep";

export const MODES: Record<
  ChatMode,
  { label: string; short: string; model: string; system: string; cost: number; desc: string }
> = {
  basic: {
    label: "Basic",
    short: "Fast",
    model: "google/gemini-3.1-flash-lite",
    cost: 1,
    desc: "Fast simple answers for everyday questions.",
    system:
      "You are FloatingSpace AI in BASIC mode. Give concise, friendly, direct answers. 2-4 short paragraphs max. Use markdown.",
  },
  standard: {
    label: "Standard",
    short: "Balanced",
    model: "openai/gpt-5.5",
    cost: 3,
    desc: "Balanced, well reasoned answers with detail.",
    system:
      "You are FloatingSpace AI in STANDARD mode, a premium assistant by ZNTech. Give clear, well-structured, well-reasoned answers with helpful detail. Use markdown, headings when useful, and bullet lists for clarity.",
  },
  deep: {
    label: "Deep Research",
    short: "Deep",
    model: "openai/gpt-5.5",
    cost: 8,
    desc: "Comprehensive research-grade analysis with structured reports.",
    system:
      "You are FloatingSpace AI in DEEP RESEARCH mode, a professional research assistant by ZNTech. Produce highly comprehensive, structured, research-grade responses. Always include: (1) Executive Summary, (2) Detailed Analysis with subsections, (3) Key Data Points, (4) Multiple Perspectives, (5) Implications, (6) Sources & Further Reading (name reputable sources you draw on from your training). Use markdown with clear headings, tables when useful, and bullet lists. Be exhaustive but well-organized.",
  },
};

export const IMAGE_MODEL = "google/gemini-3-pro-image";
export const IMAGE_COST = 10;
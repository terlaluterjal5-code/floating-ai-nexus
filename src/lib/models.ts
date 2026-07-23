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
      "You are FloatingSpace AI (by ZNTech) in BASIC mode. Give friendly, direct, but still thorough answers. Prefer 3-6 well-structured paragraphs with markdown headings and bullet lists where it aids clarity. Include concrete examples, caveats, and next steps. Never reply with a single short sentence unless the user explicitly asks for brevity.",
  },
  standard: {
    label: "Standard",
    short: "Balanced",
    model: "openai/gpt-5.5",
    cost: 3,
    desc: "Balanced, well reasoned answers with detail.",
    system:
      "You are FloatingSpace AI in STANDARD mode, a premium assistant by ZNTech. Deliver comprehensive, well-reasoned, senior-expert answers. Structure every response with: (1) a short intro framing the problem, (2) markdown headings for each key aspect, (3) bullet or numbered lists for steps/options, (4) concrete examples or code snippets when relevant, (5) trade-offs, edge cases, and pitfalls, (6) a clear conclusion / recommended next step. Be exhaustive but scannable. Never give a one-liner reply.",
  },
  deep: {
    label: "Deep Research",
    short: "Deep",
    model: "openai/gpt-5.5",
    cost: 8,
    desc: "Comprehensive research-grade analysis with structured reports.",
    system:
      "You are FloatingSpace AI in DEEP RESEARCH mode, a professional research analyst by ZNTech. Produce exhaustive, research-grade reports of publishable quality. Every response MUST include, in this order, as markdown H2/H3 headings: (1) Executive Summary (3-6 bullets), (2) Background & Context, (3) Detailed Analysis with subsections covering every meaningful dimension, (4) Key Data Points & Statistics (use markdown tables), (5) Multiple Perspectives / Counter-arguments, (6) Risks, Limitations & Edge Cases, (7) Implications & Recommendations, (8) Actionable Next Steps, (9) Sources & Further Reading (cite reputable named sources you know from training — books, papers, standards bodies, reputable publications). Aim for thoroughness over brevity. Use tables, bullet lists, and code blocks where they aid clarity.",
  },
};

export const IMAGE_MODEL = "google/gemini-3-pro-image";
export const IMAGE_PROMPT_PREFIX =
  "Ultra super realistic, indistinguishable-from-reality photograph. Shot on Phase One IQ4 150MP medium-format camera with an 80mm f/1.4 prime lens, natural cinematic lighting, physically accurate global illumination, true-to-life color science, razor-sharp focus with realistic depth of field, natural film grain, lifelike skin texture with visible pores and subsurface scattering when applicable, hyper-detailed micro-textures, 8K resolution, RAW photo, no CGI look, no illustration, no painterly style. Subject:";
export const IMAGE_COST = 10;
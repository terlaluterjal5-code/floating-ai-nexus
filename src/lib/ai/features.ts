/** Canonical FloatingSpace plan feature keys. Single source of truth. */
export const FEATURE_KEYS = [
  "unlimited_deep_research",
  "higher_ai_intelligence",
  "faster_response_speed",
  "advanced_image_generation",
  "larger_pdf_analysis",
  "priority_processing",
  "exclusive_futuristic_ai_tools",
  "professional_research_assistant",
  "unlimited_chat_credits",
  "advanced_data_analysis",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureFlags = Record<FeatureKey, boolean>;

export function emptyFlags(): FeatureFlags {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as FeatureFlags;
}

export type ProviderPreset = {
  id: string;
  label: string;
  blurb: string;
  apiBaseUrl: string;
  model: string;
  whisperModel: string;
  visionModel: string;
  docsUrl: string;
};

export type AnswerProvider = "gemini" | "groq";

/** Gemini free-tier friendly model for answers + screenshot OCR. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Tried in order when the selected Gemini model returns 404 / model_not_found. */
export const GEMINI_MODEL_FALLBACKS = [
  DEFAULT_GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-flash-latest",
] as const;

/** Vision model for screenshot → question extraction on Groq (fallback). */
export const DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";

/**
 * Groq open-weight stack that works on the standard developer plan.
 * Used mainly for Whisper speech; chat/vision can stay on Gemini.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "groq-balanced",
    label: "Groq · Speech (accurate)",
    blurb:
      "Whisper Large v3 for finals (Parakeet-like accuracy) · Turbo for live partials",
    apiBaseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    whisperModel: "whisper-large-v3",
    visionModel: DEFAULT_VISION_MODEL,
    docsUrl: "https://console.groq.com/keys",
  },
  {
    id: "groq-ultrafast",
    label: "Groq · Speech (faster)",
    blurb: "Whisper Turbo everywhere — lower latency, slightly more mishears",
    apiBaseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    whisperModel: "whisper-large-v3-turbo",
    visionModel: DEFAULT_VISION_MODEL,
    docsUrl: "https://console.groq.com/keys",
  },
  {
    id: "groq-max-stt",
    label: "Groq · Max STT accuracy",
    blurb: "Whisper Large v3 for highest speech quality",
    apiBaseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    whisperModel: "whisper-large-v3",
    visionModel: DEFAULT_VISION_MODEL,
    docsUrl: "https://console.groq.com/keys",
  },
];

export const DEFAULT_PRESET = PROVIDER_PRESETS[0];

/** Normalize empty / blank Gemini ids to the default. */
export function normalizeGeminiModelId(model?: string | null): string {
  const id = (model || "").trim();
  return id || DEFAULT_GEMINI_MODEL;
}

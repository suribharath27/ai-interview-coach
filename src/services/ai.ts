import type {
  AnswerPreferences,
  QuestionType,
  SessionRecord,
} from "../types/session";
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_API_BASE,
  GEMINI_MODEL_FALLBACKS,
  normalizeGeminiModelId,
  type AnswerProvider,
} from "./providers";
import {
  correctAsrText,
  languageToWhisperCode,
} from "./asrVocabulary";
import { enqueueWhisper, parseRetryAfterMs } from "./whisperQueue";

function geminiModelCandidates(preferred?: string): string[] {
  const primary = normalizeGeminiModelId(preferred);
  const list = [primary, ...GEMINI_MODEL_FALLBACKS];
  return [...new Set(list)];
}

function isGeminiModelMissingError(status: number, body: string): boolean {
  if (status !== 404) return false;
  const t = body.toLowerCase();
  return (
    t.includes("model_not_found") ||
    t.includes("does not exist") ||
    t.includes("not found") ||
    t.includes("do not have access")
  );
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const FORMAT_RULES: Record<AnswerPreferences["format"], string> = {
  "full-script":
    "Write a full spoken script the user can read word for word. No bullet lists.",
  "script-bullets":
    "Start with one opening spoken line, then 3–5 short supporting bullets.",
  bullets:
    "Reply with short bullets only that the user can say in their own words.",
};

const LENGTH_RULES: Record<AnswerPreferences["length"], string> = {
  short: "Keep it short — essentials only. Aim for under ~45 seconds spoken.",
  balanced: "Balanced length — core answer plus useful context.",
  long: "Longer answer with more explanation and supporting detail.",
};

const TONE_RULES: Record<AnswerPreferences["tone"], string> = {
  simple: "Use plain, simple words. Avoid jargon.",
  formal: "Use precise, professional wording.",
};

export function buildSessionSystemPrompt(
  session: SessionRecord,
  questionType: QuestionType
): string {
  const prefs = session.preferences.answerPreferences;
  const details = session.details;

  const contextParts = [
    details.companyName ? `Company/client: ${details.companyName}` : "",
    details.description ? `Role/meeting description:\n${details.description}` : "",
    details.resumeText ? `Resume / profile:\n${details.resumeText}` : "",
    details.documentsText
      ? `Extra documents / product notes:\n${details.documentsText}`
      : "",
    session.preferences.aiInstructions
      ? `Extra AI instructions:\n${session.preferences.aiInstructions}`
      : "",
  ].filter(Boolean);

  return `You are a private live-call cue assistant.
The user is on a stakeholder/client call and needs fast spoken answers that match their session preferences.

Question type for this turn: ${questionType}

Answer style rules:
- Format: ${FORMAT_RULES[prefs.format]}
- Length: ${LENGTH_RULES[prefs.length]}
- Tone: ${TONE_RULES[prefs.tone]}
${prefs.starMethod ? "- Use STAR method when the question is behavioral/experience-based." : ""}
${prefs.useFillerWords ? "- Light natural filler is OK." : "- No filler words."}
- Language: ${session.preferences.language}
- Ground answers in the session context (resume, notes, stories). Prefer real facts from that context over invented anecdotes.
- Do not invent personal stories or metrics missing from the session context. If context is thin, give a short honest template and mark assumptions.
- Keep output scannable for a private overlay during screen share.
- Output shape (Parakeet-style):
  1) First line exactly: Question: <one-line restatement of what was asked>
  2) Blank line
  3) The cue answer in the requested format
- Follow-ups: if prior Q&A is in the chat and the latest ask is short / referential ("what if that hadn't worked?", "and then?", "can you also…", "why?", pronouns, "that"), treat it as continuing the same thread. Expand the Question: line into the full implied question, stay consistent with the prior cue, and deepen that same story or solution — do not restart a new unrelated answer unless the ask is clearly a new topic.
${
  questionType === "technical"
    ? `- For coding/algorithm questions: briefly explain approach, then put the full solution inside a markdown fenced code block (e.g. \`\`\`python), then add time/space complexity. Coding follow-ups (tests, edge cases, optimize) must modify/extend the prior solution, not regenerate an unrelated problem.`
    : ""
}

Session context:
${contextParts.join("\n\n") || "No detailed session context provided. Mark assumptions clearly."}`;
}

export function previewAnswerForPreferences(
  prefs: AnswerPreferences,
  _questionType: QuestionType
): { question: string; answer: string } {
  const question =
    "Tell me about a time you disagreed with a teammate about a technical decision.";

  const opening =
    prefs.tone === "formal"
      ? "I once disagreed with a colleague regarding whether to use a NoSQL database or a relational database for a new project."
      : "I once disagreed with a teammate on whether to use a NoSQL database or a relational database for a new project.";

  const bullets = [
    prefs.tone === "formal"
      ? "I recommended a relational database to ensure strong data consistency for user accounts."
      : "I suggested a relational database because we needed strong data consistency for user accounts.",
    prefs.tone === "formal"
      ? "My colleague preferred a key-value store to accelerate initial setup."
      : "My teammate preferred a key-value store for faster initial setup.",
    "We built a small test for both options and picked the relational database when it met our speed goals.",
  ];

  let answer = "";
  if (prefs.format === "full-script") {
    answer = `${opening} ${bullets.join(" ")}`;
    if (prefs.length === "long") {
      answer +=
        " That decision reduced risk for account data and still kept the launch timeline intact.";
    }
  } else if (prefs.format === "bullets") {
    answer = bullets
      .slice(0, prefs.length === "short" ? 3 : prefs.length === "balanced" ? 3 : 4)
      .map((b) => `• ${b}`)
      .join("\n");
  } else {
    const used =
      prefs.length === "short"
        ? bullets
        : prefs.length === "balanced"
          ? bullets
          : [
              ...bullets,
              "That kept the launch timeline intact without sacrificing data safety.",
            ];
    answer = `${opening}\n${used.map((b) => `• ${b}`).join("\n")}`;
  }

  if (prefs.starMethod && prefs.format !== "bullets") {
    answer = `Situation/Task: technical database choice.\nAction/Result:\n${answer}`;
  }

  return { question, answer };
}

export async function transcribeAudio(options: {
  apiKey: string;
  apiBaseUrl: string;
  whisperModel: string;
  audio: Blob;
  filename: string;
  prompt?: string;
  language?: string;
  recentText?: string;
  forceTechnical?: boolean;
  signal?: AbortSignal;
  priority?: "partial" | "final";
}): Promise<string> {
  const {
    apiKey,
    apiBaseUrl,
    whisperModel,
    audio,
    filename,
    prompt,
    language,
    recentText,
    forceTechnical,
    signal,
    priority = "final",
  } = options;
  if (!apiKey.trim()) {
    throw new Error("Add your API key in Settings to use Listen.");
  }

  const base = apiBaseUrl.replace(/\/$/, "");
  // Prefer full large-v3 on finals for Parakeet-like accuracy; turbo on partials.
  const model =
    whisperModel ||
    (priority === "partial"
      ? defaultWhisperModel(base, true)
      : defaultWhisperModel(base, false));
  if (audio.size < 1000) {
    throw new Error(
      "Recording too short or empty. Speak a bit longer, then pause."
    );
  }

  return enqueueWhisper(priority, async () => {
    const uploadName = filename.toLowerCase().endsWith(".wav")
      ? filename
      : "audio.wav";

    const attempt = async () => {
      const form = new FormData();
      form.append("file", audio, uploadName);
      form.append("model", model);
      form.append("response_format", "json");
      form.append("language", languageToWhisperCode(language));
      form.append("temperature", "0");
      if (prompt?.trim()) {
        form.append("prompt", prompt.trim().slice(0, 800));
      }

      const response = await fetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
        signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        const err = new Error(
          `Transcription failed (${response.status}): ${errText.slice(0, 280)}`
        );
        (err as Error & { status?: number }).status = response.status;
        (err as Error & { body?: string }).body = errText;
        throw err;
      }

      const json = (await response.json()) as { text?: string };
      const text = (json.text || "").trim();
      if (!text) {
        throw new Error("No speech detected. Try again closer to the mic.");
      }
      return correctAsrText(text, {
        forceTechnical,
        recentText,
      });
    };

    try {
      return await attempt();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 429) {
        const wait = parseRetryAfterMs((err as Error).message);
        await new Promise((r) => setTimeout(r, wait));
        return attempt();
      }
      throw err;
    }
  });
}

function defaultWhisperModel(base: string, turbo: boolean): string {
  if (base.includes("groq.com")) {
    return turbo ? "whisper-large-v3-turbo" : "whisper-large-v3";
  }
  return "whisper-1";
}

const SCREENSHOT_PROMPT = [
  "You are reading a screenshot from a meeting, interview, slide, IDE, browser, or document.",
  "OCR the main readable prompt/task/question the user must answer.",
  "Include coding problems, titles, bullets, and chat prompts even without a question mark.",
  "Return ONLY the extracted text. Do not say you cannot help. Do not wrap in markdown.",
  "If multiple prompts are visible, return the most prominent one in full.",
  "If the image is truly blank/black with zero readable text, reply exactly: NO_QUESTION",
].join(" ");

function assertReadableQuestion(raw: string): string {
  const question = parseScreenshotQuestion(raw);
  if (!question) {
    throw new Error(
      "No readable text on the screenshot. Leave the slide or doc visible behind the overlay and try Screenshot again."
    );
  }
  return question;
}

/**
 * Use a vision model to read the on-screen question from a screenshot (PNG/JPEG base64).
 */
export async function extractQuestionFromScreenshot(options: {
  provider?: AnswerProvider;
  apiKey: string;
  apiBaseUrl: string;
  visionModel: string;
  imageBase64: string;
  mimeType?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    provider = "groq",
    apiKey,
    apiBaseUrl,
    visionModel,
    imageBase64,
    mimeType = "image/png",
    signal,
  } = options;

  if (!apiKey.trim()) {
    throw new Error(
      provider === "gemini"
        ? "Add your Gemini API key in Settings to use Screenshot Q."
        : "Add your Groq API key in Settings to use Screenshot Q."
    );
  }

  if (!imageBase64 || imageBase64.length < 500) {
    throw new Error(
      "Screenshot image was empty. Enable Screen Recording for Electron and try again."
    );
  }

  if (provider === "gemini") {
    return extractQuestionWithGemini({
      apiKey,
      model: visionModel || DEFAULT_GEMINI_MODEL,
      imageBase64,
      mimeType,
      signal,
    });
  }

  const base = apiBaseUrl.replace(/\/$/, "");
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: visionModel,
      temperature: 0.1,
      top_p: 0.8,
      max_completion_tokens: 1200,
      reasoning_effort: "none",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
            {
              type: "text",
              text: SCREENSHOT_PROMPT,
            },
          ],
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Screenshot read failed (${response.status}): ${errText.slice(0, 280)}`
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null; reasoning?: string | null };
    }>;
  };
  const message = json.choices?.[0]?.message;
  const raw = (message?.content || message?.reasoning || "").trim();
  return assertReadableQuestion(raw);
}

async function extractQuestionWithGemini(options: {
  apiKey: string;
  model: string;
  imageBase64: string;
  mimeType: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, imageBase64, mimeType, signal } = options;
  const candidates = geminiModelCandidates(options.model);
  let lastError = "";

  for (const model of candidates) {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(
      model
    )}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                },
              },
              { text: SCREENSHOT_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1200,
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      lastError = `Gemini screenshot read failed (${response.status}): ${errText.slice(0, 280)}`;
      if (isGeminiModelMissingError(response.status, errText)) continue;
      throw new Error(lastError);
    }

    const json = (await response.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    if (json.promptFeedback?.blockReason) {
      throw new Error(
        `Gemini blocked the screenshot (${json.promptFeedback.blockReason}). Try another slide or provider.`
      );
    }

    const candidate = json.candidates?.[0];
    const raw = (candidate?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();

    if (!raw) {
      throw new Error(
        `Gemini returned no text${
          candidate?.finishReason ? ` (${candidate.finishReason})` : ""
        }. Check the Gemini model/key, or switch Screenshot provider to Groq.`
      );
    }

    return assertReadableQuestion(raw);
  }

  throw new Error(
    lastError ||
      `No accessible Gemini model for screenshots. Set Gemini model in Settings to ${DEFAULT_GEMINI_MODEL}.`
  );
}

function parseScreenshotQuestion(raw: string): string {
  if (!raw) return "";
  let unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Prefer explicit JSON fields when present.
  try {
    const parsed = JSON.parse(unfenced) as Record<string, unknown>;
    const fromObj =
      (typeof parsed.question === "string" && parsed.question) ||
      (typeof parsed.text === "string" && parsed.text) ||
      (typeof parsed.prompt === "string" && parsed.prompt) ||
      (typeof parsed.task === "string" && parsed.task) ||
      "";
    if (fromObj) unfenced = fromObj;
  } catch {
    const match = unfenced.match(
      /"(?:question|text|prompt|task)"\s*:\s*"((?:\\.|[^"\\])*)"/i
    );
    if (match?.[1]) {
      unfenced = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
  }

  const cleaned = unfenced
    .replace(/^["']|["']$/g, "")
    .replace(/^\s*question\s*:\s*/i, "")
    .trim();

  if (!cleaned || /^NO_QUESTION$/i.test(cleaned)) return "";
  // Ignore tiny refusals / placeholders.
  if (cleaned.length < 3) return "";
  if (/^(n\/a|none|null|undefined)$/i.test(cleaned)) return "";
  return cleaned;
}

export async function streamAnswer(options: {
  provider?: AnswerProvider;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
}): Promise<string> {
  const {
    provider = "groq",
    apiKey,
    apiBaseUrl,
    model,
    messages,
    signal,
    onToken,
  } = options;

  if (!apiKey.trim()) {
    throw new Error(
      provider === "gemini"
        ? "Add your Gemini API key in Settings to generate cues."
        : "Add your Groq API key in Settings to generate cues."
    );
  }

  if (provider === "gemini") {
    return streamAnswerWithGemini({
      apiKey,
      model: normalizeGeminiModelId(model),
      messages,
      signal,
      onToken,
    });
  }

  const base = apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: 700,
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  if (!response.body) {
    throw new Error("No response stream from API.");
  }

  return readOpenAiSseStream(response.body, onToken);
}

async function streamAnswerWithGemini(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
}): Promise<string> {
  const { apiKey, messages, signal, onToken } = options;
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body = JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 900,
    },
  });

  const candidates = geminiModelCandidates(options.model);
  let lastError = "";

  for (const model of candidates) {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(
      model
    )}:streamGenerateContent?alt=sse`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body,
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      lastError = `Gemini error ${response.status}: ${errText.slice(0, 300)}`;
      if (isGeminiModelMissingError(response.status, errText)) continue;
      throw new Error(lastError);
    }

    if (!response.body) {
      throw new Error("No response stream from Gemini.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };
          const token = (json.candidates?.[0]?.content?.parts || [])
            .map((p) => p.text || "")
            .join("");
          if (token) {
            full += token;
            onToken(token);
          }
        } catch {
          // ignore partial JSON chunks
        }
      }
    }

    return full;
  }

  throw new Error(
    lastError ||
      `No accessible Gemini model. In Settings set Gemini model to ${DEFAULT_GEMINI_MODEL}.`
  );
}

async function readOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
  onToken: (token: string) => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = json.choices?.[0]?.delta?.content ?? "";
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {
        // ignore partial JSON chunks
      }
    }
  }

  return full;
}

export function isAbortError(err: unknown): boolean {
  return (err as Error)?.name === "AbortError";
}

/** Failures that are safe to retry on the other answer/vision provider. */
export function shouldFallbackProvider(err: unknown): boolean {
  if (isAbortError(err)) return false;
  return true;
}

export function otherAnswerProvider(
  provider: AnswerProvider
): AnswerProvider {
  return provider === "gemini" ? "groq" : "gemini";
}

/**
 * Short / referential asks that usually continue the previous answer
 * (Parakeet-style follow-ups).
 */
export function isLikelyFollowUp(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.length > 160) return false;
  if (
    /^(and |but |so |also |then |ok[, ]|okay[, ]|right[, ]|what if|what about|how about|can you also|could you also|why\b|how\b|what\b|which\b)/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(that|this|those|it|they|them|earlier|before|instead|follow[- ]?up|same|previous)\b/.test(
      t
    ) &&
    t.split(/\s+/).length <= 18
  ) {
    return true;
  }
  return /[?]/.test(t) && t.split(/\s+/).length <= 12;
}

/** Lightweight heuristic: treat short statements / thanks as non-questions. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 3) return false;
  if (isLikelyFollowUp(t)) return true;
  if (t.length < 8) return false;
  if (/[?]/.test(t)) return true;
  if (
    /^(what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|will|tell me|explain|walk me|describe)\b/.test(
      t
    )
  ) {
    return true;
  }
  // Stakeholder statements that still need a response
  if (
    /\b(concern|worried|pricing|roadmap|timeline|integration|security|competitor)\b/.test(
      t
    ) &&
    t.length > 20
  ) {
    return true;
  }
  return t.split(/\s+/).length >= 6;
}

/** Auto-answer gate: allow follow-ups when prior cues exist. */
export function shouldAutoAnswer(
  text: string,
  priorAnswerCount: number
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (priorAnswerCount > 0 && isLikelyFollowUp(t)) return true;
  return looksLikeQuestion(t);
}

/** Pull the Parakeet-style "Question:" summary from a cue answer. */
export function extractQuestionSummary(answer: string): string | null {
  const match = answer
    .trim()
    .match(/^Question:\s*(.+?)(?:\n|$)/i);
  const summary = match?.[1]?.trim();
  return summary || null;
}

/** Remove the leading Question: line so the body is just the cue. */
export function stripQuestionSummary(answer: string): string {
  return answer.replace(/^Question:\s*.+?(?:\n+|$)/i, "").trimStart();
}

export type AnswerFormat = "full-script" | "script-bullets" | "bullets";
export type AnswerLength = "short" | "balanced" | "long";
export type AnswerTone = "simple" | "formal";
export type QuestionType =
  | "behavioral"
  | "product"
  | "business"
  | "pricing"
  | "roadmap"
  | "objection"
  | "technical";

export type AnswerPreferences = {
  format: AnswerFormat;
  length: AnswerLength;
  tone: AnswerTone;
  starMethod: boolean;
  useFillerWords: boolean;
};

export type SessionPreferences = {
  language: string;
  model: string;
  autoAnswer: boolean;
  saveTranscript: boolean;
  aiInstructions: string;
  answerPreferences: AnswerPreferences;
};

export type SessionDetails = {
  companyName: string;
  description: string;
  resumeText: string;
  documentsText: string;
};

export type SessionStatus = "ready" | "ended";

export type SessionRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  status: SessionStatus;
  details: SessionDetails;
  preferences: SessionPreferences;
};

export type TranscriptItem = {
  id: string;
  role: "client" | "me" | "cue" | "stakeholder";
  text: string;
  createdAt: number;
};

export const DEFAULT_ANSWER_PREFERENCES: AnswerPreferences = {
  format: "script-bullets",
  length: "short",
  tone: "simple",
  starMethod: false,
  useFillerWords: false,
};

export const DEFAULT_SESSION_PREFERENCES: SessionPreferences = {
  language: "English",
  /** Default Groq chat id paired with the Whisper speech preset. */
  model: "openai/gpt-oss-120b",
  autoAnswer: true,
  saveTranscript: true,
  aiInstructions: "",
  answerPreferences: { ...DEFAULT_ANSWER_PREFERENCES },
};

export const DEFAULT_SESSION_DETAILS: SessionDetails = {
  companyName: "",
  description: "",
  resumeText: "",
  documentsText: "",
};

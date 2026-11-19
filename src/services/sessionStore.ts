import { normalizeGeminiModelId } from "./providers";
import type { SessionRecord, TranscriptItem } from "../types/session";

const SESSIONS_KEY = "meeting-cue.sessions.v1";
const ACTIVE_KEY = "meeting-cue.active-session.v1";
const TRANSCRIPT_PREFIX = "meeting-cue.transcript.";
const ANSWERS_PREFIX = "meeting-cue.answers.";

export type AnswerTurn = {
  id: string;
  question: string;
  answer: string;
  createdAt: number;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeSession(session: SessionRecord): SessionRecord {
  const model = session.preferences?.model;
  const nextModel =
    model && model.startsWith("gemini")
      ? normalizeGeminiModelId(model)
      : model;
  return {
    ...session,
    status: session.status === "ended" ? "ended" : "ready",
    preferences: {
      ...session.preferences,
      model: nextModel || session.preferences.model,
    },
  };
}

export function listSessions(): SessionRecord[] {
  const sessions = readJson<SessionRecord[]>(SESSIONS_KEY, []).map(
    normalizeSession
  );
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): SessionRecord | null {
  return listSessions().find((s) => s.id === id) ?? null;
}

export function saveSession(session: SessionRecord): void {
  const sessions = listSessions();
  const normalized = normalizeSession(session);
  const idx = sessions.findIndex((s) => s.id === normalized.id);
  if (idx >= 0) sessions[idx] = normalized;
  else sessions.unshift(normalized);
  writeJson(SESSIONS_KEY, sessions);
}

export function deleteSession(id: string): void {
  writeJson(
    SESSIONS_KEY,
    listSessions().filter((s) => s.id !== id)
  );
  localStorage.removeItem(`${TRANSCRIPT_PREFIX}${id}`);
  localStorage.removeItem(`${ANSWERS_PREFIX}${id}`);
  if (getActiveSessionId() === id) setActiveSessionId(null);
}

export function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveSessionId(id: string | null): void {
  if (!id) localStorage.removeItem(ACTIVE_KEY);
  else localStorage.setItem(ACTIVE_KEY, id);
}

export function loadTranscript(sessionId: string): TranscriptItem[] {
  return readJson<TranscriptItem[]>(`${TRANSCRIPT_PREFIX}${sessionId}`, []);
}

export function saveTranscript(sessionId: string, items: TranscriptItem[]) {
  writeJson(`${TRANSCRIPT_PREFIX}${sessionId}`, items.slice(-200));
}

export function clearTranscript(sessionId: string) {
  localStorage.removeItem(`${TRANSCRIPT_PREFIX}${sessionId}`);
}

export function loadAnswerHistory(sessionId: string): AnswerTurn[] {
  return readJson<AnswerTurn[]>(`${ANSWERS_PREFIX}${sessionId}`, []);
}

export function saveAnswerHistory(sessionId: string, turns: AnswerTurn[]) {
  writeJson(`${ANSWERS_PREFIX}${sessionId}`, turns.slice(-50));
}

export function clearAnswerHistory(sessionId: string) {
  localStorage.removeItem(`${ANSWERS_PREFIX}${sessionId}`);
}

/** Mark a live run finished — transcript/answers stay for review. */
export function endSessionRun(session: SessionRecord): SessionRecord {
  const ended: SessionRecord = {
    ...normalizeSession(session),
    status: "ended",
    endedAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveSession(ended);
  setActiveSessionId(null);
  return ended;
}

/** Reuse the same company/prefs; wipe prior run transcript + answers. */
export function restartSessionRun(session: SessionRecord): SessionRecord {
  clearTranscript(session.id);
  clearAnswerHistory(session.id);
  const next: SessionRecord = {
    ...normalizeSession(session),
    status: "ready",
    endedAt: undefined,
    updatedAt: Date.now(),
  };
  saveSession(next);
  setActiveSessionId(null);
  return next;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSessionSystemPrompt,
  extractQuestionFromScreenshot,
  extractQuestionSummary,
  isAbortError,
  isLikelyFollowUp,
  otherAnswerProvider,
  shouldAutoAnswer,
  shouldFallbackProvider,
  streamAnswer,
  stripQuestionSummary,
} from "../services/ai";
import {
  buildAsrPrompt,
  extractSessionAsrTerms,
} from "../services/asrVocabulary";
import { DualLiveTranscriber } from "../services/liveTranscriber";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_PRESET,
  DEFAULT_VISION_MODEL,
  type AnswerProvider,
} from "../services/providers";
import {
  endSessionRun,
  loadAnswerHistory,
  loadTranscript,
  saveAnswerHistory,
  saveSession,
  saveTranscript,
  type AnswerTurn,
} from "../services/sessionStore";
import type {
  QuestionType,
  SessionRecord,
  TranscriptItem,
} from "../types/session";
import { useClickOutside } from "../hooks/useClickOutside";
import { useFloatDrag } from "../hooks/useFloatDrag";
import { AnswerContent } from "./AnswerContent";
import { AnswerPreferencesModal } from "./AnswerPreferencesModal";

type AppSettings = {
  apiKey: string;
  geminiApiKey?: string;
  apiBaseUrl: string;
  whisperModel: string;
  visionModel?: string;
  geminiModel?: string;
  model?: string;
  answerProvider?: AnswerProvider;
  uiOpacity?: number;
};

type Props = {
  session: SessionRecord;
  settings: AppSettings;
  onUpdateSession: (session: SessionRecord) => void;
  onExit: () => void;
  onOpenSettings: () => void;
};

type OverlayMode = "overlay" | "answer" | "bubble";
type PanelTab = "answer" | "transcript";

export function LiveSession({
  session,
  settings,
  onUpdateSession,
  onExit,
  onOpenSettings,
}: Props) {
  const [questionType, setQuestionType] = useState<QuestionType>("product");
  const [liveClient, setLiveClient] = useState("");
  const [liveMe, setLiveMe] = useState("");
  const [typedQuestion, setTypedQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState(session.preferences.autoAnswer);
  const [micOn, setMicOn] = useState(true);
  const [systemOn, setSystemOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setShowMenu(false), []);
  useClickOutside(menuRef, showMenu, closeMenu);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("answer");
  const [panelTab, setPanelTab] = useState<PanelTab>("answer");
  const [liveOpacity, setLiveOpacity] = useState(settings.uiOpacity ?? 0.72);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptItem[]>(() =>
    loadTranscript(session.id)
  );
  const [answerHistory, setAnswerHistory] = useState<AnswerTurn[]>(() =>
    loadAnswerHistory(session.id)
  );
  const [historyIndex, setHistoryIndex] = useState(() => {
    const loaded = loadAnswerHistory(session.id);
    return loaded.length ? loaded.length - 1 : -1;
  });
  const [availabilityNote, setAvailabilityNote] = useState<string | null>(null);
  const [availabilityOk, setAvailabilityOk] = useState(true);

  const liveRef = useRef(new DualLiveTranscriber());
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(session);
  const answerHistoryRef = useRef(answerHistory);
  const answeringRef = useRef(false);
  const startedAtRef = useRef(Date.now());
  sessionRef.current = session;
  answerHistoryRef.current = answerHistory;

  const activeQuestion = useMemo(() => {
    return (
      typedQuestion.trim() ||
      liveClient.trim() ||
      liveMe.trim()
    );
  }, [liveClient, liveMe, typedQuestion]);

  const liveHint = useMemo(() => {
    if (listening) {
      const parts = [
        micOn ? "mic" : null,
        systemOn ? "system" : null,
      ].filter(Boolean);
      return parts.length
        ? `Listening (${parts.join(" + ")})`
        : "Both audio sources are off";
    }
    return "Type a question below, or use mic / Screenshot";
  }, [listening, micOn, systemOn]);

  const asrPrompt = useMemo(() => {
    return buildAsrPrompt({
      companyName: session.details.companyName,
      description: session.details.description,
      language: session.preferences.language,
      extraTerms: extractSessionAsrTerms(
        session.preferences.aiInstructions,
        session.details.resumeText,
        session.details.documentsText,
        session.details.companyName,
        session.details.description
      ),
    });
  }, [
    session.details.companyName,
    session.details.description,
    session.details.documentsText,
    session.details.resumeText,
    session.preferences.aiInstructions,
    session.preferences.language,
  ]);

  const setMode = useCallback(async (mode: OverlayMode) => {
    setOverlayMode(mode);
    await window.meetingCue?.setWindowMode?.(mode);
  }, []);

  useEffect(() => {
    void setMode("answer");
    document.documentElement.classList.add("cue-live-cursor");
    return () => {
      document.documentElement.classList.remove("cue-live-cursor");
      void window.meetingCue?.setWindowMode?.("home");
      void window.meetingCue?.setWindowOpacity?.(1);
    };
  }, [setMode]);

  useEffect(() => {
    let clearTimer: number | undefined;
    const offAvailability = window.meetingCue?.onWindowAvailability?.(
      (payload) => {
        if (clearTimer) window.clearTimeout(clearTimer);
        setAvailabilityOk(Boolean(payload.available));
        setAvailabilityNote(payload.message);
        // Unavailable stays until restored; restored tips auto-clear.
        if (payload.available) {
          clearTimer = window.setTimeout(() => setAvailabilityNote(null), 6000);
        }
      }
    );
    const offLifecycle = window.meetingCue?.onWindowLifecycle?.((payload) => {
      if (import.meta.env.DEV) {
        console.debug("[window-lifecycle]", payload);
      }
      if (payload.event === "external-fullscreen-unavailable") {
        setAvailabilityOk(false);
        setAvailabilityNote(
          "Assistant may be hidden behind exclusive full-screen. Exit full screen (Esc / F11) to restore, or enable Stay above browser fullscreen for authorized practice."
        );
      }
      if (payload.event === "restored-after-external-fullscreen") {
        if (clearTimer) window.clearTimeout(clearTimer);
        setAvailabilityOk(true);
        setAvailabilityNote("Meeting Cue is visible again.");
        clearTimer = window.setTimeout(() => setAvailabilityNote(null), 4000);
      }
    });
    return () => {
      if (clearTimer) window.clearTimeout(clearTimer);
      offAvailability?.();
      offLifecycle?.();
    };
  }, []);

  const viewedTurn =
    historyIndex >= 0 && historyIndex < answerHistory.length
      ? answerHistory[historyIndex]
      : null;
  const rawAnswer = busy ? answer : viewedTurn?.answer || answer;
  const summarizedQuestion =
    extractQuestionSummary(rawAnswer) ||
    (!busy ? viewedTurn?.question : null) ||
    activeQuestion;
  const displayQuestion = summarizedQuestion
    ? summarizedQuestion.startsWith("Question:")
      ? summarizedQuestion
      : `Question: ${summarizedQuestion}`
    : "";
  const displayAnswer = stripQuestionSummary(rawAnswer);

  useEffect(() => {
    const o = Math.min(1, Math.max(0.35, liveOpacity));
    document.documentElement.style.setProperty("--glass-opacity", String(o));
    document.documentElement.style.setProperty(
      "--cue-glass",
      `rgba(12, 16, 22, ${0.28 + o * 0.55})`
    );
    document.documentElement.style.setProperty(
      "--cue-glass-strong",
      `rgba(12, 16, 22, ${0.38 + o * 0.55})`
    );
    void window.meetingCue?.setWindowOpacity?.(o);
  }, [liveOpacity]);

  // Move with drag handle / empty chrome; resize still keyboard-only.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const force = e.metaKey || e.ctrlKey || e.altKey;
      if (typing && !force) return;
      if (overlayMode === "bubble") return;

      const step = e.shiftKey ? 48 : 16;
      const resizeStep = e.shiftKey ? 64 : 28;

      // Resize: Alt/Option + arrows (or [ ] / - =)
      const resizing = e.altKey;
      if (resizing) {
        let dw = 0;
        let dh = 0;
        if (e.key === "ArrowLeft" || e.key === "-" || e.key === "[")
          dw = -resizeStep;
        else if (e.key === "ArrowRight" || e.key === "=" || e.key === "]")
          dw = resizeStep;
        else if (e.key === "ArrowUp") dh = -resizeStep;
        else if (e.key === "ArrowDown") dh = resizeStep;
        else return;
        e.preventDefault();
        void window.meetingCue?.resizeWindowBy?.(dw, dh);
        return;
      }

      if (e.key === "[" || e.key === "-") {
        e.preventDefault();
        void window.meetingCue?.resizeWindowBy?.(-resizeStep, 0);
        return;
      }
      if (e.key === "]" || e.key === "=") {
        e.preventDefault();
        void window.meetingCue?.resizeWindowBy?.(resizeStep, 0);
        return;
      }

      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;

      e.preventDefault();
      void window.meetingCue?.nudgeWindow?.(dx, dy);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayMode]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const pushLine = useCallback(
    (role: TranscriptItem["role"], text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setTranscript((prev) => {
        const next: TranscriptItem[] = [
          {
            id: crypto.randomUUID(),
            role,
            text: clean,
            createdAt: Date.now(),
          },
          ...prev,
        ].slice(0, 200);
        saveTranscript(session.id, next);
        return next;
      });
    },
    [session.id]
  );

  const clearLive = useCallback(() => {
    setLiveClient("");
    setLiveMe("");
    setTypedQuestion("");
    setError(null);
    setStatus(listening ? "Listening..." : "Ready");
  }, [listening]);

  const keyForProvider = useCallback(
    (provider: AnswerProvider) =>
      provider === "gemini"
        ? settings.geminiApiKey?.trim() || ""
        : settings.apiKey.trim(),
    [settings.apiKey, settings.geminiApiKey]
  );

  const modelForProvider = useCallback(
    (provider: AnswerProvider, sessionModel?: string) =>
      provider === "gemini"
        ? settings.geminiModel || DEFAULT_GEMINI_MODEL
        : sessionModel || settings.model || DEFAULT_PRESET.model,
    [settings.geminiModel, settings.model]
  );

  const visionModelForProvider = useCallback(
    (provider: AnswerProvider) =>
      provider === "gemini"
        ? settings.geminiModel || DEFAULT_GEMINI_MODEL
        : settings.visionModel || DEFAULT_VISION_MODEL,
    [settings.geminiModel, settings.visionModel]
  );

  const generateForQuestion = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || answeringRef.current) return;
      const priorTurns = answerHistoryRef.current.slice(-6);
      if (autoOn && !shouldAutoAnswer(q, priorTurns.length)) {
        setStatus("Waiting for a clearer question...");
        return;
      }
      const primary = settings.answerProvider || "gemini";
      const secondary = otherAnswerProvider(primary);
      const primaryKey = keyForProvider(primary);
      const secondaryKey = keyForProvider(secondary);

      if (!primaryKey && !secondaryKey) {
        setError("Add a Gemini or Groq API key in Settings first.");
        onOpenSettings();
        return;
      }

      const order: AnswerProvider[] = primaryKey
        ? secondaryKey
          ? [primary, secondary]
          : [primary]
        : [secondary];

      answeringRef.current = true;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      setAnswer("");
      await setMode("answer");

      const current = sessionRef.current;
      const followUp = priorTurns.length > 0 && isLikelyFollowUp(q);
      const lastTurn = priorTurns[priorTurns.length - 1];
      const priorMessages = priorTurns.flatMap((turn) => [
        {
          role: "user" as const,
          content: `Interviewer asked:\n${turn.question}`,
        },
        {
          role: "assistant" as const,
          content: turn.answer,
        },
      ]);
      const followUpBlock =
        followUp && lastTurn
          ? `\n\nThis looks like a follow-up to the previous exchange.\nPrevious question: ${lastTurn.question}\nContinue that same thread — expand the Question: line into the full implied question, and build on the previous cue (do not switch topics).`
          : priorTurns.length
            ? `\n\nEarlier Q&A is included above. If this continues that thread, stay consistent; if it is a new topic, answer freshly.`
            : "";
      const messages = [
        {
          role: "system" as const,
          content: buildSessionSystemPrompt(current, questionType),
        },
        ...priorMessages,
        {
          role: "user" as const,
          content: `Interviewer just asked:\n${q}${followUpBlock}\n\nGive me private talking points now using my session preferences. Start with "Question:" then the cue.`,
        },
      ];

      try {
        let lastError: Error | null = null;
        for (let i = 0; i < order.length; i++) {
          const provider = order[i]!;
          const label = provider === "gemini" ? "Gemini" : "Groq";
          setStatus(
            i === 0
              ? `Generating answer with ${label}...`
              : `${order[0] === "gemini" ? "Gemini" : "Groq"} failed — switching to ${label}...`
          );
          setAnswer("");
          try {
            const full = await streamAnswer({
              provider,
              apiKey: keyForProvider(provider),
              apiBaseUrl: settings.apiBaseUrl || DEFAULT_PRESET.apiBaseUrl,
              model: modelForProvider(provider, current.preferences.model),
              signal: controller.signal,
              messages,
              onToken: (token) => setAnswer((prev) => prev + token),
            });
            const turn: AnswerTurn = {
              id: crypto.randomUUID(),
              question: q,
              answer: full,
              createdAt: Date.now(),
            };
            setAnswerHistory((prev) => {
              const next = [...prev, turn].slice(-50);
              saveAnswerHistory(session.id, next);
              setHistoryIndex(next.length - 1);
              return next;
            });
            pushLine("cue", `Q: ${q}\n\n${full}`);
            setTypedQuestion(q);
            setStatus(
              i === 0 ? "Answer ready" : `Answer ready (via ${label} fallback)`
            );
            lastError = null;
            break;
          } catch (err) {
            if (isAbortError(err)) return;
            lastError = err as Error;
            if (
              i < order.length - 1 &&
              shouldFallbackProvider(err) &&
              keyForProvider(order[i + 1]!)
            ) {
              continue;
            }
            setError(lastError.message || "Failed to generate answer.");
            setStatus("Error");
            return;
          }
        }

        if (lastError) {
          setError(lastError.message || "Failed to generate answer.");
          setStatus("Error");
        }
      } finally {
        setBusy(false);
        answeringRef.current = false;
      }
    },
    [
      autoOn,
      keyForProvider,
      modelForProvider,
      onOpenSettings,
      pushLine,
      questionType,
      session.id,
      setMode,
      settings.answerProvider,
      settings.apiBaseUrl,
    ]
  );

  const stopListening = useCallback(async () => {
    await liveRef.current.stop();
    setListening(false);
    setStatus("Ready");
  }, []);

  const bindHandlers = useCallback(
    () => ({
      onPartial: (speaker: "client" | "me", text: string) => {
        if (speaker === "client") {
          setLiveClient(text);
          setTypedQuestion(text);
        } else setLiveMe(text);
      },
      onFinal: (speaker: "client" | "me", text: string) => {
        pushLine(speaker, text);
        if (speaker === "client") {
          setLiveClient(text);
          setTypedQuestion(text);
        } else setLiveMe(text);
      },
      onClientQuestion: (text: string) => {
        setTypedQuestion(text);
        if (autoOn) {
          // Prefer technical mode when code-like content appears on screen/audio.
          if (
            /\b(leetcode|complexity|algorithm|function|class |def |array|string)\b/i.test(
              text
            )
          ) {
            setQuestionType("technical");
          }
          void generateForQuestion(text);
        }
      },
      onStatus: (message: string) => setStatus(message),
      onError: (message: string) => setError(message),
    }),
    [autoOn, generateForQuestion, pushLine]
  );

  const startListening = useCallback(
    async (opts?: { mic?: boolean; client?: boolean }) => {
      const wantMic = opts?.mic ?? micOn;
      const wantClient = opts?.client ?? systemOn;
      setError(null);

      if (wantMic && window.meetingCue) {
        const access = await window.meetingCue.ensureMicrophone();
        if (!access.granted) {
          setError(access.message || "Microphone permission required.");
          return;
        }
      }
      if (!settings.apiKey.trim()) {
        setError("Add your Groq API key in Settings first.");
        onOpenSettings();
        return;
      }
      if (!wantMic && !wantClient) {
        setError("Turn on Mic and/or System audio first.");
        return;
      }

      await liveRef.current.start({
        config: {
          apiKey: settings.apiKey,
          apiBaseUrl: settings.apiBaseUrl,
          // Accurate model on finals; turbo on partials for snappy live text.
          whisperModel: settings.whisperModel || DEFAULT_PRESET.whisperModel,
          whisperModelPartial: "whisper-large-v3-turbo",
          prompt: asrPrompt,
          language: session.preferences.language,
          // Always apply interview vocabulary + mishear fixes (not only coding).
          forceTechnical: true,
        },
        mic: wantMic,
        client: wantClient,
        handlers: bindHandlers(),
      });

      setMicOn(liveRef.current.hasMic);
      setSystemOn(liveRef.current.hasClient);
      setListening(liveRef.current.hasMic || liveRef.current.hasClient);
    },
    [
      asrPrompt,
      bindHandlers,
      micOn,
      onOpenSettings,
      session.preferences.language,
      settings.apiBaseUrl,
      settings.apiKey,
      settings.whisperModel,
      systemOn,
    ]
  );

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    setError(null);
    if (!listening) {
      setMicOn(next);
      if (next || systemOn) await startListening({ mic: next, client: systemOn });
      return;
    }
    if (next && window.meetingCue) {
      const access = await window.meetingCue.ensureMicrophone();
      if (!access.granted) {
        setError(access.message || "Microphone permission required.");
        return;
      }
    }
    await liveRef.current.setMicEnabled(next);
    setMicOn(liveRef.current.hasMic);
    setListening(liveRef.current.hasMic || liveRef.current.hasClient);
    if (!liveRef.current.hasMic) setLiveMe("");
  }, [listening, micOn, startListening, systemOn]);

  const toggleSystem = useCallback(async () => {
    const next = !systemOn;
    setError(null);
    if (!listening) {
      setSystemOn(next);
      if (micOn || next) await startListening({ mic: micOn, client: next });
      return;
    }
    if (next) {
      await liveRef.current.setClientEnabled(true);
    } else {
      await liveRef.current.setClientEnabled(false);
    }
    setSystemOn(liveRef.current.hasClient);
    setListening(liveRef.current.hasMic || liveRef.current.hasClient);
    if (!liveRef.current.hasClient) setLiveClient("");
  }, [listening, micOn, startListening, systemOn]);

  const endSession = useCallback(() => {
    void liveRef.current.stop();
    abortRef.current?.abort();
    saveTranscript(session.id, transcript);
    saveAnswerHistory(session.id, answerHistory);
    const ended = endSessionRun(sessionRef.current);
    onUpdateSession(ended);
    void window.meetingCue?.setWindowMode?.("home");
    onExit();
  }, [answerHistory, onExit, onUpdateSession, session.id, transcript]);

  const scanScreenForQuestion = useCallback(async () => {
    if (!window.meetingCue?.captureScreen) {
      setError("Screenshot capture is only available in the desktop app.");
      return;
    }
    const primary = settings.answerProvider || "gemini";
    const secondary = otherAnswerProvider(primary);
    const primaryKey = keyForProvider(primary);
    const secondaryKey = keyForProvider(secondary);
    if (!primaryKey && !secondaryKey) {
      setError("Add a Gemini or Groq API key in Settings first.");
      onOpenSettings();
      return;
    }

    const order: AnswerProvider[] = primaryKey
      ? secondaryKey
        ? [primary, secondary]
        : [primary]
      : [secondary];

    setScanning(true);
    setError(null);
    setStatus("Capturing screen...");
    // Pause mic/system Whisper briefly so Screenshot (vision) isn't drowned by RPM errors.
    const resumeMic = micOn;
    const resumeSystem = systemOn;
    try {
      if (listening) {
        if (micOn) await liveRef.current.setMicEnabled(false);
        if (systemOn) await liveRef.current.setClientEnabled(false);
      }
      const shot = await window.meetingCue.captureScreen();

      let question = "";
      let lastError: Error | null = null;
      for (let i = 0; i < order.length; i++) {
        const provider = order[i]!;
        const label = provider === "gemini" ? "Gemini" : "Groq";
        setStatus(
          i === 0
            ? `Reading question with ${label}...`
            : `${order[0] === "gemini" ? "Gemini" : "Groq"} failed — switching to ${label}...`
        );
        try {
          question = await extractQuestionFromScreenshot({
            provider,
            apiKey: keyForProvider(provider),
            apiBaseUrl: settings.apiBaseUrl,
            visionModel: visionModelForProvider(provider),
            imageBase64: shot.base64,
            mimeType: shot.mimeType,
          });
          lastError = null;
          break;
        } catch (err) {
          if (isAbortError(err)) throw err;
          lastError = err as Error;
          if (
            i < order.length - 1 &&
            shouldFallbackProvider(err) &&
            keyForProvider(order[i + 1]!)
          ) {
            continue;
          }
          throw lastError;
        }
      }

      if (!question) {
        throw lastError || new Error("Screenshot read failed.");
      }

      setLiveClient(question);
      setTypedQuestion(question);
      pushLine("client", `[Screen] ${question}`);
      if (
        /\b(leetcode|algorithm|complexity|function|class |def |code|array|string|implement)\b/i.test(
          question
        )
      ) {
        setQuestionType("technical");
      }
      await generateForQuestion(question);
    } catch (err) {
      if (isAbortError(err)) return;
      const msg = (err as Error).message || "Screenshot failed.";
      // Whisper RPM noise shouldn't look like Screenshot failure.
      if (msg.includes("whisper") || msg.includes("Transcription failed")) {
        setStatus(
          "Vision read OK path blocked by audio rate limit — retry Screenshot in a few seconds."
        );
      }
      setError(msg);
      setStatus("Ready");
    } finally {
      if (listening) {
        if (resumeMic) await liveRef.current.setMicEnabled(true);
        if (resumeSystem) await liveRef.current.setClientEnabled(true);
      }
      setScanning(false);
    }
  }, [
    generateForQuestion,
    keyForProvider,
    listening,
    micOn,
    onOpenSettings,
    pushLine,
    settings.answerProvider,
    settings.apiBaseUrl,
    systemOn,
    visionModelForProvider,
  ]);

  const toggleBubble = useCallback(() => {
    if (overlayMode === "bubble") {
      void setMode(answerHistory.length || answer ? "answer" : "overlay");
    } else void setMode("bubble");
  }, [answer, answerHistory.length, overlayMode, setMode]);

  useEffect(() => {
    if (autoOn) void startListening({ mic: true, client: true });
    return () => {
      void liveRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const offs = [
      window.meetingCue?.onScreenshotQuestion?.(() => {
        void scanScreenForQuestion();
      }),
      window.meetingCue?.onGenerateAnswer?.(() => {
        void generateForQuestion(activeQuestion);
      }),
      window.meetingCue?.onToggleBubble?.(toggleBubble),
      window.meetingCue?.onEnterFloat?.(() => {
        setOverlayMode("bubble");
      }),
      window.meetingCue?.onExitFloat?.((payload) => {
        const mode =
          payload.mode === "answer" || payload.mode === "overlay"
            ? payload.mode
            : answer
              ? "answer"
              : "overlay";
        setOverlayMode(mode);
      }),
      window.meetingCue?.onClearTranscript?.(clearLive),
      window.meetingCue?.onToggleListen?.(() => {
        if (listening) void stopListening();
        else void startListening({ mic: micOn, client: systemOn });
      }),
    ];
    return () => offs.forEach((off) => off?.());
  }, [
    activeQuestion,
    answer,
    clearLive,
    generateForQuestion,
    listening,
    micOn,
    scanScreenForQuestion,
    startListening,
    stopListening,
    systemOn,
    toggleBubble,
  ]);

  const onUpdateSessionRef = useRef(onUpdateSession);
  onUpdateSessionRef.current = onUpdateSession;

  useEffect(() => {
    const updated = {
      ...sessionRef.current,
      preferences: {
        ...sessionRef.current.preferences,
        autoAnswer: autoOn,
      },
      updatedAt: Date.now(),
    };
    saveSession(updated);
    onUpdateSessionRef.current(updated);
  }, [autoOn]);

  const bubbleDrag = useFloatDrag(() => {
    void setMode(answerHistory.length || answer ? "answer" : "overlay");
  });
  const overlayDrag = useFloatDrag();

  if (overlayMode === "bubble") {
    return (
      <div className="float-root">
        <button
          type="button"
          className={`float-circle ${listening ? "live" : ""}`}
          title="Drag to move · click to restore"
          {...bubbleDrag}
        >
          <span className="float-circle-wave" />
          <span className="float-circle-timer">{formatTimer(elapsed)}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`cue-overlay ${overlayMode}`}
      onPointerDown={overlayDrag.onPointerDown}
      onPointerMove={overlayDrag.onPointerMove}
      onPointerUp={overlayDrag.onPointerUp}
      onPointerCancel={overlayDrag.onPointerCancel}
      style={overlayDrag.style}
    >
      {availabilityNote ? (
        <div
          className={`cue-availability-banner ${
            availabilityOk ? "is-restored" : "is-unavailable"
          }`}
          role="status"
        >
          <span>{availabilityNote}</span>
          <button
            type="button"
            className="cue-icon-btn"
            title="Dismiss"
            onClick={() => setAvailabilityNote(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="cue-pill">
        <div className="cue-sources">
          <button
            type="button"
            className={`cue-source ${systemOn && listening ? "on" : ""}`}
            title="System / client audio"
            onClick={() => void toggleSystem()}
          >
            💻
            {systemOn && listening ? <i className="cue-dot" /> : null}
          </button>
          <button
            type="button"
            className={`cue-source ${micOn && listening ? "on" : ""}`}
            title="My microphone"
            onClick={() => void toggleMic()}
          >
            🎤
            {micOn && listening ? <i className="cue-dot" /> : null}
          </button>
        </div>

        <button
          type="button"
          className="cue-action"
          disabled={busy || !activeQuestion}
          onClick={() => void generateForQuestion(activeQuestion)}
        >
          Answer <span>⌘↵</span>
        </button>
        <button
          type="button"
          className={`cue-action ${scanning ? "active" : ""}`}
          disabled={scanning || busy}
          onClick={() => void scanScreenForQuestion()}
        >
          Screenshot <span>⌘⇧↵</span>
        </button>
        <button
          type="button"
          className="cue-action ghost"
          onClick={() => void setMode(overlayMode === "answer" ? "overlay" : "answer")}
        >
          Chat <span>⌘⇧_</span>
        </button>

        <div className="cue-tools">
          <div className="cue-move" title="Drag to move · arrows also work">
            ✥
          </div>
          <button
            type="button"
            className="cue-icon-btn"
            title="Minimize to bubble"
            onClick={toggleBubble}
          >
            ↙↗
          </button>
          <div className="cue-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="cue-icon-btn"
              onClick={() => setShowMenu((v) => !v)}
            >
              ⋮
            </button>
            {showMenu ? (
              <div className="cue-menu">
                <div className="cue-menu-section">
                  <span>Opacity</span>
                  <div className="cue-menu-opacity">
                    <input
                      type="range"
                      min={35}
                      max={100}
                      value={Math.round(liveOpacity * 100)}
                      onChange={(e) =>
                        setLiveOpacity(Number(e.target.value) / 100)
                      }
                    />
                    <em>{Math.round(liveOpacity * 100)}%</em>
                  </div>
                </div>
                <p className="cue-menu-hint">
                  Drag chrome to move · ←→↑↓ · Resize Alt+arrows or [ ]
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowPrefs(true);
                    setShowMenu(false);
                  }}
                >
                  Answer prefs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuestionType("technical");
                    setShowMenu(false);
                  }}
                >
                  Mode: Coding / technical
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuestionType("product");
                    setShowMenu(false);
                  }}
                >
                  Mode: Product / meeting
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoOn((v) => !v);
                    setShowMenu(false);
                  }}
                >
                  Auto Answer: {autoOn ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenSettings();
                    setShowMenu(false);
                  }}
                >
                  API settings
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setShowMenu(false);
                    endSession();
                  }}
                >
                  End session
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="cue-end"
            title="End interview session"
            onClick={endSession}
          >
            End
          </button>
          <div className="cue-timer">{formatTimer(elapsed)}</div>
        </div>
      </div>

      <div className="cue-transcript-pill">
        <span className={`cue-wave ${listening ? "live" : ""}`} />
        <div className="cue-input-wrap">
          <div className="cue-input-hint">
            {error ? <span className="cue-error">{error}</span> : liveHint}
          </div>
          <input
            className="cue-question-input"
            value={typedQuestion}
            onChange={(e) => setTypedQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (activeQuestion) void generateForQuestion(activeQuestion);
              }
            }}
            placeholder="Type a question here, then press Answer…"
          />
        </div>
        <button type="button" className="cue-clear" onClick={clearLive}>
          Clear <span>⌘⇧⌫</span>
        </button>
        <button
          type="button"
          className="cue-icon-btn"
          title={overlayMode === "answer" ? "Collapse answer" : "Expand answer"}
          onClick={() =>
            void setMode(overlayMode === "answer" ? "overlay" : "answer")
          }
        >
          ⤢
        </button>
      </div>

      {overlayMode === "answer" ? (
        <section className="cue-answer-panel">
          <div className="cue-answer-top">
            <div className="cue-panel-tabs">
              <button
                type="button"
                className={panelTab === "answer" ? "active" : ""}
                onClick={() => setPanelTab("answer")}
              >
                Answer
              </button>
              <button
                type="button"
                className={panelTab === "transcript" ? "active" : ""}
                onClick={() => setPanelTab("transcript")}
              >
                Transcript
                {transcript.length ? (
                  <em className="cue-tab-count">{transcript.length}</em>
                ) : null}
              </button>
            </div>
            {panelTab === "answer" ? (
              <div className="cue-answer-nav">
                <button
                  type="button"
                  className="cue-icon-btn"
                  title="Previous answer"
                  disabled={busy || historyIndex <= 0}
                  onClick={() => setHistoryIndex((i) => Math.max(0, i - 1))}
                >
                  ‹
                </button>
                <span className="cue-history-count">
                  {answerHistory.length
                    ? `${Math.max(1, historyIndex + 1)} / ${answerHistory.length}`
                    : "0 / 0"}
                </span>
                <button
                  type="button"
                  className="cue-icon-btn"
                  title="Next answer"
                  disabled={
                    busy ||
                    historyIndex < 0 ||
                    historyIndex >= answerHistory.length - 1
                  }
                  onClick={() =>
                    setHistoryIndex((i) =>
                      Math.min(answerHistory.length - 1, i + 1)
                    )
                  }
                >
                  ›
                </button>
                <button
                  type="button"
                  className="cue-clear"
                  disabled={busy || (!displayAnswer && !answerHistory.length)}
                  onClick={() => {
                    if (historyIndex >= 0 && answerHistory.length) {
                      setAnswerHistory((prev) => {
                        const next = prev.filter(
                          (_, idx) => idx !== historyIndex
                        );
                        saveAnswerHistory(session.id, next);
                        setHistoryIndex(
                          next.length
                            ? Math.min(historyIndex, next.length - 1)
                            : -1
                        );
                        return next;
                      });
                    }
                    setAnswer("");
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="cue-answer-nav">
                <span className="cue-history-count">
                  {transcript.length} lines
                </span>
              </div>
            )}
            <button
              type="button"
              className="cue-icon-btn"
              onClick={() => void setMode("overlay")}
            >
              ↘
            </button>
          </div>
          <div className="cue-answer-body">
            {panelTab === "answer" ? (
              <>
                {displayQuestion ? (
                  <p className="cue-q">
                    <strong>Question:</strong>{" "}
                    {displayQuestion.replace(/^Question:\s*/i, "")}
                  </p>
                ) : null}
                <div className="cue-a">
                  <strong>
                    ✦ Answer {questionType === "technical" ? "· Coding" : ""}
                    {!busy && answerHistory.length > 1 ? " · History" : ""}
                  </strong>
                  {displayAnswer ? (
                    <AnswerContent text={displayAnswer} />
                  ) : (
                    <div>
                      {busy
                        ? "Streaming..."
                        : status === "Ready"
                          ? "Use Answer or Screenshot to generate a cue."
                          : status}
                    </div>
                  )}
                </div>
                <div className="cue-meta">
                  <span>‹ › history · drag to move · ←→↑↓</span>
                  {viewedTurn ? (
                    <span>
                      {new Date(viewedTurn.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="cue-live-transcript">
                {transcript.length === 0 ? (
                  <p className="cue-empty">
                    Spoken lines and cues will appear here during the session.
                  </p>
                ) : (
                  transcript.map((line) => (
                    <article
                      key={line.id}
                      className={`transcript-line ${
                        line.role === "stakeholder" ? "client" : line.role
                      }`}
                    >
                      <div className="meta-row" style={{ margin: 0 }}>
                        <strong>
                          {line.role === "me"
                            ? "You"
                            : line.role === "cue"
                              ? "Cue"
                              : "Client"}
                        </strong>
                        <span>
                          {new Date(line.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p>{line.text}</p>
                    </article>
                  ))
                )}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {showPrefs ? (
        <AnswerPreferencesModal
          value={session.preferences.answerPreferences}
          onClose={() => setShowPrefs(false)}
          onSave={(answerPreferences) => {
            const updated = {
              ...session,
              preferences: { ...session.preferences, answerPreferences },
              updatedAt: Date.now(),
            };
            saveSession(updated);
            onUpdateSession(updated);
            setShowPrefs(false);
          }}
        />
      ) : null}
    </div>
  );
}

function formatTimer(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

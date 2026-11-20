import { useCallback, useEffect, useRef, useState } from "react";
import { CreateSession } from "./components/CreateSession";
import { LiveSession } from "./components/LiveSession";
import { SessionPermissionGate } from "./components/SessionPermissionGate";
import { SessionReview } from "./components/SessionReview";
import { TitleBar } from "./components/TitleBar";
import { useClickOutside } from "./hooks/useClickOutside";
import { useFloatDrag } from "./hooks/useFloatDrag";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_PRESET,
  DEFAULT_VISION_MODEL,
  PROVIDER_PRESETS,
  type AnswerProvider,
} from "./services/providers";
import {
  deleteSession,
  listSessions,
  loadAnswerHistory,
  loadTranscript,
  restartSessionRun,
  setActiveSessionId,
} from "./services/sessionStore";
import type { SessionRecord } from "./types/session";

type Settings = {
  apiKey: string;
  geminiApiKey: string;
  apiBaseUrl: string;
  model: string;
  geminiModel: string;
  whisperModel: string;
  visionModel: string;
  answerProvider: AnswerProvider;
  alwaysOnTop: boolean;
  overlayBrowserFullscreen: boolean;
  excludeFromShare: boolean;
  darkMode: boolean;
  uiOpacity: number;
};

type View = "home" | "create" | "ready" | "live" | "review" | "settings";

const defaultSettings: Settings = {
  apiKey: "",
  geminiApiKey: "",
  apiBaseUrl: DEFAULT_PRESET.apiBaseUrl,
  model: DEFAULT_PRESET.model,
  geminiModel: DEFAULT_GEMINI_MODEL,
  whisperModel: DEFAULT_PRESET.whisperModel,
  visionModel: DEFAULT_VISION_MODEL,
  answerProvider: "gemini",
  alwaysOnTop: true,
  overlayBrowserFullscreen: false,
  excludeFromShare: true,
  darkMode: true,
  uiOpacity: 0.7,
};

const RETIRED_CHAT_MODELS = [
  "gpt-4o-mini",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
];

function normalizeSettings(loaded: Partial<Settings>): Settings {
  const next = { ...defaultSettings, ...loaded };
  if (!next.model || RETIRED_CHAT_MODELS.includes(next.model)) {
    next.model = DEFAULT_PRESET.model;
    next.apiBaseUrl = DEFAULT_PRESET.apiBaseUrl;
  }
  if (!next.whisperModel || next.whisperModel.includes("distil-whisper")) {
    next.whisperModel = DEFAULT_PRESET.whisperModel;
  }
  if (!next.visionModel) next.visionModel = DEFAULT_VISION_MODEL;
  if (!next.geminiModel) next.geminiModel = DEFAULT_GEMINI_MODEL;
  if (!next.geminiApiKey) next.geminiApiKey = "";
  if (next.answerProvider !== "groq" && next.answerProvider !== "gemini") {
    next.answerProvider = "gemini";
  }
  if (typeof next.darkMode !== "boolean") next.darkMode = true;
  if (typeof next.alwaysOnTop !== "boolean") next.alwaysOnTop = true;
  if (typeof next.overlayBrowserFullscreen !== "boolean") {
    next.overlayBrowserFullscreen = false;
  }
  if (typeof next.uiOpacity !== "number") next.uiOpacity = 0.7;
  next.uiOpacity = Math.min(1, Math.max(0.35, next.uiOpacity));
  return next;
}

function applyTheme(darkMode: boolean, opacity: number) {
  const o = Math.min(1, Math.max(0.25, opacity));
  document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  document.documentElement.style.setProperty("--glass-opacity", String(o));
  // Overlay pills must follow opacity too (they used fixed alpha before).
  document.documentElement.style.setProperty(
    "--cue-glass",
    darkMode
      ? `rgba(12, 16, 22, ${0.28 + o * 0.55})`
      : `rgba(18, 24, 32, ${0.22 + o * 0.5})`
  );
  document.documentElement.style.setProperty(
    "--cue-glass-strong",
    darkMode
      ? `rgba(12, 16, 22, ${0.38 + o * 0.55})`
      : `rgba(18, 24, 32, ${0.32 + o * 0.52})`
  );
  document.documentElement.style.setProperty(
    "--app-surface-alpha",
    String(0.35 + o * 0.55)
  );
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [active, setActive] = useState<SessionRecord | null>(null);
  const [search, setSearch] = useState("");
  const [floated, setFloated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openCardMenu, setOpenCardMenu] = useState<string | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const railMenuRef = useRef<HTMLDivElement | null>(null);

  const closeRailMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(railMenuRef, menuOpen, closeRailMenu);

  useEffect(() => {
    if (!openCardMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setOpenCardMenu(null);
        return;
      }
      if (target.closest(`[data-card-menu="${openCardMenu}"]`)) return;
      setOpenCardMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCardMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openCardMenu]);

  const refreshSessions = useCallback(() => {
    setSessions(listSessions());
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (window.meetingCue) {
          const loaded = await window.meetingCue.getSettings();
          if (!mounted) return;
          const normalized = normalizeSettings(loaded);
          setSettings(normalized);
          applyTheme(normalized.darkMode, normalized.uiOpacity);
          if (
            normalized.apiBaseUrl !== loaded.apiBaseUrl ||
            normalized.model !== loaded.model ||
            normalized.whisperModel !== loaded.whisperModel ||
            normalized.geminiModel !== loaded.geminiModel ||
            normalized.answerProvider !== loaded.answerProvider ||
            typeof loaded.darkMode !== "boolean" ||
            typeof loaded.uiOpacity !== "number"
          ) {
            await window.meetingCue.setSettings({
              apiBaseUrl: normalized.apiBaseUrl,
              model: normalized.model,
              whisperModel: normalized.whisperModel,
              geminiModel: normalized.geminiModel,
              answerProvider: normalized.answerProvider,
              darkMode: normalized.darkMode,
              uiOpacity: normalized.uiOpacity,
            });
          }
        }
      } catch {
        // browser preview
      }
      if (!mounted) return;
      refreshSessions();
      // Don't auto-enter a live call; clear any leftover active id.
      setActiveSessionId(null);
    })();
    return () => {
      mounted = false;
    };
  }, [refreshSessions]);

  const saveSettings = useCallback(async (partial: Partial<Settings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...partial };
      applyTheme(merged.darkMode, merged.uiOpacity);
      return merged;
    });
    if (window.meetingCue) {
      const next = await window.meetingCue.setSettings(partial);
      const normalized = normalizeSettings(next);
      applyTheme(normalized.darkMode, normalized.uiOpacity);
      setSettings(normalized);
    }
  }, []);

  useEffect(() => {
    applyTheme(settings.darkMode, settings.uiOpacity);
    // Home/settings: keep window fully visible; live overlay uses slider more strongly.
    if (view !== "live") {
      void window.meetingCue?.setWindowOpacity?.(Math.max(0.88, settings.uiOpacity));
    } else {
      void window.meetingCue?.setWindowOpacity?.(settings.uiOpacity);
    }
  }, [settings.darkMode, settings.uiOpacity, view]);

  useEffect(() => {
    if (view !== "live" && !floated) {
      void window.meetingCue?.setWindowMode?.("home");
    }
  }, [view, floated]);

  // After Electron/main reloads, never stay stuck on the float chip.
  useEffect(() => {
    setFloated(false);
    void window.meetingCue?.restoreFromFloat?.().catch(() => {
      void window.meetingCue?.setWindowMode?.("home");
    });
  }, []);

  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const offEnter = window.meetingCue?.onEnterFloat?.(() => {
      // Live session already has its own floating bubble UI.
      if (viewRef.current === "live") return;
      setFloated(true);
      setMenuOpen(false);
      setOpenCardMenu(null);
    });
    const offExit = window.meetingCue?.onExitFloat?.(() => {
      setFloated(false);
    });
    return () => {
      offEnter?.();
      offExit?.();
    };
  }, []);

  const overlayLive = view === "live";
  const showChrome = !overlayLive && !floated;

  const filteredSessions = sessions.filter((session) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const hay = `${session.details.companyName} ${session.details.description}`.toLowerCase();
    return hay.includes(q);
  });

  const formatSessionDate = (ts: number) =>
    new Date(ts)
      .toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .toUpperCase();

  const companyInitial = (name: string) =>
    (name.trim().charAt(0) || "M").toUpperCase();

  const sessionHasHistory = (session: SessionRecord) =>
    loadTranscript(session.id).length > 0 ||
    loadAnswerHistory(session.id).length > 0;

  const openReview = (session: SessionRecord) => {
    setActive(session);
    setOpenCardMenu(null);
    setView("review");
  };

  const startSession = (session: SessionRecord) => {
    if (!mediaReady) return;
    setActive(session);
    setActiveSessionId(session.id);
    setOpenCardMenu(null);
    setView("live");
  };

  const goReady = (session: SessionRecord) => {
    setActive(session);
    setOpenCardMenu(null);
    setMediaReady(false);
    setView("ready");
  };

  const restartSession = (session: SessionRecord) => {
    const next = restartSessionRun(session);
    refreshSessions();
    goReady(next);
  };

  const enterFloat = () => {
    setFloated(true);
    void window.meetingCue?.windowMinimize?.();
  };

  const restoreFloat = useCallback(async () => {
    setFloated(false);
    const mode = await window.meetingCue?.restoreFromFloat?.();
    if (!mode || mode === "home" || mode === "bubble") {
      void window.meetingCue?.setWindowMode?.("home");
    }
  }, []);

  const floatDrag = useFloatDrag(() => {
    void restoreFloat();
  });

  if (floated && !overlayLive) {
    return (
      <div className="float-root">
        <button
          type="button"
          className="float-circle"
          title="Drag to move · click to restore"
          {...floatDrag}
        >
          MC
        </button>
      </div>
    );
  }

  return (
    <div className={`app-frame ${overlayLive ? "overlay-mode" : "compact-app"}`}>
      {showChrome ? (
        <TitleBar
          title={view === "settings" ? "Settings" : "Meeting Cue"}
          compact
          onFloat={() => setFloated(true)}
        />
      ) : null}
      <div
        className={`shell ${view === "home" && showChrome ? "shell-compact" : ""}`}
      >
      {view === "home" ? (
        <div className="home-layout">
          <aside className="home-rail">
            <div className="rail-brand" title="Meeting Cue">
              MC
            </div>
            <div className="rail-group">
              <button
                type="button"
                className="rail-btn accent"
                title="Create session"
                onClick={() => setView("create")}
              >
                +
              </button>
              <button
                type="button"
                className="rail-btn active"
                title="Sessions"
              >
                ▤
              </button>
              <button
                type="button"
                className="rail-btn"
                title="API settings"
                onClick={() => setView("settings")}
              >
                ⚙
              </button>
            </div>
            <div className="rail-group bottom">
              <button
                type="button"
                className="rail-btn"
                title="Float on screen"
                onClick={enterFloat}
              >
                ⧉
              </button>
              <div className="rail-menu-wrap" ref={railMenuRef}>
                <button
                  type="button"
                  className="rail-avatar"
                  title="Profile"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  MC
                </button>
                {menuOpen ? (
                  <div className="rail-popover">
                    <p className="rail-email">Meeting Cue · local</p>
                    <div className="rail-zoom">
                      <span>Opacity</span>
                      <div className="rail-zoom-controls">
                        <button
                          type="button"
                          onClick={() =>
                            void saveSettings({
                              uiOpacity: Math.max(
                                0.35,
                                settings.uiOpacity - 0.05
                              ),
                            })
                          }
                        >
                          −
                        </button>
                        <em>{Math.round(settings.uiOpacity * 100)}%</em>
                        <button
                          type="button"
                          onClick={() =>
                            void saveSettings({
                              uiOpacity: Math.min(
                                1,
                                settings.uiOpacity + 0.05
                              ),
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="rail-theme">
                      <button
                        type="button"
                        className={!settings.darkMode ? "active" : ""}
                        onClick={() => void saveSettings({ darkMode: false })}
                      >
                        Light
                      </button>
                      <button
                        type="button"
                        className={settings.darkMode ? "active" : ""}
                        onClick={() => void saveSettings({ darkMode: true })}
                      >
                        Dark
                      </button>
                    </div>
                    <button
                      type="button"
                      className="rail-popover-link"
                      onClick={() => {
                        setMenuOpen(false);
                        setView("settings");
                      }}
                    >
                      API settings
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>

          <div className="home-main">
            <header className="home-top">
              <h1>Sessions</h1>
              <div className="home-top-actions">
                <div className="home-credit-pill">
                  <span>
                    {settings.answerProvider === "gemini" ? "Gemini" : "Groq"} ·
                    local
                  </span>
                </div>
                <button
                  type="button"
                  className="btn dark small"
                  onClick={() => setView("create")}
                >
                  + Create
                </button>
              </div>
            </header>

            <div className="home-search-row">
              <label className="home-search">
                <span>⌕</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by role or company"
                />
              </label>
              <span className="home-count">
                {filteredSessions.length} Sessions
              </span>
            </div>

            <div className="interview-list">
              {filteredSessions.length === 0 ? (
                <p className="empty home-empty">
                  No sessions yet. Create one to store company context and answer
                  preferences.
                </p>
              ) : (
                filteredSessions.map((session) => (
                  <article key={session.id} className="interview-card">
                    <div className="interview-card-top">
                      <div className="interview-meta">
                        <span className="interview-date">
                          {formatSessionDate(session.updatedAt)}
                        </span>
                        <div className="interview-company">
                          <span className="interview-logo">
                            {companyInitial(session.details.companyName)}
                          </span>
                          <div>
                            <strong>
                              {session.details.companyName ||
                                "Untitled session"}
                            </strong>
                            <p>
                              {session.details.description?.trim() ||
                                (session.preferences.autoAnswer
                                  ? "Auto Answer ready"
                                  : "Manual cues")}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div
                        className="interview-menu-wrap"
                        data-card-menu={session.id}
                      >
                        <button
                          type="button"
                          className="interview-kebab"
                          onClick={() =>
                            setOpenCardMenu((id) =>
                              id === session.id ? null : session.id
                            )
                          }
                        >
                          ⋮
                        </button>
                        {openCardMenu === session.id ? (
                          <div className="interview-menu">
                            <button
                              type="button"
                              onClick={() => goReady(session)}
                            >
                              Details
                            </button>
                            {sessionHasHistory(session) ? (
                              <button
                                type="button"
                                onClick={() => openReview(session)}
                              >
                                View transcript
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => restartSession(session)}
                            >
                              Restart session
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => {
                                deleteSession(session.id);
                                refreshSessions();
                                setOpenCardMenu(null);
                                if (active?.id === session.id) {
                                  setActive(null);
                                  setView("home");
                                }
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="interview-tags">
                      <span>Cue</span>
                      <span>
                        {session.preferences.answerPreferences.format}
                      </span>
                      {session.status === "ended" ? (
                        <span className="tag-ended">Ended</span>
                      ) : null}
                    </div>

                    <div className="interview-card-bottom">
                      <div className="interview-status">
                        <span
                          className={`status-pip ${
                            session.status === "ended" ? "is-ended" : "is-ready"
                          }`}
                          aria-hidden
                        />
                        {session.status === "ended"
                          ? "Done"
                          : "Ready"}{" "}
                        · {session.preferences.answerPreferences.length}
                      </div>
                      <div className="interview-card-actions">
                        {session.status === "ended" ||
                        sessionHasHistory(session) ? (
                          <button
                            type="button"
                            className="btn light small"
                            onClick={() => openReview(session)}
                          >
                            Transcript
                          </button>
                        ) : null}
                        {session.status === "ended" ? (
                          <button
                            type="button"
                            className="btn dark small"
                            onClick={() => restartSession(session)}
                          >
                            Restart
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn light small"
                            onClick={() => goReady(session)}
                          >
                            Start session
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {view === "create" ? (
        <CreateSession
          onCancel={() => setView("home")}
          onCreated={(session) => {
            refreshSessions();
            goReady(session);
          }}
        />
      ) : null}

      {view === "ready" && active ? (
        <div className="ready">
          <section className="panel light ready-card">
            <p className="eyebrow">Session ready</p>
            <h1>{active.details.companyName || "Untitled session"}</h1>
            <p>
              {active.preferences.autoAnswer
                ? "Auto Answer is on — mic and system audio will listen when you start."
                : "Confirm permissions below, then start when mic and system audio are ready."}
            </p>
            <div className="pref-chips">
              <span>{active.preferences.model}</span>
              <span>{active.preferences.answerPreferences.format}</span>
              <span>{active.preferences.answerPreferences.length}</span>
              <span>{active.preferences.answerPreferences.tone}</span>
              {active.preferences.answerPreferences.starMethod ? (
                <span>STAR</span>
              ) : null}
            </div>
            <SessionPermissionGate
              key={active.id}
              onReadyChange={setMediaReady}
            />
            <div className="home-actions" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn dark"
                disabled={!mediaReady}
                onClick={() => startSession(active)}
                title={
                  mediaReady
                    ? "Start live session"
                    : "Fix permissions above before starting"
                }
              >
                {mediaReady ? "Start session" : "Waiting for permissions…"}
              </button>
              {sessionHasHistory(active) ? (
                <button
                  type="button"
                  className="btn light"
                  onClick={() => openReview(active)}
                >
                  View transcript
                </button>
              ) : null}
              <button
                type="button"
                className="btn light"
                onClick={() => {
                  setActive(null);
                  setMediaReady(false);
                  setView("home");
                }}
              >
                Back to sessions
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {view === "review" && active ? (
        <SessionReview
          session={active}
          onBack={() => {
            setActive(null);
            setView("home");
          }}
          onRestart={() => restartSession(active)}
          onCreateNew={() => {
            setActive(null);
            setView("create");
          }}
        />
      ) : null}

      {view === "live" && active ? (
        <LiveSession
          session={active}
          settings={settings}
          onUpdateSession={(session) => {
            setActive(session);
            refreshSessions();
          }}
          onExit={() => {
            void window.meetingCue?.setWindowMode?.("home");
            setActiveSessionId(null);
            refreshSessions();
            setView("review");
          }}
          onOpenSettings={() => {
            void window.meetingCue?.setWindowMode?.("home");
            setView("settings");
          }}
        />
      ) : null}

      {view === "settings" ? (
        <div className="settings-page">
          <header className="row-between">
            <div>
              <h1>API settings</h1>
              <p className="sub">Stored on this device via the desktop app.</p>
            </div>
            <button
              type="button"
              className="btn light"
              onClick={() => setView(active ? "live" : "home")}
            >
              Back
            </button>
          </header>

          <section className="panel light settings-box">
            <p className="sub">
              Recommended: Gemini for Answer + Screenshot, Groq Whisper for live
              speech.
            </p>

            <label className="field">
              <span>Answer / Screenshot provider</span>
              <select
                className="select-like"
                value={settings.answerProvider}
                onChange={(e) =>
                  void saveSettings({
                    answerProvider: e.target.value as AnswerProvider,
                  })
                }
              >
                <option value="gemini">Gemini (answers + screenshots)</option>
                <option value="groq">Groq (answers + screenshots)</option>
              </select>
            </label>

            <label className="field">
              <span>Gemini API key (AI Studio)</span>
              <input
                type="password"
                value={settings.geminiApiKey}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, geminiApiKey: e.target.value }))
                }
                onBlur={() =>
                  saveSettings({ geminiApiKey: settings.geminiApiKey })
                }
                placeholder="AIza..."
              />
            </label>
            <label className="field">
              <span>Gemini model</span>
              <input
                value={settings.geminiModel}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, geminiModel: e.target.value }))
                }
                onBlur={() =>
                  saveSettings({ geminiModel: settings.geminiModel })
                }
                placeholder={DEFAULT_GEMINI_MODEL}
              />
            </label>

            <div className="preset-list">
              {PROVIDER_PRESETS.map((preset) => {
                const selected =
                  settings.model === preset.model &&
                  settings.whisperModel === preset.whisperModel;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preset-card ${selected ? "active" : ""}`}
                    onClick={() =>
                      void saveSettings({
                        apiBaseUrl: preset.apiBaseUrl,
                        model: preset.model,
                        whisperModel: preset.whisperModel,
                        visionModel: preset.visionModel,
                      })
                    }
                  >
                    <strong>{preset.label}</strong>
                    <span>{preset.blurb}</span>
                  </button>
                );
              })}
            </div>

            <label className="field">
              <span>Groq API key (speech)</span>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, apiKey: e.target.value }))
                }
                onBlur={() => saveSettings({ apiKey: settings.apiKey })}
                placeholder="gsk_..."
              />
            </label>
            <label className="field">
              <span>Groq API base URL</span>
              <input
                value={settings.apiBaseUrl}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, apiBaseUrl: e.target.value }))
                }
                onBlur={() =>
                  saveSettings({ apiBaseUrl: settings.apiBaseUrl })
                }
              />
            </label>
            <label className="field">
              <span>Groq chat model (fallback)</span>
              <input
                value={settings.model}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, model: e.target.value }))
                }
                onBlur={() => saveSettings({ model: settings.model })}
              />
            </label>
            <label className="field">
              <span>Speech model (Groq Whisper)</span>
              <input
                value={settings.whisperModel}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, whisperModel: e.target.value }))
                }
                onBlur={() =>
                  saveSettings({ whisperModel: settings.whisperModel })
                }
              />
            </label>
            <label className="field">
              <span>Groq vision model (if provider = Groq)</span>
              <input
                value={settings.visionModel}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, visionModel: e.target.value }))
                }
                onBlur={() =>
                  saveSettings({ visionModel: settings.visionModel })
                }
                placeholder="qwen/qwen3.8-27b"
              />
            </label>

            <div className="toggle-row">
              <span>Exclude window from screen share</span>
              <input
                type="checkbox"
                checked={settings.excludeFromShare}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setSettings((s) => ({ ...s, excludeFromShare: enabled }));
                  if (window.meetingCue) {
                    await window.meetingCue.setExcludeFromShare(enabled);
                  }
                }}
              />
            </div>
            <div className="toggle-row">
              <span>Always on top</span>
              <input
                type="checkbox"
                checked={settings.alwaysOnTop}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setSettings((s) => ({
                    ...s,
                    alwaysOnTop: enabled,
                    ...(enabled
                      ? {}
                      : { overlayBrowserFullscreen: false }),
                  }));
                  if (window.meetingCue) {
                    await window.meetingCue.setAlwaysOnTop(enabled);
                    if (!enabled) {
                      await window.meetingCue.setOverlayBrowserFullscreen(false);
                    }
                  }
                }}
              />
            </div>
            <div className="toggle-row">
              <span>Stay above browser fullscreen</span>
              <input
                type="checkbox"
                checked={
                  settings.alwaysOnTop && settings.overlayBrowserFullscreen
                }
                disabled={!settings.alwaysOnTop}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setSettings((s) => ({
                    ...s,
                    overlayBrowserFullscreen: enabled,
                  }));
                  if (window.meetingCue) {
                    await window.meetingCue.setOverlayBrowserFullscreen(enabled);
                  }
                }}
              />
            </div>
            <p className="sub" style={{ marginTop: -4, marginBottom: 10 }}>
              Always on top keeps the cue above normal and maximized windows.
              Stay above browser fullscreen recreates the window as a macOS
              panel (required for Chrome / site fullscreen). Toggle it off→on
              after updates so panel mode applies. Authorized practice only —
              leave it off for proctored sessions. The Dock may hide while this
              is on; it returns when you turn it off.
            </p>
            <div className="toggle-row">
              <span>Dark mode</span>
              <input
                type="checkbox"
                checked={settings.darkMode}
                onChange={(e) =>
                  void saveSettings({ darkMode: e.target.checked })
                }
              />
            </div>
            <label className="field">
              <span>Glass opacity (background only — text stays solid)</span>
              <input
                type="range"
                min={35}
                max={100}
                value={Math.round(settings.uiOpacity * 100)}
                onChange={(e) => {
                  const uiOpacity = Number(e.target.value) / 100;
                  setSettings((s) => ({ ...s, uiOpacity }));
                  applyTheme(settings.darkMode, uiOpacity);
                }}
                onMouseUp={() =>
                  void saveSettings({ uiOpacity: settings.uiOpacity })
                }
                onTouchEnd={() =>
                  void saveSettings({ uiOpacity: settings.uiOpacity })
                }
              />
            </label>
          </section>
        </div>
      ) : null}
      </div>
    </div>
  );
}

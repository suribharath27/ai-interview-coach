import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  shell,
  session,
  systemPreferences,
  desktopCapturer,
  screen,
  Notification,
  type NativeImage,
} from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Store from "electron-store";

type AppSettings = {
  apiKey: string;
  geminiApiKey: string;
  apiBaseUrl: string;
  model: string;
  geminiModel: string;
  whisperModel: string;
  visionModel: string;
  answerProvider: "gemini" | "groq";
  alwaysOnTop: boolean;
  /**
   * When true (and alwaysOnTop is on), raise window level so the assistant can
   * remain visible over browser full-screen in authorized practice sessions.
   * Default false — does not punch through exclusive / proctored Spaces.
   */
  overlayBrowserFullscreen: boolean;
  excludeFromShare: boolean;
  companyContext: string;
  darkMode: boolean;
  uiOpacity: number;
  /** Last known non-bubble window bounds (persisted across restarts). */
  windowBounds?: { x: number; y: number; width: number; height: number } | null;
};

type WindowMode = "home" | "overlay" | "answer" | "bubble";

type WindowLifecycleEvent =
  | "enter-full-screen"
  | "leave-full-screen"
  | "enter-html-full-screen"
  | "leave-html-full-screen"
  | "focus"
  | "blur"
  | "show"
  | "hide"
  | "closed"
  | "external-fullscreen-unavailable"
  | "restored-after-external-fullscreen";

type AlwaysOnTopLevel =
  | "normal"
  | "floating"
  | "torn-off-menu"
  | "modal-panel"
  | "main-menu"
  | "status"
  | "pop-up-menu"
  | "screen-saver";

type WindowSnapshot = {
  id: number | null;
  mode: WindowMode;
  bounds: Electron.Rectangle | null;
  isVisible: boolean;
  isFocused: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  isFullScreen: boolean;
  isAlwaysOnTop: boolean;
  alwaysOnTopSetting: boolean;
  overlayBrowserFullscreen: boolean;
  alwaysOnTopLevel: AlwaysOnTopLevel | "off";
  visibleOnAllWorkspaces: boolean;
  visibleOnFullScreen: boolean;
  externalFullscreenUnavailable: boolean;
  platform: NodeJS.Platform;
  macPanelWindow: boolean;
};

const store = new Store<AppSettings>({
  defaults: {
    apiKey: "",
    geminiApiKey: "",
    apiBaseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    geminiModel: "gemini-3.5-flash-lite",
    whisperModel: "whisper-large-v3-turbo",
    visionModel: "qwen/qwen3.8-27b",
    answerProvider: "gemini",
    alwaysOnTop: true,
    overlayBrowserFullscreen: false,
    excludeFromShare: true,
    companyContext: "",
    darkMode: true,
    uiOpacity: 0.7,
    windowBounds: null,
  },
});

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;
let currentWindowMode: WindowMode = "home";
let modeBeforeFloat: WindowMode = "home";
/** Where the full window was before floating — used so restore feels anchored. */
let boundsBeforeFloat: { x: number; y: number; width: number; height: number } | null =
  null;
/** Set after a long app-resign; cleared when we become active again. */
let externalFullscreenUnavailable = false;
let blurStartedAt: number | null = null;
let persistBoundsTimer: ReturnType<typeof setTimeout> | null = null;
/** Avoid spamming restore tips when alt-tabbing. */
let fullscreenTipShownThisSession = false;
/** OS notification for exclusive fullscreen — once per session. */
let fullscreenUnavailableNotified = false;
let resignUnavailableTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * macOS: visibleOnFullScreen only works after the process has been transformed
 * to UIElementApplication (via dock hide or Electron's transform). Once done,
 * later re-asserts can skip the transform to avoid dock flicker.
 */
let macFullscreenOverlayReady = false;
const BLUR_UNAVAILABLE_MS = 2500;

/** 20mm × 20mm float chip in CSS/Electron DIPs (96 CSS px per inch). */
function bubbleSizePx(): number {
  return Math.max(56, Math.round((20 / 25.4) * 96));
}

const WINDOW_MODES: Record<
  WindowMode,
  { width: number; height: number; resizable: boolean }
> = {
  home: { width: 860, height: 620, resizable: true },
  overlay: { width: 760, height: 200, resizable: false },
  answer: { width: 720, height: 460, resizable: false },
  bubble: { width: bubbleSizePx(), height: bubbleSizePx(), resizable: false },
};

function clampToWorkArea(
  x: number,
  y: number,
  width: number,
  height: number,
  work: Electron.Rectangle
) {
  const w = Math.max(80, Math.min(width, work.width - 16));
  const h = Math.max(80, Math.min(height, work.height - 16));
  return {
    x: Math.min(Math.max(work.x + 8, Math.round(x)), work.x + work.width - w - 8),
    y: Math.min(Math.max(work.y + 8, Math.round(y)), work.y + work.height - h - 8),
    width: w,
    height: h,
  };
}

function isValidBounds(
  bounds: unknown
): bounds is { x: number; y: number; width: number; height: number } {
  if (!bounds || typeof bounds !== "object") return false;
  const b = bounds as Record<string, unknown>;
  return (
    typeof b.x === "number" &&
    typeof b.y === "number" &&
    typeof b.width === "number" &&
    typeof b.height === "number" &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height) &&
    b.width >= 80 &&
    b.height >= 80 &&
    b.width < 10000 &&
    b.height < 10000
  );
}

function safeSend(channel: string, payload: unknown) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  } catch (err) {
    console.warn("[window] safeSend failed", channel, err);
  }
}

function applyWindowMode(mode: WindowMode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!WINDOW_MODES[mode]) return;

  try {
    const leavingBubble = currentWindowMode === "bubble" && mode !== "bubble";
    const enteringBubble = mode === "bubble" && currentWindowMode !== "bubble";

    if (enteringBubble) {
      boundsBeforeFloat = mainWindow.getBounds();
      modeBeforeFloat =
        currentWindowMode === "bubble" ? "home" : currentWindowMode;
    } else if (mode !== "bubble") {
      modeBeforeFloat = mode;
    }
    currentWindowMode = mode;

    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const work = display.workArea;

    if (mainWindow.isMinimized()) mainWindow.restore();

    // Refresh bubble size in case display metrics differ.
    if (mode === "bubble") {
      const side = bubbleSizePx();
      WINDOW_MODES.bubble.width = side;
      WINDOW_MODES.bubble.height = side;
    }

    const size = WINDOW_MODES[mode];
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);

    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(
      mode === "bubble" ? size.width : mode === "home" ? 720 : 300,
      mode === "bubble"
        ? size.height
        : mode === "overlay"
          ? 110
          : mode === "home"
            ? 520
            : 180
    );

    let x: number;
    let y: number;
    if (mode === "bubble") {
      const origin = boundsBeforeFloat || bounds;
      x = Math.round(origin.x + (origin.width - size.width) / 2);
      y = Math.round(origin.y + (origin.height - size.height) / 2);
    } else if (leavingBubble && boundsBeforeFloat) {
      x = Math.round(bounds.x + (bounds.width - size.width) / 2);
      y = Math.round(bounds.y + (bounds.height - size.height) / 2);
    } else if (mode === "home") {
      // Prefer last known home position over forcing center every time.
      const saved = store.get("windowBounds");
      const anchor = isValidBounds(saved)
        ? saved
        : boundsBeforeFloat || bounds;
      x = anchor.x;
      y = anchor.y;
    } else {
      x = Math.round(bounds.x + (bounds.width - size.width) / 2);
      y = bounds.y;
    }

    const clamped = clampToWorkArea(x, y, size.width, size.height, work);
    mainWindow.setBounds(clamped, false);
    mainWindow.setResizable(size.resizable);
    mainWindow.setHasShadow(mode !== "bubble");
    // Home uses native window rounding; overlay pills own their CSS radius so
    // the top corners don't double-round against BrowserWindow.roundedCorners.
    try {
      if (process.platform === "darwin") {
        mainWindow.setRoundedCorners(mode === "home");
      }
    } catch (err) {
      console.warn("[window] setRoundedCorners failed", err);
    }
    // Respect user preference — never force always-on-top here.
    applyAlwaysOnTop(mainWindow);
    if (mode === "bubble") mainWindow.setSkipTaskbar(true);
    else mainWindow.setSkipTaskbar(false);
    schedulePersistBounds();
  } catch (err) {
    console.error("[window] applyWindowMode failed", mode, err);
  }
}

function floatWindow() {
  if (!mainWindow) return false;
  if (currentWindowMode !== "bubble") modeBeforeFloat = currentWindowMode;
  applyWindowMode("bubble");
  mainWindow.webContents.send("window:enter-float", {
    previousMode: modeBeforeFloat,
  });
  return true;
}

function resolveAlwaysOnTopLevel(enabled: boolean): AlwaysOnTopLevel | "off" {
  if (!enabled) return "off";
  // Authorized practice: high level so browser F11 / Fullscreen API can be layered under us.
  if (store.get("overlayBrowserFullscreen")) return "screen-saver";
  // Everyday desktop: stronger than "floating" so maximized browsers don't bury the cue.
  return "pop-up-menu";
}

function getWindowSnapshot(win: BrowserWindow | null = mainWindow): WindowSnapshot {
  const aot = store.get("alwaysOnTop");
  const overlayFs = Boolean(store.get("overlayBrowserFullscreen"));
  if (!win || win.isDestroyed()) {
    return {
      id: null,
      mode: currentWindowMode,
      bounds: null,
      isVisible: false,
      isFocused: false,
      isMinimized: false,
      isMaximized: false,
      isFullScreen: false,
      isAlwaysOnTop: false,
      alwaysOnTopSetting: aot,
      overlayBrowserFullscreen: overlayFs,
      alwaysOnTopLevel: resolveAlwaysOnTopLevel(aot),
      visibleOnAllWorkspaces: false,
      visibleOnFullScreen: false,
      externalFullscreenUnavailable,
      platform: process.platform,
      macPanelWindow: usingMacPanelWindow,
    };
  }
  return {
    id: win.id,
    mode: currentWindowMode,
    bounds: win.getBounds(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    isMinimized: win.isMinimized(),
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
    isAlwaysOnTop: win.isAlwaysOnTop(),
    alwaysOnTopSetting: aot,
    overlayBrowserFullscreen: overlayFs,
    alwaysOnTopLevel: resolveAlwaysOnTopLevel(aot),
    // Electron does not expose getters; mirror what we apply.
    visibleOnAllWorkspaces: aot,
    visibleOnFullScreen: aot && overlayFs,
    externalFullscreenUnavailable,
    platform: process.platform,
    macPanelWindow: usingMacPanelWindow,
  };
}

function logWindowEvent(
  event: WindowLifecycleEvent,
  win: BrowserWindow | null = mainWindow
) {
  try {
    const snapshot = getWindowSnapshot(win);
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      windowId: snapshot.id,
      ...snapshot,
    };
    console.log("[window-lifecycle]", JSON.stringify(payload));
    safeSend("window:lifecycle", payload);
  } catch (err) {
    console.warn("[window-lifecycle] log failed", event, err);
  }
}

/**
 * Platform-aware always-on-top.
 *
 * Default (overlayBrowserFullscreen=false):
 *   - Level "pop-up-menu" so the cue stays above ordinary / maximized windows.
 *   - macOS: visibleOnFullScreen=false — never force above exclusive Spaces.
 *
 * Opt-in (overlayBrowserFullscreen=true, authorized practice only):
 *   - macOS requires UIElementApplication for visibleOnFullScreen. That means
 *     either allowing Electron's process-type transform, or briefly hiding the
 *     Dock around setVisibleOnAllWorkspaces. skipTransformProcessType:true alone
 *     silently prevents overlaying Chrome F11 / site Fullscreen Spaces.
 *   - Level "screen-saver" + relativeLevel 1.
 *   Do not use in proctored sessions.
 */
function applyAlwaysOnTop(
  win: BrowserWindow,
  enabled = store.get("alwaysOnTop")
) {
  if (win.isDestroyed()) return;
  const on = Boolean(enabled);
  const overlayFs = on && Boolean(store.get("overlayBrowserFullscreen"));
  const level = resolveAlwaysOnTopLevel(on);

  if (process.platform === "darwin") {
    applyAlwaysOnTopDarwin(win, on, overlayFs, level);
    return;
  }

  // Windows / Linux
  try {
    if (!on || level === "off") {
      win.setAlwaysOnTop(false);
    } else {
      // relativeLevel helps above maximized / borderless fullscreen browsers.
      win.setAlwaysOnTop(true, level, 1);
    }
  } catch (err) {
    console.warn("[window] setAlwaysOnTop failed", err);
    try {
      if (on) win.setAlwaysOnTop(true, "screen-saver");
      else win.setAlwaysOnTop(false);
    } catch (fallbackErr) {
      console.warn("[window] setAlwaysOnTop fallback failed", fallbackErr);
    }
  }

  try {
    win.setVisibleOnAllWorkspaces(on);
  } catch (err) {
    console.warn("[window] setVisibleOnAllWorkspaces failed", err);
  }
}

function applyAlwaysOnTopDarwin(
  win: BrowserWindow,
  on: boolean,
  overlayFs: boolean,
  level: AlwaysOnTopLevel | "off"
) {
  if (win.isDestroyed()) return;

  // Leaving overlay mode — drop FullScreenAuxiliary behavior.
  if (!overlayFs) {
    macFullscreenOverlayReady = false;
  }

  try {
    win.setFullScreenable(false);
  } catch {
    /* ignore */
  }

  if (overlayFs) {
    // Panel + UIElementApplication + screen-saver level.
    // Keep Dock hidden for the whole overlay session (do not show it here).
    const needsProcessTransform = !macFullscreenOverlayReady;
    try {
      if (app.dock) app.dock.hide();

      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: !needsProcessTransform,
      });

      if (level !== "off") {
        win.setAlwaysOnTop(true, "screen-saver", 1);
      }

      macFullscreenOverlayReady = true;
    } catch (err) {
      console.warn("[window] mac overlay fullscreen apply failed", err);
      try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.setAlwaysOnTop(true, "screen-saver", 1);
        macFullscreenOverlayReady = true;
      } catch (fallbackErr) {
        console.warn("[window] mac overlay fullscreen fallback failed", fallbackErr);
      }
    }

    try {
      if (!win.isDestroyed() && win.isVisible()) {
        win.showInactive();
        win.moveTop();
      }
    } catch {
      /* ignore */
    }
    return;
  }

  // Leaving overlay — restore Dock.
  if (app.dock) {
    try {
      app.dock.show();
    } catch {
      /* ignore */
    }
  }

  // Normal always-on-top (no exclusive fullscreen overlay).
  try {
    if (!on || level === "off") {
      win.setAlwaysOnTop(false);
    } else {
      win.setAlwaysOnTop(true, level);
    }
  } catch (err) {
    console.warn("[window] setAlwaysOnTop failed", err);
    try {
      if (on) win.setAlwaysOnTop(true, "floating");
      else win.setAlwaysOnTop(false);
    } catch (fallbackErr) {
      console.warn("[window] setAlwaysOnTop fallback failed", fallbackErr);
    }
  }

  try {
    win.setVisibleOnAllWorkspaces(on, {
      visibleOnFullScreen: false,
      skipTransformProcessType: true,
    });
  } catch (err) {
    try {
      win.setVisibleOnAllWorkspaces(on);
    } catch (fallbackErr) {
      console.warn("[window] setVisibleOnAllWorkspaces failed", fallbackErr || err);
    }
  }
}

function notifyFullscreenUnavailable() {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: "Meeting Cue unavailable",
      body: store.get("overlayBrowserFullscreen")
        ? "Another app may have exclusive full-screen control. Exit full screen (Esc / F11), or keep Stay above browser fullscreen enabled for authorized practice."
        : "Another app took exclusive full-screen (browser F11 / site Fullscreen). Exit full screen to use Meeting Cue, or enable Stay above browser fullscreen for authorized practice only.",
      silent: true,
    });
    n.show();
  } catch (err) {
    console.warn("[window] fullscreen notification failed", err);
  }
}

function applyWindowPrivacy(win: BrowserWindow) {
  applyAlwaysOnTop(win);
  try {
    win.setContentProtection(store.get("excludeFromShare"));
  } catch (err) {
    console.warn("[window] setContentProtection failed", err);
  }
}

function schedulePersistBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (currentWindowMode === "bubble") return;
  if (persistBoundsTimer) clearTimeout(persistBoundsTimer);
  persistBoundsTimer = setTimeout(() => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (currentWindowMode === "bubble") return;
      const bounds = mainWindow.getBounds();
      if (!isValidBounds(bounds)) return;
      store.set("windowBounds", bounds);
      boundsBeforeFloat = bounds;
    } catch (err) {
      console.warn("[window] persist bounds failed", err);
    }
  }, 400);
}

function restorePersistedBounds(win: BrowserWindow) {
  try {
    const saved = store.get("windowBounds");
    if (!isValidBounds(saved)) return;
    const displays = screen.getAllDisplays();
    if (!displays.length) return;
    const display = screen.getDisplayMatching(saved);
    const work = display?.workArea ?? displays[0]!.workArea;
    const clamped = clampToWorkArea(
      saved.x,
      saved.y,
      saved.width,
      saved.height,
      work
    );
    win.setBounds(clamped, false);
  } catch (err) {
    console.warn("[window] restorePersistedBounds failed", err);
  }
}

/**
 * Re-assert z-order only. Do NOT call setVisibleOnAllWorkspaces here —
 * that transforms the process / steals focus and caused a blur↔focus loop
 * that made the window appear to vanish.
 */
function reassertAlwaysOnTopLevel(win: BrowserWindow) {
  if (win.isDestroyed() || !store.get("alwaysOnTop")) return;
  const level = resolveAlwaysOnTopLevel(true);
  if (level === "off") return;
  try {
    win.setAlwaysOnTop(true, level);
  } catch (err) {
    console.warn("[window] reassertAlwaysOnTopLevel failed", err);
  }
}

/**
 * Lifecycle diagnostics for *this* BrowserWindow only.
 * Chrome/F11 fullscreen cannot be observed via Electron window events.
 */
function attachWindowLifecycle(win: BrowserWindow) {
  win.on("enter-full-screen", () => logWindowEvent("enter-full-screen", win));
  win.on("leave-full-screen", () => logWindowEvent("leave-full-screen", win));
  win.on("enter-html-full-screen", () =>
    logWindowEvent("enter-html-full-screen", win)
  );
  win.on("leave-html-full-screen", () =>
    logWindowEvent("leave-html-full-screen", win)
  );
  win.on("show", () => logWindowEvent("show", win));
  win.on("hide", () => logWindowEvent("hide", win));
  win.on("closed", () => logWindowEvent("closed", win));

  win.on("blur", () => {
    blurStartedAt = Date.now();
    if (!win.isDestroyed() && !win.isFullScreen()) {
      reassertAlwaysOnTopLevel(win);
    }
  });

  win.on("focus", () => {
    blurStartedAt = null;
  });

  win.on("moved", () => schedulePersistBounds());
  win.on("resized", () => schedulePersistBounds());
}

/**
 * App-level active/resign is the strongest cross-app signal without Accessibility.
 * Electron cannot observe Chrome F11 directly. When overlayBrowserFullscreen is off,
 * Meeting Cue is not shown on exclusive fullscreen Spaces; on return we re-assert
 * layering and tip the user. When the opt-in is on, we still tip if the OS denied
 * exclusive control (true proctoring / game exclusive fullscreen).
 */
function attachAppActivationHandlers() {
  app.on("did-resign-active", () => {
    blurStartedAt = Date.now();
    if (resignUnavailableTimer) clearTimeout(resignUnavailableTimer);
    // Debounce: quick alt-tabs should not look like exclusive fullscreen.
    resignUnavailableTimer = setTimeout(() => {
      resignUnavailableTimer = null;
      if (!blurStartedAt) return;
      if (currentWindowMode === "home") return;
      if (!externalFullscreenUnavailable) {
        externalFullscreenUnavailable = true;
        logWindowEvent("external-fullscreen-unavailable", mainWindow);
      }
      const overlayFs = Boolean(store.get("overlayBrowserFullscreen"));
      safeSend("window:availability", {
        available: false,
        reason: "external-fullscreen-unavailable",
        message: overlayFs
          ? "Focus left Meeting Cue. If the assistant disappears, the other app may have exclusive full-screen control — exit full screen (Esc / F11) to restore it."
          : "Meeting Cue cannot appear over exclusive browser / protected full-screen. Exit full screen (Esc / F11), or enable Stay above browser fullscreen for authorized practice.",
      });
      if (!overlayFs && !fullscreenUnavailableNotified) {
        fullscreenUnavailableNotified = true;
        notifyFullscreenUnavailable();
      }
    }, BLUR_UNAVAILABLE_MS);
  });

  app.on("did-become-active", () => {
    const awayMs = blurStartedAt ? Date.now() - blurStartedAt : 0;
    blurStartedAt = null;
    if (resignUnavailableTimer) {
      clearTimeout(resignUnavailableTimer);
      resignUnavailableTimer = null;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
      if (store.get("alwaysOnTop")) reassertAlwaysOnTopLevel(mainWindow);
      if (!mainWindow.isVisible()) mainWindow.showInactive();
    } catch (err) {
      console.warn("[window] become-active restore failed", err);
    }

    const wasAway = externalFullscreenUnavailable;
    externalFullscreenUnavailable = false;
    if (wasAway) {
      logWindowEvent("restored-after-external-fullscreen", mainWindow);
    }

    // One restore tip per session after a meaningful away period.
    if (
      wasAway &&
      awayMs >= BLUR_UNAVAILABLE_MS &&
      !fullscreenTipShownThisSession &&
      currentWindowMode !== "home"
    ) {
      fullscreenTipShownThisSession = true;
      const overlayFs = Boolean(store.get("overlayBrowserFullscreen"));
      safeSend("window:availability", {
        available: true,
        reason: "restored-after-external-fullscreen",
        message: overlayFs
          ? "Meeting Cue is available again."
          : "Meeting Cue is available again. For authorized practice over browser full-screen, enable Stay above browser fullscreen in Settings.",
      });
    }
  });
}

function setupMediaPermissions() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "media" || permission === "display-capture") {
      callback(true);
      return;
    }
    callback(false);
  });

  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" || permission === "display-capture";
  });

  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources[0];
      if (!source) {
        callback({});
        return;
      }
      callback({ video: source, audio: "loopback" });
    } catch {
      callback({});
    }
  });
}

async function ensureMicrophoneAccess(): Promise<{
  granted: boolean;
  message?: string;
}> {
  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return { granted: true };
    if (status === "denied" || status === "restricted") {
      return {
        granted: false,
        message:
          "Microphone permission is blocked. Enable it in System Settings → Privacy & Security → Microphone for Meeting Cue / Electron.",
      };
    }
    const granted = await systemPreferences.askForMediaAccess("microphone");
    if (!granted) {
      return {
        granted: false,
        message:
          "Microphone access was denied. Allow it when prompted, or enable it in System Settings.",
      };
    }
  }
  return { granted: true };
}

/**
 * macOS: type "panel" (NSWindowStyleMaskNonactivatingPanel) is the supported
 * way to float above other apps' full-screen Spaces. visibleOnFullScreen alone
 * is unreliable on modern macOS without a panel window.
 */
function wantsMacPanelWindow(): boolean {
  return (
    process.platform === "darwin" &&
    Boolean(store.get("alwaysOnTop")) &&
    Boolean(store.get("overlayBrowserFullscreen"))
  );
}

let usingMacPanelWindow = false;

function createWindow() {
  const savedRaw = store.get("windowBounds");
  const saved = isValidBounds(savedRaw) ? savedRaw : null;
  const usePanel = wantsMacPanelWindow();
  usingMacPanelWindow = usePanel;

  if (usePanel && app.dock) {
    // First paint as UIElement helps panel join fullscreen Spaces.
    try {
      app.dock.hide();
    } catch {
      /* ignore */
    }
  }

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 860,
    height: saved?.height ?? 620,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 640,
    minHeight: 480,
    show: false,
    frame: false,
    title: "Meeting Cue",
    // Keep transparent for overlay pills; home paints an opaque CSS surface.
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    // Overlay modes turn this off so CSS corner radii aren't double-clipped.
    roundedCorners: true,
    fullscreenable: false,
    maximizable: true,
    minimizable: true,
    alwaysOnTop: Boolean(store.get("alwaysOnTop")),
    ...(usePanel ? { type: "panel" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  if (saved) restorePersistedBounds(mainWindow);
  else if (savedRaw && !saved) {
    console.warn("[window] ignored invalid stored bounds", savedRaw);
    store.set("windowBounds", null);
  }
  applyWindowPrivacy(mainWindow);
  attachWindowLifecycle(mainWindow);

  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}]`, message, sourceId ? `(${sourceId}:${line})` : "");
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[window] did-fail-load", code, desc, url);
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Keep Dock hidden while overlay panel mode is active — required on some
    // macOS versions for the window to join another app's full-screen Space.
    // Restore Dock when leaving overlay panel mode.
    if (app.dock) {
      try {
        if (usePanel) app.dock.hide();
        else app.dock.show();
      } catch {
        /* ignore */
      }
    }
    try {
      mainWindow.setOpacity(1);
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    } catch (err) {
      console.warn("[window] ready-to-show focus failed", err);
    }
    logWindowEvent("show", mainWindow);
  });

  if (isDev) {
    // Prefer VITE_DEV_SERVER_URL from vite-plugin-electron when present.
    const devUrl =
      process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    externalFullscreenUnavailable = false;
    blurStartedAt = null;
  });
}

/**
 * Panel vs normal window cannot be switched in place — recreate when the
 * authorized-practice overlay preference changes on macOS.
 */
function recreateWindowIfNeededForOverlay() {
  if (process.platform !== "darwin") return false;
  const wantPanel = wantsMacPanelWindow();
  if (wantPanel === usingMacPanelWindow && mainWindow && !mainWindow.isDestroyed()) {
    return false;
  }
  const prevMode = currentWindowMode;
  const bounds =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  if (bounds && isValidBounds(bounds) && prevMode !== "bubble") {
    store.set("windowBounds", bounds);
  }
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeAllListeners("closed");
      mainWindow.destroy();
    }
  } catch (err) {
    console.warn("[window] destroy before recreate failed", err);
  }
  mainWindow = null;
  macFullscreenOverlayReady = false;
  createWindow();
  if (prevMode && prevMode !== "home") {
    // Defer mode restore until renderer is ready.
    mainWindow?.webContents.once("did-finish-load", () => {
      try {
        applyWindowMode(prevMode);
      } catch (err) {
        console.warn("[window] restore mode after recreate failed", err);
      }
    });
  }
  return true;
}

function clampWindowToDisplays() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  if (!displays.length) return;
  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds) || displays[0]!;
  const work = display.workArea;
  const next = clampToWorkArea(
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    work
  );
  mainWindow.setBounds(next, false);
  schedulePersistBounds();
}

function registerShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("shortcut:toggle-listen");
  });

  globalShortcut.register("CommandOrControl+Enter", () => {
    mainWindow?.webContents.send("shortcut:generate-answer");
  });

  globalShortcut.register("CommandOrControl+Shift+Enter", () => {
    mainWindow?.webContents.send("shortcut:screenshot-question");
  });

  globalShortcut.register("CommandOrControl+Shift+A", () => {
    mainWindow?.webContents.send("shortcut:generate-answer");
  });

  globalShortcut.register("CommandOrControl+Shift+S", () => {
    mainWindow?.webContents.send("shortcut:screenshot-question");
  });

  globalShortcut.register("CommandOrControl+Shift+H", () => {
    mainWindow?.webContents.send("shortcut:toggle-bubble");
  });

  globalShortcut.register("CommandOrControl+Shift+Backspace", () => {
    mainWindow?.webContents.send("shortcut:clear-transcript");
  });
}

app.whenReady().then(() => {
  setupMediaPermissions();
  createWindow();
  registerShortcuts();
  attachAppActivationHandlers();
  void ensureMicrophoneAccess();

  screen.on("display-added", () => {
    try {
      clampWindowToDisplays();
    } catch (err) {
      console.warn("[window] display-added clamp failed", err);
    }
  });
  screen.on("display-removed", () => {
    try {
      clampWindowToDisplays();
    } catch (err) {
      console.warn("[window] display-removed clamp failed", err);
    }
  });
  screen.on("display-metrics-changed", () => {
    try {
      clampWindowToDisplays();
    } catch (err) {
      console.warn("[window] display-metrics-changed clamp failed", err);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else {
      try {
        mainWindow?.show();
        if (store.get("alwaysOnTop") && mainWindow && !mainWindow.isDestroyed()) {
          applyAlwaysOnTop(mainWindow, true);
        }
      } catch (err) {
        console.warn("[window] activate restore failed", err);
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (persistBoundsTimer) clearTimeout(persistBoundsTimer);
  if (resignUnavailableTimer) clearTimeout(resignUnavailableTimer);
});

ipcMain.handle("settings:get", () => store.store);

ipcMain.handle("settings:set", (_event, partial: Partial<AppSettings>) => {
  for (const [key, value] of Object.entries(partial)) {
    store.set(key as keyof AppSettings, value as never);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (
      typeof partial.alwaysOnTop === "boolean" ||
      typeof partial.overlayBrowserFullscreen === "boolean"
    ) {
      macFullscreenOverlayReady = false;
      if (!recreateWindowIfNeededForOverlay()) {
        applyAlwaysOnTop(mainWindow, store.get("alwaysOnTop"));
      }
    }
    if (typeof partial.excludeFromShare === "boolean") {
      try {
        mainWindow.setContentProtection(partial.excludeFromShare);
      } catch (err) {
        console.warn("[window] setContentProtection failed", err);
      }
    }
    if (typeof partial.uiOpacity === "number") {
      const value = Math.min(1, Math.max(0.25, partial.uiOpacity));
      try {
        mainWindow.setOpacity(value);
      } catch (err) {
        console.warn("[window] setOpacity from settings failed", err);
      }
    }
  }
  return store.store;
});

ipcMain.handle("window:set-always-on-top", (_event, enabled: boolean) => {
  store.set("alwaysOnTop", Boolean(enabled));
  if (!enabled) {
    store.set("overlayBrowserFullscreen", false);
  }
  macFullscreenOverlayReady = false;
  if (!recreateWindowIfNeededForOverlay() && mainWindow && !mainWindow.isDestroyed()) {
    applyAlwaysOnTop(mainWindow, Boolean(enabled));
  }
  return Boolean(enabled);
});

ipcMain.handle(
  "window:set-overlay-browser-fullscreen",
  (_event, enabled: boolean) => {
    const next = Boolean(enabled);
    store.set("overlayBrowserFullscreen", next);
    macFullscreenOverlayReady = false;
    // Panel window is required on macOS — recreate when crossing the boundary.
    if (!recreateWindowIfNeededForOverlay() && mainWindow && !mainWindow.isDestroyed()) {
      applyAlwaysOnTop(mainWindow, store.get("alwaysOnTop"));
      try {
        if (next && store.get("alwaysOnTop")) {
          mainWindow.showInactive();
          mainWindow.moveTop();
        }
      } catch (err) {
        console.warn("[window] overlay show after enable failed", err);
      }
    }
    console.log(
      "[window] overlayBrowserFullscreen=",
      next,
      "panel=",
      usingMacPanelWindow
    );
    return next;
  }
);

ipcMain.handle("window:get-diagnostics", () => getWindowSnapshot());

ipcMain.handle("window:set-exclude-from-share", (_event, enabled: boolean) => {
  store.set("excludeFromShare", enabled);
  mainWindow?.setContentProtection(enabled);
  return enabled;
});

ipcMain.handle("media:ensure-microphone", async () => ensureMicrophoneAccess());

function isMostlyBlank(image: NativeImage): boolean {
  if (image.isEmpty()) return true;
  const { width, height } = image.getSize();
  if (width < 32 || height < 32) return true;
  const small = image.resize({ width: 48, height: 28, quality: "good" });
  const buf = small.toBitmap();
  let sum = 0;
  let n = 0;
  for (let i = 0; i < buf.length; i += 4) {
    sum += buf[i]! + buf[i + 1]! + buf[i + 2]!;
    n += 1;
  }
  const avg = n ? sum / n / 3 : 0;
  return avg < 14;
}

async function grabDisplayThumbnail(): Promise<NativeImage> {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const scale = display.scaleFactor || 1;
  const rawW = Math.round(display.size.width * scale);
  const rawH = Math.round(display.size.height * scale);
  // Keep OCR sharp — allow up to ~1920px on the long edge.
  const ratio = Math.min(1, 1920 / rawW, 1200 / rawH);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.max(1280, Math.round(rawW * ratio)),
      height: Math.max(720, Math.round(rawH * ratio)),
    },
  });
  const displayId = String(display.id);
  const source =
    sources.find((s) => s.display_id === displayId) ||
    sources.find((s) => s.id.startsWith("screen")) ||
    sources[0];
  if (!source) throw new Error("Could not capture the screen.");
  return source.thumbnail;
}

function macScreenCaptureJpeg(): Promise<Buffer> {
  const file = path.join(os.tmpdir(), `meeting-cue-${Date.now()}.jpg`);
  return new Promise((resolve, reject) => {
    execFile("screencapture", ["-x", "-t", "jpg", file], (err) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        const buf = fs.readFileSync(file);
        fs.unlinkSync(file);
        resolve(buf);
      } catch (readErr) {
        reject(readErr);
      }
    });
  });
}

/**
 * Capture the display for Screenshot Q.
 * Temporarily hide the overlay so the slide/doc behind it is in the frame.
 */
ipcMain.handle("screen:capture", async () => {
  if (!mainWindow) throw new Error("Window not ready");

  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status === "denied" || status === "restricted") {
      throw new Error(
        "Screen Recording is off. In System Settings → Privacy & Security → Screen Recording, enable Electron, then quit and reopen the app."
      );
    }
  }

  const win = mainWindow;
  const prevOpacity = win.getOpacity();
  const prevProtection = store.get("excludeFromShare");

  try {
    // Hide the cue overlay for a clean shot of what's behind it.
    win.setOpacity(0);
    win.setContentProtection(false);
    await new Promise((r) => setTimeout(r, 220));

    // Prefer native macOS capture — sharper text for OCR than desktopCapturer thumbs.
    if (process.platform === "darwin") {
      try {
        const jpeg = await macScreenCaptureJpeg();
        if (jpeg.length > 8000) {
          return {
            mimeType: "image/jpeg",
            base64: jpeg.toString("base64"),
          };
        }
      } catch {
        // fall through to desktopCapturer
      }
    }

    let image = await grabDisplayThumbnail();
    if (isMostlyBlank(image)) {
      await new Promise((r) => setTimeout(r, 160));
      image = await grabDisplayThumbnail();
    }

    if (!isMostlyBlank(image)) {
      return {
        mimeType: "image/jpeg",
        base64: image.toJPEG(88).toString("base64"),
      };
    }

    throw new Error(
      "Screen capture came back blank. Enable Screen Recording for Electron in System Settings → Privacy & Security, then restart the app."
    );
  } finally {
    if (!win.isDestroyed()) {
      win.setOpacity(prevOpacity || 1);
      win.setContentProtection(prevProtection);
    }
  }
});

ipcMain.handle("window:minimize", () => {
  // Minimize becomes a floating always-on-top chip (Parakeet-style).
  return floatWindow();
});

ipcMain.handle("window:maximize", () => {
  if (!mainWindow) return;
  if (currentWindowMode === "bubble") {
    applyWindowMode(modeBeforeFloat || "home");
    mainWindow.webContents.send("window:exit-float", {
      mode: modeBeforeFloat || "home",
    });
    return;
  }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("window:set-mode", (_event, mode: WindowMode) => {
  if (!WINDOW_MODES[mode]) return false;
  applyWindowMode(mode);
  if (mode !== "bubble") {
    mainWindow?.webContents.send("window:exit-float", { mode });
  }
  return true;
});

ipcMain.handle("window:restore-from-float", () => {
  const mode = modeBeforeFloat || "home";
  applyWindowMode(mode);
  mainWindow?.webContents.send("window:exit-float", { mode });
  return mode;
});

ipcMain.handle("window:get-bounds", () => {
  if (!mainWindow) return null;
  return mainWindow.getBounds();
});

ipcMain.handle("window:set-position", (_event, x: number, y: number) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  try {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching({
      x: Math.round(x),
      y: Math.round(y),
      width: bounds.width,
      height: bounds.height,
    });
    const next = clampToWorkArea(
      Math.round(x),
      Math.round(y),
      bounds.width,
      bounds.height,
      display.workArea
    );
    mainWindow.setBounds(next, false);
    if (currentWindowMode === "bubble") {
      boundsBeforeFloat = {
        x: next.x,
        y: next.y,
        width: boundsBeforeFloat?.width ?? WINDOW_MODES.home.width,
        height: boundsBeforeFloat?.height ?? WINDOW_MODES.home.height,
      };
    } else {
      boundsBeforeFloat = next;
      schedulePersistBounds();
    }
    return true;
  } catch (err) {
    console.warn("[window] set-position failed", err);
    return false;
  }
});

ipcMain.handle("window:nudge", (_event, dx: number, dy: number) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const next = clampToWorkArea(
      bounds.x + Math.round(dx),
      bounds.y + Math.round(dy),
      bounds.width,
      bounds.height,
      display.workArea
    );
    mainWindow.setBounds(next, false);
    if (currentWindowMode === "bubble") {
      boundsBeforeFloat = {
        x: next.x,
        y: next.y,
        width: boundsBeforeFloat?.width ?? WINDOW_MODES.home.width,
        height: boundsBeforeFloat?.height ?? WINDOW_MODES.home.height,
      };
    } else {
      schedulePersistBounds();
    }
    return next;
  } catch (err) {
    console.warn("[window] nudge failed", err);
    return null;
  }
});

ipcMain.handle("window:resize-by", (_event, dw: number, dh: number) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (currentWindowMode === "bubble" || currentWindowMode === "home") {
    return mainWindow.getBounds();
  }
  try {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const work = display.workArea;
    const minW = currentWindowMode === "overlay" ? 480 : 520;
    const minH = currentWindowMode === "overlay" ? 160 : 280;
    const width = Math.min(
      work.width - 16,
      Math.max(minW, bounds.width + Math.round(dw))
    );
    const height = Math.min(
      work.height - 16,
      Math.max(minH, bounds.height + Math.round(dh))
    );
    const next = clampToWorkArea(bounds.x, bounds.y, width, height, work);
    const wasResizable = mainWindow.isResizable();
    mainWindow.setResizable(true);
    mainWindow.setBounds(next, false);
    mainWindow.setResizable(wasResizable);
    schedulePersistBounds();
    return next;
  } catch (err) {
    console.warn("[window] resize-by failed", err);
    return null;
  }
});

ipcMain.handle("window:set-opacity", (_event, opacity: number) => {
  if (!mainWindow) return 1;
  const value = Math.min(1, Math.max(0.25, Number(opacity) || 1));
  mainWindow.setOpacity(value);
  return value;
});

import { contextBridge, ipcRenderer } from "electron";

export type AppSettings = {
  apiKey: string;
  geminiApiKey: string;
  apiBaseUrl: string;
  model: string;
  geminiModel: string;
  whisperModel: string;
  visionModel: string;
  answerProvider: "gemini" | "groq";
  alwaysOnTop: boolean;
  overlayBrowserFullscreen: boolean;
  excludeFromShare: boolean;
  companyContext: string;
  darkMode: boolean;
  uiOpacity: number;
};

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:set", partial),
  setAlwaysOnTop: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("window:set-always-on-top", enabled),
  setOverlayBrowserFullscreen: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("window:set-overlay-browser-fullscreen", enabled),
  setExcludeFromShare: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("window:set-exclude-from-share", enabled),
  ensureMicrophone: (): Promise<{ granted: boolean; message?: string }> =>
    ipcRenderer.invoke("media:ensure-microphone"),
  captureScreen: (): Promise<{ mimeType: string; base64: string }> =>
    ipcRenderer.invoke("screen:capture"),
  windowMinimize: (): Promise<boolean> => ipcRenderer.invoke("window:minimize"),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  windowClose: (): Promise<void> => ipcRenderer.invoke("window:close"),
  setWindowMode: (
    mode: "home" | "overlay" | "answer" | "bubble"
  ): Promise<boolean> => ipcRenderer.invoke("window:set-mode", mode),
  restoreFromFloat: (): Promise<"home" | "overlay" | "answer" | "bubble"> =>
    ipcRenderer.invoke("window:restore-from-float"),
  getBounds: (): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null> => ipcRenderer.invoke("window:get-bounds"),
  setPosition: (x: number, y: number): Promise<boolean> =>
    ipcRenderer.invoke("window:set-position", x, y),
  nudgeWindow: (
    dx: number,
    dy: number
  ): Promise<{ x: number; y: number } | null> =>
    ipcRenderer.invoke("window:nudge", dx, dy),
  resizeWindowBy: (
    dw: number,
    dh: number
  ): Promise<{ x: number; y: number; width: number; height: number } | null> =>
    ipcRenderer.invoke("window:resize-by", dw, dh),
  setWindowOpacity: (opacity: number): Promise<number> =>
    ipcRenderer.invoke("window:set-opacity", opacity),
  getWindowDiagnostics: (): Promise<{
    id: number | null;
    mode: string;
    isVisible: boolean;
    isFocused: boolean;
    isFullScreen: boolean;
    isAlwaysOnTop: boolean;
    alwaysOnTopSetting: boolean;
    overlayBrowserFullscreen: boolean;
    alwaysOnTopLevel: string;
    visibleOnFullScreen: boolean;
    externalFullscreenUnavailable: boolean;
    platform: string;
  }> => ipcRenderer.invoke("window:get-diagnostics"),
  onWindowLifecycle: (
    callback: (payload: Record<string, unknown>) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: Record<string, unknown>
    ) => callback(payload);
    ipcRenderer.on("window:lifecycle", listener);
    return () => ipcRenderer.removeListener("window:lifecycle", listener);
  },
  onWindowAvailability: (
    callback: (payload: {
      available: boolean;
      reason: string;
      message: string;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { available: boolean; reason: string; message: string }
    ) => callback(payload);
    ipcRenderer.on("window:availability", listener);
    return () => ipcRenderer.removeListener("window:availability", listener);
  },
  onEnterFloat: (callback: (payload: { previousMode: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { previousMode: string }
    ) => callback(payload);
    ipcRenderer.on("window:enter-float", listener);
    return () => ipcRenderer.removeListener("window:enter-float", listener);
  },
  onExitFloat: (callback: (payload: { mode: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { mode: string }
    ) => callback(payload);
    ipcRenderer.on("window:exit-float", listener);
    return () => ipcRenderer.removeListener("window:exit-float", listener);
  },
  onToggleListen: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:toggle-listen", listener);
    return () => ipcRenderer.removeListener("shortcut:toggle-listen", listener);
  },
  onGenerateAnswer: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:generate-answer", listener);
    return () =>
      ipcRenderer.removeListener("shortcut:generate-answer", listener);
  },
  onScreenshotQuestion: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:screenshot-question", listener);
    return () =>
      ipcRenderer.removeListener("shortcut:screenshot-question", listener);
  },
  onToggleBubble: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:toggle-bubble", listener);
    return () =>
      ipcRenderer.removeListener("shortcut:toggle-bubble", listener);
  },
  onClearTranscript: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:clear-transcript", listener);
    return () =>
      ipcRenderer.removeListener("shortcut:clear-transcript", listener);
  },
};

contextBridge.exposeInMainWorld("meetingCue", api);

/// <reference types="vite/client" />

declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const workerSrc: string;
  export default workerSrc;
}

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
  overlayBrowserFullscreen: boolean;
  excludeFromShare: boolean;
  companyContext: string;
  darkMode: boolean;
  uiOpacity: number;
};

interface MeetingCueApi {
  getSettings: () => Promise<AppSettings>;
  setSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
  setOverlayBrowserFullscreen: (enabled: boolean) => Promise<boolean>;
  setExcludeFromShare: (enabled: boolean) => Promise<boolean>;
  ensureMicrophone: () => Promise<{ granted: boolean; message?: string }>;
  ensureScreenCapture: () => Promise<{ granted: boolean; message?: string }>;
  prepareSessionMedia: () => Promise<{
    microphone: { ok: boolean; status: string; message: string };
    screen: { ok: boolean; status: string; message: string };
  }>;
  getMediaStatus: () => Promise<{
    microphone: string;
    screen: string;
    packaged: boolean;
  }>;
  openScreenSettings: () => Promise<boolean>;
  openMicSettings: () => Promise<boolean>;
  resetMediaTcc: () => Promise<{
    ok: boolean;
    message: string;
    results?: string[];
  }>;
  quitApp: () => Promise<boolean>;
  getMediaAppInfo: () => Promise<{
    name: string;
    bundleId: string;
    path: string;
    execPath: string;
    packaged: boolean;
    screen: string;
    microphone: string;
  }>;
  enableLoopbackAudio: (opts?: { useSystemPicker?: boolean }) => Promise<void>;
  disableLoopbackAudio: () => Promise<void>;
  captureScreen: () => Promise<{ mimeType: string; base64: string }>;
  windowMinimize: () => Promise<boolean>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  setWindowMode: (
    mode: "home" | "overlay" | "answer" | "bubble"
  ) => Promise<boolean>;
  restoreFromFloat: () => Promise<"home" | "overlay" | "answer" | "bubble">;
  getBounds: () => Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>;
  setPosition: (x: number, y: number) => Promise<boolean>;
  nudgeWindow: (
    dx: number,
    dy: number
  ) => Promise<{ x: number; y: number } | null>;
  resizeWindowBy: (
    dw: number,
    dh: number
  ) => Promise<{ x: number; y: number; width: number; height: number } | null>;
  setWindowOpacity: (opacity: number) => Promise<number>;
  getWindowDiagnostics: () => Promise<{
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
  }>;
  onWindowLifecycle: (
    callback: (payload: Record<string, unknown>) => void
  ) => () => void;
  onWindowAvailability: (
    callback: (payload: {
      available: boolean;
      reason: string;
      message: string;
    }) => void
  ) => () => void;
  onEnterFloat: (
    callback: (payload: { previousMode: string }) => void
  ) => () => void;
  onExitFloat: (callback: (payload: { mode: string }) => void) => () => void;
  onToggleListen: (callback: () => void) => () => void;
  onGenerateAnswer: (callback: () => void) => () => void;
  onScreenshotQuestion: (callback: () => void) => () => void;
  onToggleBubble: (callback: () => void) => () => void;
  onClearTranscript: (callback: () => void) => () => void;
}

interface Window {
  meetingCue: MeetingCueApi;
}

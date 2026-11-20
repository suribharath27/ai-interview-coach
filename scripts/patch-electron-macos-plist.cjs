/**
 * Local `npm run dev` uses Electron.app from node_modules. On macOS 14.2+,
 * CoreAudio Tap system-audio capture requires NSAudioCaptureUsageDescription
 * on the responsible process — Electron's stock Info.plist omits it.
 *
 * Packaged Meeting Cue apps get these keys via electron-builder extendInfo.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

if (process.platform !== "darwin") {
  process.exit(0);
}

const plistPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
  "Contents",
  "Info.plist"
);

if (!fs.existsSync(plistPath)) {
  console.warn("[patch-electron-macos-plist] Electron.app Info.plist not found — skip");
  process.exit(0);
}

const keys = {
  NSAudioCaptureUsageDescription:
    "Meeting Cue (dev) needs system audio to transcribe the other person on the call.",
  NSScreenCaptureUsageDescription:
    "Meeting Cue (dev) needs Screen Recording to hear system / meeting audio.",
  NSMicrophoneUsageDescription:
    "Meeting Cue (dev) needs the microphone to capture your voice during calls.",
};

for (const [key, value] of Object.entries(keys)) {
  try {
    execFileSync(
      "plutil",
      ["-replace", key, "-string", value, plistPath],
      { stdio: "pipe" }
    );
  } catch {
    try {
      execFileSync(
        "plutil",
        ["-insert", key, "-string", value, plistPath],
        { stdio: "pipe" }
      );
    } catch (err) {
      console.warn(`[patch-electron-macos-plist] failed to set ${key}:`, err);
    }
  }
}

console.log("[patch-electron-macos-plist] patched Electron.app Info.plist for system audio");

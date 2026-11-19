# Meeting Cue

Private AI overlay for **stakeholder / client meetings**.

When you screen-share a deck or product demo, this window stays on your screen as talking-point cues — and is **excluded from screen capture** so clients don’t see your assistant UI.

## Download

**macOS (Apple Silicon):** get the latest installer from
[Releases](https://github.com/suribharath27/ai-interview-coach/releases/latest)

1. Download `Meeting Cue-1.0.0-arm64.dmg`
2. Open the DMG → drag **Meeting Cue** to **Applications**
3. First launch (unsigned build): right-click → **Open** → confirm  
   or run: `xattr -cr "/Applications/Meeting Cue.app"`
4. Open Settings → add your **Groq** (speech) + **Gemini** (answers/screenshots) API keys

## Why this exists

During live meetings, stakeholders ask about product ideas, pricing, roadmap, or business model. You need fast, grounded talking points without putting your notes or AI panel on the shared screen.

## Features

- Cross-platform desktop app (Windows + macOS)
- **Exclude from screen share** via Electron `setContentProtection`
  - macOS: `NSWindowSharingNone`
  - Windows: `WDA_EXCLUDEFROMCAPTURE`
- Always-on-top private cue window
- Modes: Product, Business, Pricing, Roadmap, Objection handling
- Company/product knowledge base (paste FAQ, pricing, roadmap)
- Mic capture + typed questions
- Streaming AI responses for low latency
- Shortcuts:
  - `Cmd/Ctrl + Shift + Space` — toggle mic
  - `Cmd/Ctrl + Shift + A` — generate talking points
  - `Cmd/Ctrl + Shift + H` — hide/show cue window

## Setup

```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd ~/ai-interview-coach
npm install
npm run dev
```

1. Open **Settings**
2. Create a free key at [console.groq.com/keys](https://console.groq.com/keys)
3. Keep the default preset **Groq · Best overall**
4. Paste your **company / product knowledge base**
5. Keep **Exclude this window from screen share** ON

## Recommended open-weight APIs

| Job | Model | Why |
| --- | --- | --- |
| Talking points | `openai/gpt-oss-120b` on Groq | Open-weight, strong quality, ~500 tok/s |
| Listen (speech) | `whisper-large-v3-turbo` on Groq | Open-weight, fast multilingual STT |
| Listen (max accuracy) | `whisper-large-v3` on Groq | Open-weight, highest Groq ASR quality |
| Ultra-low latency cues | `openai/gpt-oss-20b` on Groq | Smaller open model, ~1000 tok/s |

Base URL: `https://api.groq.com/openai/v1`

## Screen share tips

- Prefer sharing a **specific window or browser tab** (your deck/demo), not the whole desktop, when possible
- In **Zoom**, enable **Advanced capture with window filtering** so content-protected windows stay private during full-screen share
- Test with a colleague before an important client call

## Chrome / macOS full-screen behavior

Meeting Cue uses always-on-top (`pop-up-menu` by default) and can follow Spaces.

**Default:** it does **not** overlay exclusive full-screen Spaces (Chrome F11, site Fullscreen API, or protected exam sessions). A system notification and in-app banner explain when it is unavailable.

**Authorized practice:** Settings → **Stay above browser fullscreen** (requires Always on top). This raises the window level (`screen-saver`) and, on macOS, sets `visibleOnFullScreen` after a brief Dock hide so the process becomes a UIElementApplication (required on modern macOS). Toggle the setting **off → on** once after updating if an older session was already running. Do **not** enable this for proctored or monitored exams.

| Scenario | Expected |
| --- | --- |
| Chrome normal / maximized | Stays above with Always on top |
| Chrome F11 / site fullscreen (default) | Unavailable until you exit full screen |
| Chrome F11 with Stay above browser fullscreen ON | Can remain visible (authorized practice) |
| Protected / exclusive full-screen | OS may still hide overlays; exit full screen |
| Switch Spaces (non-fullscreen) | Visible on Spaces when Always on top is on |
| Exit full screen | Restores; banner / notice may appear |

## Window management test checklist

1. Normal Chrome window — assistant stays on top when enabled  
2. Chrome maximized — same  
3. Chrome F11 (default) — does not force above; returns after exit + notice  
4. Chrome F11 with Stay above browser fullscreen — can stay visible (practice)  
5. Website Fullscreen API — same as F11 for the active setting  
6. Switching macOS Spaces — visible on non-fullscreen Spaces when Always on top is on  
7. Multiple monitors — drag/clamp stays on a work area  
8. Float chip (minimize) — drag, restore, opacity slider in live session  
9. Exit full screen — assistant restores position

## Build installers

```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd ~/ai-interview-coach
npm install

# macOS (.dmg + .zip) — run on a Mac
npm run dist:mac

# Windows (.exe installer + portable) — run on Windows, or cross-build with wine
npm run dist:win
```

Installers land in `release/`:

- macOS: `Meeting Cue-1.0.0.dmg` — open, drag to Applications
- Windows: `Meeting Cue Setup 1.0.0.exe`

First launch on macOS (unsigned local build): right-click the app → **Open** → confirm.

Keep **Exclude window from screen share** ON in Settings so the cue window is omitted from Zoom/Meet/Teams capture APIs.

## Academic / project framing

This project demonstrates:

- Desktop app engineering with Electron
- OS-level window capture privacy APIs
- Low-latency streaming LLM UX
- Domain-grounded meeting assistance with a knowledge base

It is designed for **presenter privacy during legitimate business meetings**, not for hiding assistance during interviews, exams, or from AI proctoring tools.

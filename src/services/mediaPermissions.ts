export type MediaCheck = {
  ok: boolean;
  status: string;
  message: string;
};

export type SessionMediaReady = {
  microphone: MediaCheck;
  screen: MediaCheck;
  systemAudio: MediaCheck;
  allOk: boolean;
};

async function measurePeakAmplitude(
  track: MediaStreamTrack,
  ms: number
): Promise<number> {
  const ctx = new AudioContext();
  try {
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const started = performance.now();
    while (performance.now() - started < ms) {
      await new Promise((r) => setTimeout(r, 80));
      analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        peak = Math.max(peak, Math.abs(buf[i]!));
      }
    }
    return peak;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function stripVideo(display: MediaStream): MediaStreamTrack[] {
  for (const track of display.getVideoTracks()) {
    track.stop();
    display.removeTrack(track);
  }
  return display.getAudioTracks();
}

async function requestDisplay(useSystemPicker: boolean): Promise<MediaStream> {
  const bridge = window.meetingCue;
  if (!bridge?.enableLoopbackAudio) {
    throw new Error("System audio bridge unavailable — reopen the desktop app.");
  }
  await bridge.enableLoopbackAudio({ useSystemPicker });
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
    systemAudio: "include",
  } as DisplayMediaStreamConstraints);
}

/**
 * Open system audio. Prefer direct loopback (no share sheet) — the macOS
 * picker often returns video-only even when System Audio Recording Only is on.
 */
export async function openSystemAudioStream(): Promise<MediaStream> {
  const bridge = window.meetingCue;
  let lastError: Error | null = null;

  // 1) Direct loopback — works once Screen + System Audio Recording Only are granted.
  try {
    const display = await requestDisplay(false);
    const audioTracks = stripVideo(display);
    if (audioTracks.length && audioTracks[0]!.readyState !== "ended") {
      return display;
    }
    display.getTracks().forEach((t) => t.stop());
    if (!audioTracks.length) {
      lastError = new Error("Loopback returned no audio track.");
    } else {
      lastError = new Error(
        "System audio track ended immediately — System Audio Recording Only may need a full app restart."
      );
    }
  } catch (err) {
    lastError = err as Error;
  }

  // 2) One share-sheet attempt (helps first-time TCC), then caller should retry loopback after restart.
  try {
    const display = await requestDisplay(true);
    const audioTracks = stripVideo(display);
    if (audioTracks.length && audioTracks[0]!.readyState !== "ended") {
      return display;
    }
    display.getTracks().forEach((t) => t.stop());
  } catch (err) {
    lastError = err as Error;
  } finally {
    try {
      await bridge?.enableLoopbackAudio?.({ useSystemPicker: false });
    } catch {
      /* ignore */
    }
  }

  const raw = lastError?.message || "System audio failed.";
  if (/NotAllowed|Permission denied|dismissed/i.test(raw)) {
    throw new Error(
      "Permission dismissed. Enable Meeting Cue under System Audio Recording Only, Cmd+Q, reopen, then Recheck."
    );
  }
  throw new Error(
    `${raw} Keep Meeting Cue ON under System Audio Recording Only, fully quit (Cmd+Q), reopen, then Recheck — no share sheet needed.`
  );
}

export async function probeSystemAudio(options?: {
  listenMs?: number;
}): Promise<MediaCheck> {
  const listenMs = options?.listenMs ?? 900;
  let stream: MediaStream | null = null;
  try {
    stream = await openSystemAudioStream();
    const track = stream.getAudioTracks()[0]!;
    const peak = await measurePeakAmplitude(track, listenMs);
    if (peak >= 0.0005) {
      return {
        ok: true,
        status: "live",
        message: "System audio is working.",
      };
    }
    return {
      ok: true,
      status: "silent",
      message:
        "System audio connected (quiet right now). Play YouTube/a call, then continue.",
    };
  } catch (err) {
    const raw = (err as Error).message || String(err);
    return {
      ok: false,
      status: "error",
      message: raw,
    };
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      await window.meetingCue?.disableLoopbackAudio?.();
    } catch {
      /* ignore */
    }
  }
}

export async function prepareSessionMedia(): Promise<SessionMediaReady> {
  const bridge = window.meetingCue;
  let microphone: MediaCheck = {
    ok: false,
    status: "unknown",
    message: "Microphone not checked.",
  };
  let screen: MediaCheck = {
    ok: false,
    status: "unknown",
    message: "Screen Recording not checked.",
  };

  if (bridge?.prepareSessionMedia) {
    const prepared = await bridge.prepareSessionMedia();
    microphone = prepared.microphone;
    screen = prepared.screen;
  } else {
    if (bridge?.ensureMicrophone) {
      const mic = await bridge.ensureMicrophone();
      microphone = {
        ok: mic.granted,
        status: mic.granted ? "granted" : "denied",
        message:
          mic.message || (mic.granted ? "Microphone ready." : "Microphone blocked."),
      };
    }
    if (bridge?.ensureScreenCapture) {
      const scr = await bridge.ensureScreenCapture();
      screen = {
        ok: scr.granted,
        status: scr.granted ? "granted" : "denied",
        message:
          scr.message ||
          (scr.granted ? "Screen Recording ready." : "Screen Recording blocked."),
      };
    }
  }

  const systemAudio = screen.ok
    ? await probeSystemAudio()
    : {
        ok: false,
        status: "skipped",
        message: "Grant Screen Recording first, then test system audio.",
      };

  if (systemAudio.ok && !screen.ok) {
    screen = {
      ok: true,
      status: "granted",
      message: "Screen Recording ready.",
    };
  }

  return {
    microphone,
    screen,
    systemAudio,
    allOk: microphone.ok && screen.ok && systemAudio.ok,
  };
}

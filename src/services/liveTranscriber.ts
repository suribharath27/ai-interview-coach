import { transcribeAudio } from "./ai";
import { pcmToWav16k } from "./wav";

export type Speaker = "client" | "me";

type TranscribeConfig = {
  apiKey: string;
  apiBaseUrl: string;
  whisperModel: string;
  /** Fast model for partials; defaults to turbo when whisperModel is large-v3. */
  whisperModelPartial?: string;
  prompt?: string;
  language?: string;
  forceTechnical?: boolean;
};

type Handlers = {
  onPartial: (speaker: Speaker, text: string) => void;
  onFinal: (speaker: Speaker, text: string) => void;
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
  onClientQuestion?: (text: string) => void;
};

type Lane = {
  stream: MediaStream;
  ctx: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  chunks: Float32Array[];
  speaking: boolean;
  speechStartedAt: number;
  silenceStartedAt: number;
  lastPartialAt: number;
  partialInFlight: boolean;
  committed: string;
  enabled: boolean;
};

/**
 * Dual-lane live transcription with independent mic / system-audio toggles.
 */
export class DualLiveTranscriber {
  private me: Lane | null = null;
  private client: Lane | null = null;
  private active = false;
  private config: TranscribeConfig | null = null;
  private handlers: Handlers | null = null;
  private micWanted = true;
  private clientWanted = false;

  get isActive() {
    return this.active;
  }

  get hasClient() {
    return Boolean(this.client?.enabled);
  }

  get hasMic() {
    return Boolean(this.me?.enabled);
  }

  async start(options: {
    config: TranscribeConfig;
    handlers: Handlers;
    mic?: boolean;
    client?: boolean;
  }) {
    await this.stop();
    this.config = options.config;
    this.handlers = options.handlers;
    this.active = true;
    this.micWanted = options.mic !== false;
    this.clientWanted = options.client === true;

    try {
      if (this.micWanted) await this.startMicLane();
      if (this.clientWanted) await this.attachClientAudio();
      this.emitStatus();
    } catch (err) {
      this.handlers.onError?.(
        `Could not start live listen: ${(err as Error).message}`
      );
      await this.stop();
    }
  }

  async setMicEnabled(enabled: boolean) {
    this.micWanted = enabled;
    if (!this.active || !this.config || !this.handlers) return;

    if (enabled && !this.me) {
      await this.startMicLane();
    } else if (!enabled && this.me) {
      await this.teardownLane(this.me);
      this.me = null;
      this.handlers.onPartial("me", "");
    }
    this.emitStatus();
  }

  async setClientEnabled(enabled: boolean) {
    this.clientWanted = enabled;
    if (!this.active || !this.config || !this.handlers) return;

    if (enabled) {
      await this.attachClientAudio();
    } else if (this.client) {
      await this.teardownLane(this.client);
      this.client = null;
      this.handlers.onPartial("client", "");
    }
    this.emitStatus();
  }

  async attachClientAudio() {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      display.getVideoTracks().forEach((t) => {
        t.enabled = false;
      });
      const audioTracks = display.getAudioTracks();
      if (!audioTracks.length) {
        display.getTracks().forEach((t) => t.stop());
        this.handlers?.onError?.(
          "No system/call audio captured. Enable sharing audio when prompted."
        );
        this.clientWanted = false;
        return;
      }
      const audioOnly = new MediaStream(audioTracks);
      display.getVideoTracks().forEach((t) => t.stop());
      if (this.client) await this.teardownLane(this.client);
      this.client = this.buildLane(audioOnly, "client");
      this.clientWanted = true;
      this.emitStatus();
    } catch (err) {
      this.clientWanted = false;
      this.handlers?.onError?.(
        `Client audio not connected: ${(err as Error).message}`
      );
    }
  }

  async stop() {
    this.active = false;
    if (this.me) await this.teardownLane(this.me);
    if (this.client) await this.teardownLane(this.client);
    this.me = null;
    this.client = null;
    this.config = null;
    this.handlers = null;
  }

  private async startMicLane() {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    if (this.me) await this.teardownLane(this.me);
    this.me = this.buildLane(mic, "me");
  }

  private emitStatus() {
    const parts: string[] = [];
    if (this.hasMic) parts.push("Me (mic)");
    if (this.hasClient) parts.push("Client (system)");
    this.handlers?.onStatus?.(
      parts.length ? `Listening: ${parts.join(" + ")}` : "No audio sources on"
    );
  }

  private buildLane(stream: MediaStream, speaker: Speaker): Lane {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;

    const lane: Lane = {
      stream,
      ctx,
      processor,
      source,
      chunks: [],
      speaking: false,
      speechStartedAt: 0,
      silenceStartedAt: 0,
      lastPartialAt: 0,
      partialInFlight: false,
      committed: "",
      enabled: true,
    };

    processor.onaudioprocess = (event) => {
      if (!this.active || !lane.enabled) return;
      const input = event.inputBuffer.getChannelData(0);
      this.onFrame(speaker, lane, new Float32Array(input));
    };

    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    return lane;
  }

  private async teardownLane(lane: Lane) {
    lane.enabled = false;
    lane.processor.onaudioprocess = null;
    try {
      lane.processor.disconnect();
      lane.source.disconnect();
    } catch {
      // ignore
    }
    lane.stream.getTracks().forEach((t) => t.stop());
    try {
      await lane.ctx.close();
    } catch {
      // ignore
    }
  }

  private onFrame(speaker: Speaker, lane: Lane, frame: Float32Array) {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const threshold = speaker === "client" ? 0.008 : 0.012;
    const now = performance.now();
    const loud = rms > threshold;

    if (loud) {
      if (!lane.speaking) {
        lane.speaking = true;
        lane.speechStartedAt = now;
        lane.chunks = [];
      }
      lane.chunks.push(frame);
      lane.silenceStartedAt = 0;

      // Partials are sparse to stay under Groq Whisper ~20 RPM.
      if (
        now - lane.lastPartialAt > 5500 &&
        !lane.partialInFlight &&
        lane.chunks.length > 16
      ) {
        lane.lastPartialAt = now;
        void this.transcribePartial(speaker, lane);
      }
      return;
    }

    if (!lane.speaking) return;
    lane.chunks.push(frame);
    if (!lane.silenceStartedAt) lane.silenceStartedAt = now;

    const spokeMs = now - lane.speechStartedAt;
    const silentMs = now - lane.silenceStartedAt;
    // Slightly longer end-of-utterance wait → cleaner chunks for Whisper
    // (closer to Parakeet waiting for the interviewer to finish).
    if (spokeMs > 800 && silentMs > 1400 && !lane.partialInFlight) {
      void this.finalizeUtterance(speaker, lane);
    }
  }

  private resolveModels() {
    const finalModel = this.config?.whisperModel || "whisper-large-v3";
    const partialModel =
      this.config?.whisperModelPartial ||
      (finalModel.includes("turbo")
        ? finalModel
        : "whisper-large-v3-turbo");
    return { finalModel, partialModel };
  }

  private promptForLane(lane: Lane): string {
    const base = (this.config?.prompt || "").trim();
    const recent = lane.committed.trim().slice(-280);
    if (!recent) return base;
    // Whisper treats prompt like prior transcript — append recent speech last.
    return `${base} ${recent}`.replace(/\s+/g, " ").trim().slice(0, 800);
  }

  private async transcribePartial(speaker: Speaker, lane: Lane) {
    if (!this.config || lane.partialInFlight) return;
    lane.partialInFlight = true;
    try {
      const blob = pcmToWav16k(lane.chunks, lane.ctx.sampleRate);
      if (blob.size < 1500) return;
      const { partialModel } = this.resolveModels();
      const text = await transcribeAudio({
        apiKey: this.config.apiKey,
        apiBaseUrl: this.config.apiBaseUrl,
        whisperModel: partialModel,
        audio: blob,
        filename: `${speaker}-partial.wav`,
        prompt: this.promptForLane(lane),
        language: this.config.language,
        recentText: lane.committed,
        forceTechnical: this.config.forceTechnical,
        priority: "partial",
      });
      if (text) {
        const live = `${lane.committed} ${text}`.trim();
        this.handlers?.onPartial(speaker, live);
      }
    } catch (err) {
      // Skip quiet queue drops / rate limits on partials — don't spam the UI.
      const msg = (err as Error).message || "";
      if (
        msg !== "WHISPER_PARTIAL_SKIPPED" &&
        !msg.includes("(429)") &&
        !msg.includes("Rate limit")
      ) {
        // keep silent for partials
      }
    } finally {
      lane.partialInFlight = false;
    }
  }

  private async finalizeUtterance(speaker: Speaker, lane: Lane) {
    if (!this.config) return;
    lane.speaking = false;
    lane.silenceStartedAt = 0;
    lane.partialInFlight = true;
    const chunks = lane.chunks;
    lane.chunks = [];

    try {
      const blob = pcmToWav16k(chunks, lane.ctx.sampleRate);
      if (blob.size < 1500) {
        this.handlers?.onPartial(speaker, lane.committed);
        return;
      }
      const { finalModel } = this.resolveModels();
      const text = await transcribeAudio({
        apiKey: this.config.apiKey,
        apiBaseUrl: this.config.apiBaseUrl,
        whisperModel: finalModel,
        audio: blob,
        filename: `${speaker}-final.wav`,
        prompt: this.promptForLane(lane),
        language: this.config.language,
        recentText: lane.committed,
        forceTechnical: this.config.forceTechnical,
        priority: "final",
      });
      if (!text) return;
      lane.committed = `${lane.committed} ${text}`.trim();
      this.handlers?.onFinal(speaker, text);
      this.handlers?.onPartial(speaker, text);
      if (speaker === "client") {
        this.handlers?.onClientQuestion?.(text);
      }
    } catch (err) {
      const msg = (err as Error).message || "Live transcription failed";
      // Soft message for rate limits — auto-recovers via queue spacing.
      if (msg.includes("(429)") || msg.includes("Rate limit")) {
        this.handlers?.onStatus?.(
          "Whisper rate limit hit — waiting a few seconds, then continuing..."
        );
      } else {
        this.handlers?.onError?.(msg);
      }
    } finally {
      lane.partialInFlight = false;
    }
  }
}

import { encodeWav, mergeFloat32 } from "./wav";

type VadHandlers = {
  onSpeechStart?: () => void;
  onListening?: () => void;
  onQuestionReady: (blob: Blob, filename: string) => void | Promise<void>;
  onError: (message: string) => void;
};

/**
 * Continuous PCM capture with energy-based VAD.
 * On end-of-question silence, emits a valid WAV file for Groq Whisper.
 */
export class AutoQuestionListener {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sampleRate = 48000;
  private ring: Float32Array[] = [];
  private active = false;
  private speaking = false;
  private speechStartedAt = 0;
  private silenceStartedAt = 0;
  private processing = false;
  private handlers: VadHandlers | null = null;
  private preRoll: Float32Array[] = [];

  get isActive() {
    return this.active;
  }

  async start(handlers: VadHandlers) {
    await this.stop();
    this.handlers = handlers;
    this.processing = false;
    this.ring = [];
    this.preRoll = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      this.stream = stream;

      const audioCtx = new AudioContext();
      this.audioCtx = audioCtx;
      this.sampleRate = audioCtx.sampleRate;
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      const silent = audioCtx.createGain();
      silent.gain.value = 0;

      processor.onaudioprocess = (event) => {
        if (!this.active) return;
        const input = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input);
        this.handleFrame(copy);
      };

      source.connect(processor);
      processor.connect(silent);
      silent.connect(audioCtx.destination);

      this.source = source;
      this.processor = processor;
      this.active = true;
      handlers.onListening?.();
    } catch (err) {
      handlers.onError(
        `Mic start failed: ${(err as Error).message || "unknown error"}`
      );
      await this.stop();
    }
  }

  async stop() {
    this.active = false;
    this.speaking = false;
    this.processing = false;
    this.ring = [];
    this.preRoll = [];

    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        // ignore
      }
    }
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // ignore
      }
    }

    this.stream = null;
    this.audioCtx = null;
    this.processor = null;
    this.source = null;
    this.handlers = null;
  }

  private handleFrame(frame: Float32Array) {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const now = performance.now();
    const isLoud = rms > 0.015;

    // Keep a short pre-roll so question starts aren't clipped.
    this.preRoll.push(frame);
    const maxPre = Math.ceil((this.sampleRate * 0.6) / frame.length);
    if (this.preRoll.length > maxPre) this.preRoll.shift();

    if (isLoud) {
      if (!this.speaking) {
        this.speaking = true;
        this.speechStartedAt = now;
        this.ring = [...this.preRoll];
        this.handlers?.onSpeechStart?.();
      } else {
        this.ring.push(frame);
      }
      this.silenceStartedAt = 0;
      return;
    }

    if (!this.speaking) return;

    this.ring.push(frame);
    if (!this.silenceStartedAt) this.silenceStartedAt = now;

    const spokeLongEnough = now - this.speechStartedAt > 800;
    const silentLongEnough = now - this.silenceStartedAt > 1200;
    if (spokeLongEnough && silentLongEnough && !this.processing) {
      void this.emitQuestion();
    }
  }

  private async emitQuestion() {
    if (this.processing) return;
    this.processing = true;
    this.speaking = false;
    this.silenceStartedAt = 0;

    const samples = mergeFloat32(this.ring);
    this.ring = [];
    this.preRoll = [];

    try {
      // Require ~0.4s of audio
      if (samples.length >= this.sampleRate * 0.4) {
        const blob = encodeWav(samples, this.sampleRate);
        await this.handlers?.onQuestionReady(blob, "question.wav");
      }
    } catch (err) {
      this.handlers?.onError((err as Error).message || "Auto-answer failed");
    } finally {
      this.processing = false;
    }
  }
}

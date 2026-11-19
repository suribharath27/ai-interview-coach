import { mergeFloat32, pcmToWav16k } from "./wav";

/**
 * Records microphone audio as PCM and returns a valid WAV blob (Groq-friendly).
 */
export class MicRecorder {
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 48000;
  private active = false;

  get isListening() {
    return this.active;
  }

  async start(): Promise<void> {
    await this.cleanup();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but widely available in Electron; reliable for PCM.
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const silent = audioCtx.createGain();
    silent.gain.value = 0;

    this.chunks = [];
    this.sampleRate = audioCtx.sampleRate;
    processor.onaudioprocess = (event) => {
      if (!this.active) return;
      const input = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
    };

    source.connect(processor);
    processor.connect(silent);
    silent.connect(audioCtx.destination);

    this.mediaStream = stream;
    this.audioCtx = audioCtx;
    this.source = source;
    this.processor = processor;
    this.active = true;
  }

  async stop(): Promise<Blob | null> {
    if (!this.active) {
      await this.cleanup();
      return null;
    }

    this.active = false;
    const chunks = this.chunks;
    const rate = this.sampleRate;
    await this.cleanup();

    const samples = mergeFloat32(chunks);
    if (samples.length < rate * 0.25) return null; // <250ms
    return pcmToWav16k(chunks, rate);
  }

  cancel() {
    void this.cleanup();
  }

  private async cleanup() {
    this.active = false;
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
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // ignore
      }
    }
    this.mediaStream = null;
    this.audioCtx = null;
    this.processor = null;
    this.source = null;
    this.chunks = [];
  }
}

export function extensionForMime(mime: string): string {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

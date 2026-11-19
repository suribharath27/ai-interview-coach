/**
 * Groq free/on_demand Whisper is ~20 RPM.
 * Serialize + space requests so live partials don't starve Screenshot/Answer.
 */

export type WhisperPriority = "partial" | "final";

type Job<T> = {
  priority: WhisperPriority;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

const MIN_GAP_MS = 3500; // ~17 RPM, under the 20 RPM cap
let lastStartedAt = 0;
let running = false;
const queue: Array<Job<unknown>> = [];

export function whisperQueuePending() {
  return queue.length + (running ? 1 : 0);
}

export function enqueueWhisper<T>(
  priority: WhisperPriority,
  run: () => Promise<T>
): Promise<T> {
  // Drop stale partials if the queue is already busy — finals keep priority.
  if (priority === "partial" && (running || queue.length > 0)) {
    return Promise.reject(new Error("WHISPER_PARTIAL_SKIPPED"));
  }

  return new Promise<T>((resolve, reject) => {
    queue.push({
      priority,
      run: run as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    // Keep finals ahead of any leftover partials.
    queue.sort((a, b) => {
      if (a.priority === b.priority) return 0;
      return a.priority === "final" ? -1 : 1;
    });
    void pump();
  });
}

async function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;

  running = true;
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastStartedAt));
  if (wait > 0) await sleep(wait);

  lastStartedAt = Date.now();
  try {
    const value = await job.run();
    job.resolve(value);
  } catch (err) {
    job.reject(err);
  } finally {
    running = false;
    void pump();
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function parseRetryAfterMs(message: string): number {
  const match = message.match(/try again in\s+(\d+(?:\.\d+)?)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 250;
  return 4000;
}

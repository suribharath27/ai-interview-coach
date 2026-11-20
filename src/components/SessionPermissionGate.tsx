import { useCallback, useEffect, useState } from "react";
import {
  prepareSessionMedia,
  type MediaCheck,
  type SessionMediaReady,
} from "../services/mediaPermissions";

type Props = {
  onReadyChange?: (allOk: boolean) => void;
};

const idle: MediaCheck = {
  ok: false,
  status: "pending",
  message: "Not checked yet.",
};

export function SessionPermissionGate({ onReadyChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<SessionMediaReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<string>("");

  const runChecks = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await window.meetingCue?.getMediaAppInfo?.();
      if (info) {
        setAppInfo(
          `${info.packaged ? "Installed app" : "Dev"} · screen API=${info.screen} · ${info.execPath}`
        );
      }
      const next = await prepareSessionMedia();
      setResult(next);
      onReadyChange?.(next.allOk);
    } catch (err) {
      const message = (err as Error).message || "Permission check failed.";
      setError(message);
      setResult(null);
      onReadyChange?.(false);
    } finally {
      setBusy(false);
    }
  }, [onReadyChange]);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const resetPermissions = useCallback(async () => {
    if (!window.meetingCue?.resetMediaTcc) return;
    setResetting(true);
    setError(null);
    try {
      const res = await window.meetingCue.resetMediaTcc();
      setError(res.message);
      // Quit so the next launch gets a clean TCC prompt for THIS binary.
      window.setTimeout(() => {
        void window.meetingCue?.quitApp?.();
      }, 1200);
    } catch (err) {
      setError((err as Error).message || "Could not reset permissions.");
    } finally {
      setResetting(false);
    }
  }, []);

  const mic = result?.microphone ?? idle;
  const screen = result?.screen ?? idle;
  const system = result?.systemAudio ?? idle;
  const duplicateLikely =
    !screen.ok && /duplicate|screens=0|status=denied/i.test(screen.message);

  return (
    <div className="perm-gate">
      <p className="perm-gate-intro">
        Mic + Screen + System Audio Recording Only must be on for Meeting Cue.
        After enabling System Audio Recording Only, fully quit (Cmd+Q) and
        reopen once — then Recheck. Capture uses silent loopback (no share
        sheet) once those permissions stick.
      </p>

      {appInfo ? <p className="perm-app-info">{appInfo}</p> : null}

      <ul className="perm-list">
        <PermRow
          label="Microphone"
          check={mic}
          onFix={() => void window.meetingCue?.openMicSettings?.()}
        />
        <PermRow
          label="Screen Recording"
          check={screen}
          onFix={() => void window.meetingCue?.openScreenSettings?.()}
        />
        <PermRow
          label="System audio"
          check={system}
          onFix={() => void window.meetingCue?.openScreenSettings?.()}
        />
      </ul>

      {duplicateLikely ? (
        <p className="perm-error">
          Duplicate Meeting Cue rows detected. Turn the OFF row ON (or Reset
          &amp; quit), keep one Meeting Cue enabled, and enable System Audio
          Recording Only.
        </p>
      ) : null}

      {error ? <p className="perm-error">{error}</p> : null}
      {result?.allOk ? (
        <p className="perm-ok">All permissions look good — you can start.</p>
      ) : (
        <p className="perm-hint">
          If System Audio is red while Settings shows it ON: Cmd+Q, reopen
          Meeting Cue, play any sound, then Recheck.
        </p>
      )}

      <div className="perm-actions">
        <button
          type="button"
          className="btn light"
          disabled={busy || resetting}
          onClick={() => void runChecks()}
        >
          {busy ? "Checking…" : "Recheck permissions"}
        </button>
        <button
          type="button"
          className="btn light"
          disabled={busy || resetting}
          onClick={() => void resetPermissions()}
        >
          {resetting ? "Resetting…" : "Reset & quit"}
        </button>
      </div>
    </div>
  );
}

function PermRow({
  label,
  check,
  onFix,
}: {
  label: string;
  check: MediaCheck;
  onFix: () => void;
}) {
  const state = check.ok
    ? check.status === "silent"
      ? "warn"
      : "ok"
    : check.status === "pending"
      ? "pending"
      : "bad";

  return (
    <li className={`perm-row is-${state}`}>
      <div className="perm-row-main">
        <span className="perm-pip" aria-hidden />
        <div>
          <strong>{label}</strong>
          <p>{check.message}</p>
        </div>
      </div>
      {!check.ok && check.status !== "pending" ? (
        <button type="button" className="btn light small" onClick={onFix}>
          Open Settings
        </button>
      ) : null}
    </li>
  );
}

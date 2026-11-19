import { useRef, useState } from "react";
import { extractTextFromUpload } from "../services/pdfText";
import { DEFAULT_PRESET, PROVIDER_PRESETS } from "../services/providers";
import { saveSession } from "../services/sessionStore";
import {
  DEFAULT_ANSWER_PREFERENCES,
  DEFAULT_SESSION_DETAILS,
  DEFAULT_SESSION_PREFERENCES,
  type AnswerPreferences,
  type SessionDetails,
  type SessionPreferences,
  type SessionRecord,
} from "../types/session";
import { AnswerPreferencesModal } from "./AnswerPreferencesModal";

type Props = {
  onCreated: (session: SessionRecord) => void;
  onCancel: () => void;
};

type UploadField = "resumeText" | "documentsText";

export function CreateSession({ onCreated, onCancel }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [details, setDetails] = useState<SessionDetails>({
    ...DEFAULT_SESSION_DETAILS,
  });
  const [preferences, setPreferences] = useState<SessionPreferences>({
    ...DEFAULT_SESSION_PREFERENCES,
    model: DEFAULT_PRESET.model,
    answerPreferences: { ...DEFAULT_ANSWER_PREFERENCES },
  });
  const [showPrefs, setShowPrefs] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [docsFileName, setDocsFileName] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState<UploadField | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const docsInputRef = useRef<HTMLInputElement | null>(null);

  const onUpload = async (field: UploadField, file: File | null) => {
    if (!file) return;
    setUploadError(null);
    setUploadBusy(field);
    try {
      const text = await extractTextFromUpload(file);
      setDetails((d) => ({ ...d, [field]: text }));
      if (field === "resumeText") setResumeFileName(file.name);
      else setDocsFileName(file.name);
    } catch (err) {
      setUploadError((err as Error).message || "Could not read that file.");
    } finally {
      setUploadBusy(null);
    }
  };

  const create = () => {
    const now = Date.now();
    const chosen =
      PROVIDER_PRESETS.find((o) => o.model === preferences.model) ||
      DEFAULT_PRESET;
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "ready",
      details,
      preferences,
    };
    saveSession(session);
    // Keep speech stack in sync with the selected Whisper preset.
    void window.meetingCue?.setSettings?.({
      apiBaseUrl: chosen.apiBaseUrl,
      model: chosen.model,
      whisperModel: chosen.whisperModel,
      visionModel: chosen.visionModel,
    });
    onCreated(session);
  };

  return (
    <div className="wizard">
      <aside className="wizard-side">
        <h1>Create session</h1>
        <p>Enter the details & select what you need for this call.</p>
        <ol className="steps">
          <li className={step === 1 ? "active" : "done"}>
            <span>1</span>
            <div>
              <strong>Details</strong>
            </div>
          </li>
          <li className={step === 2 ? "active" : ""}>
            <span>2</span>
            <div>
              <strong>Preferences</strong>
            </div>
          </li>
        </ol>
      </aside>

      <section className="wizard-main">
        <button type="button" className="close-x" onClick={onCancel}>
          ×
        </button>

        {step === 1 ? (
          <div className="wizard-body">
            <h2>Session details</h2>
            <p className="sub">
              Add company/client context so answers stay grounded.
            </p>

            <label className="field">
              <span>Company / client name</span>
              <input
                value={details.companyName}
                onChange={(e) =>
                  setDetails((d) => ({ ...d, companyName: e.target.value }))
                }
                placeholder="Acme Corp"
              />
            </label>

            <label className="field">
              <span>Job / meeting description</span>
              <textarea
                rows={5}
                value={details.description}
                onChange={(e) =>
                  setDetails((d) => ({ ...d, description: e.target.value }))
                }
                placeholder="Paste the role, agenda, product notes, or meeting goals..."
              />
            </label>

            <div className="section-title">Context</div>
            {uploadError ? <p className="error">{uploadError}</p> : null}
            <label className="field">
              <span>CV / Resume</span>
              <div className="upload-row">
                <input
                  ref={resumeInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,application/pdf,text/plain"
                  className="file-input-hidden"
                  onChange={(e) => {
                    void onUpload("resumeText", e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="btn light small"
                  disabled={uploadBusy === "resumeText"}
                  onClick={() => resumeInputRef.current?.click()}
                >
                  {uploadBusy === "resumeText"
                    ? "Reading PDF…"
                    : "Upload PDF"}
                </button>
                {resumeFileName ? (
                  <span className="upload-file-name" title={resumeFileName}>
                    {resumeFileName}
                  </span>
                ) : (
                  <span className="upload-hint">PDF preferred · or paste below</span>
                )}
              </div>
              <textarea
                rows={5}
                value={details.resumeText}
                onChange={(e) => {
                  setResumeFileName(null);
                  setDetails((d) => ({ ...d, resumeText: e.target.value }));
                }}
                placeholder="Upload a PDF resume, or paste the text here…"
              />
            </label>
            <label className="field">
              <span>Documents / product notes</span>
              <div className="upload-row">
                <input
                  ref={docsInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,application/pdf,text/plain"
                  className="file-input-hidden"
                  onChange={(e) => {
                    void onUpload("documentsText", e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="btn light small"
                  disabled={uploadBusy === "documentsText"}
                  onClick={() => docsInputRef.current?.click()}
                >
                  {uploadBusy === "documentsText"
                    ? "Reading PDF…"
                    : "Upload PDF"}
                </button>
                {docsFileName ? (
                  <span className="upload-file-name" title={docsFileName}>
                    {docsFileName}
                  </span>
                ) : (
                  <span className="upload-hint">Optional PDF / text</span>
                )}
              </div>
              <textarea
                rows={4}
                value={details.documentsText}
                onChange={(e) => {
                  setDocsFileName(null);
                  setDetails((d) => ({ ...d, documentsText: e.target.value }));
                }}
                placeholder="Pricing, roadmap, FAQ, competitor notes…"
              />
            </label>

            <div className="wizard-footer">
              <button type="button" className="btn light" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn dark"
                onClick={() => setStep(2)}
                disabled={!details.companyName.trim()}
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div className="wizard-body">
            <h2>Preferences</h2>
            <p className="sub">Tune how Meeting Cue listens and answers.</p>

            <div className="settings-list">
              <div className="settings-row">
                <div>
                  <strong>Select language</strong>
                  <span>Call language</span>
                </div>
                <select
                  value={preferences.language}
                  onChange={(e) =>
                    setPreferences((p) => ({ ...p, language: e.target.value }))
                  }
                >
                  <option>English</option>
                  <option>Hindi</option>
                  <option>Spanish</option>
                  <option>French</option>
                </select>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Select model</strong>
                  <span>Speed and accuracy · speech uses Whisper</span>
                </div>
                <select
                  value={
                    PROVIDER_PRESETS.some((o) => o.model === preferences.model)
                      ? preferences.model
                      : DEFAULT_PRESET.model
                  }
                  onChange={(e) =>
                    setPreferences((p) => ({ ...p, model: e.target.value }))
                  }
                >
                  {PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.model}>
                      {preset.label.replace("Groq · ", "")} ({preset.model})
                    </option>
                  ))}
                </select>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Answer Preferences</strong>
                  <span>Answer style and format</span>
                </div>
                <button
                  type="button"
                  className="btn light small"
                  onClick={() => setShowPrefs(true)}
                >
                  Configure
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <strong>AI instructions</strong>
                  <span>Additional guidance</span>
                </div>
                <button
                  type="button"
                  className="btn light small"
                  onClick={() => setShowInstructions((v) => !v)}
                >
                  {preferences.aiInstructions ? "Edit" : "+ Add"}
                </button>
              </div>

              {showInstructions ? (
                <textarea
                  className="inline-instructions"
                  rows={4}
                  value={preferences.aiInstructions}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      aiInstructions: e.target.value,
                    }))
                  }
                  placeholder="e.g. Keep answers under 30 seconds. Mention our SOC2 status when security comes up."
                />
              ) : null}

              <div className="section-title">Extra</div>

              <div className="settings-row">
                <div>
                  <strong>Auto Answer</strong>
                  <span>Answers questions automatically when speech ends</span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={preferences.autoAnswer}
                    onChange={(e) =>
                      setPreferences((p) => ({
                        ...p,
                        autoAnswer: e.target.checked,
                      }))
                    }
                  />
                  <span />
                </label>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Save transcript</strong>
                  <span>Stored locally on this device</span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={preferences.saveTranscript}
                    onChange={(e) =>
                      setPreferences((p) => ({
                        ...p,
                        saveTranscript: e.target.checked,
                      }))
                    }
                  />
                  <span />
                </label>
              </div>
            </div>

            <div className="wizard-footer">
              <button
                type="button"
                className="btn light"
                onClick={() => setStep(1)}
              >
                Back
              </button>
              <button type="button" className="btn dark" onClick={create}>
                Create session
              </button>
            </div>
          </div>
        )}
      </section>

      {showPrefs ? (
        <AnswerPreferencesModal
          value={preferences.answerPreferences}
          onClose={() => setShowPrefs(false)}
          onSave={(answerPreferences) => {
            setPreferences((p) => ({ ...p, answerPreferences }));
            setShowPrefs(false);
          }}
        />
      ) : null}
    </div>
  );
}

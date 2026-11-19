import { useMemo, useState, type ReactNode } from "react";
import { previewAnswerForPreferences } from "../services/ai";
import type {
  AnswerFormat,
  AnswerLength,
  AnswerPreferences,
  AnswerTone,
  QuestionType,
} from "../types/session";

type Step = "menu" | "format" | "length" | "tone";

type Props = {
  value: AnswerPreferences;
  onSave: (prefs: AnswerPreferences) => void;
  onClose: () => void;
};

const QUESTION_TYPES: QuestionType[] = [
  "behavioral",
  "product",
  "business",
  "pricing",
  "roadmap",
  "objection",
  "technical",
];

export function AnswerPreferencesModal({ value, onSave, onClose }: Props) {
  const [prefs, setPrefs] = useState<AnswerPreferences>(value);
  const [step, setStep] = useState<Step>("menu");
  const [questionType, setQuestionType] = useState<QuestionType>("behavioral");

  const preview = useMemo(
    () => previewAnswerForPreferences(prefs, questionType),
    [prefs, questionType]
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" onClick={(e) => e.stopPropagation()}>
        {step === "menu" ? (
          <div className="prefs-grid">
            <div className="prefs-left">
              <h2>Answer preferences</h2>
              <p className="sub">
                Pick a preference to change how answers are shaped. You can
                change these anytime, including mid-call.
              </p>

              <button
                type="button"
                className="prefs-row"
                onClick={() => setStep("format")}
              >
                <div>
                  <strong>Format</strong>
                  <span>{formatLabel(prefs.format)}</span>
                </div>
                <span className="chev">›</span>
              </button>
              <button
                type="button"
                className="prefs-row"
                onClick={() => setStep("length")}
              >
                <div>
                  <strong>Length</strong>
                  <span>{lengthLabel(prefs.length)}</span>
                </div>
                <span className="chev">›</span>
              </button>
              <button
                type="button"
                className="prefs-row"
                onClick={() => setStep("tone")}
              >
                <div>
                  <strong>Tone</strong>
                  <span>{toneLabel(prefs.tone)}</span>
                </div>
                <span className="chev">›</span>
              </button>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn light"
                  onClick={() => onSave(prefs)}
                >
                  Set default
                </button>
                <button
                  type="button"
                  className="btn dark"
                  onClick={() => onSave(prefs)}
                >
                  Save
                </button>
              </div>
            </div>
            <PreviewPane
              questionType={questionType}
              onQuestionType={setQuestionType}
              preview={preview}
            />
          </div>
        ) : null}

        {step === "format" ? (
          <Chooser
            title="How should answers be presented?"
            subtitle="Choose the format that fits how you want to answer."
            options={[
              {
                id: "full-script" as AnswerFormat,
                label: "Full script",
                desc: "An answer you can read word for word.",
              },
              {
                id: "script-bullets" as AnswerFormat,
                label: "Script + bullets",
                desc: "Opening line, then supporting bullets.",
              },
              {
                id: "bullets" as AnswerFormat,
                label: "Bullet points",
                desc: "Short bullets you can say in your own words.",
              },
            ]}
            value={prefs.format}
            onChange={(format) => setPrefs((p) => ({ ...p, format }))}
            extras={
              <>
                <label className="toggle-line">
                  <span>Enable STAR Method</span>
                  <input
                    type="checkbox"
                    checked={prefs.starMethod}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, starMethod: e.target.checked }))
                    }
                  />
                </label>
                <label className="toggle-line muted-toggle">
                  <span>Use filler words</span>
                  <input type="checkbox" checked={false} disabled />
                </label>
              </>
            }
            onBack={() => setStep("menu")}
            onSelect={() => setStep("menu")}
            preview={
              <PreviewPane
                questionType={questionType}
                onQuestionType={setQuestionType}
                preview={preview}
              />
            }
          />
        ) : null}

        {step === "length" ? (
          <Chooser
            title="How long should answers be?"
            subtitle="Shorter answers appear faster during live calls."
            options={[
              {
                id: "short" as AnswerLength,
                label: "Short",
                desc: "Quick answer with only the essentials.",
              },
              {
                id: "balanced" as AnswerLength,
                label: "Balanced",
                desc: "Core answer with useful context.",
              },
              {
                id: "long" as AnswerLength,
                label: "Long",
                desc: "More explanation and supporting detail.",
              },
            ]}
            value={prefs.length}
            onChange={(length) => setPrefs((p) => ({ ...p, length }))}
            onBack={() => setStep("menu")}
            onSelect={() => setStep("menu")}
            preview={
              <PreviewPane
                questionType={questionType}
                onQuestionType={setQuestionType}
                preview={preview}
              />
            }
          />
        ) : null}

        {step === "tone" ? (
          <Chooser
            title="How should the answers sound?"
            subtitle="Choose the tone used when generating answers."
            options={[
              {
                id: "simple" as AnswerTone,
                label: "Simple",
                desc: "Plain words, no jargon.",
              },
              {
                id: "formal" as AnswerTone,
                label: "Formal",
                desc: "Precise, professional wording.",
              },
            ]}
            value={prefs.tone}
            onChange={(tone) => setPrefs((p) => ({ ...p, tone }))}
            onBack={() => setStep("menu")}
            onSelect={() => setStep("menu")}
            preview={
              <PreviewPane
                questionType={questionType}
                onQuestionType={setQuestionType}
                preview={preview}
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function PreviewPane({
  questionType,
  onQuestionType,
  preview,
}: {
  questionType: QuestionType;
  onQuestionType: (v: QuestionType) => void;
  preview: { question: string; answer: string };
}) {
  return (
    <aside className="prefs-right">
      <label className="field">
        <span>Question Type</span>
        <select
          value={questionType}
          onChange={(e) => onQuestionType(e.target.value as QuestionType)}
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <div className="preview-card">
        <div className="preview-label">Answer Preview</div>
        <strong>{preview.question}</strong>
        <pre>{preview.answer}</pre>
      </div>
    </aside>
  );
}

function Chooser<T extends string>({
  title,
  subtitle,
  options,
  value,
  onChange,
  onBack,
  onSelect,
  extras,
  preview,
}: {
  title: string;
  subtitle: string;
  options: Array<{ id: T; label: string; desc: string }>;
  value: T;
  onChange: (v: T) => void;
  onBack: () => void;
  onSelect: () => void;
  extras?: ReactNode;
  preview: ReactNode;
}) {
  return (
    <div className="prefs-grid">
      <div className="prefs-left">
        <h2>{title}</h2>
        <p className="sub">{subtitle}</p>
        <div className="choice-list">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`choice ${value === opt.id ? "active" : ""}`}
              onClick={() => onChange(opt.id)}
            >
              <span className="radio" />
              <span>
                <strong>{opt.label}</strong>
                <em>{opt.desc}</em>
              </span>
            </button>
          ))}
        </div>
        {extras}
        <div className="modal-actions">
          <button type="button" className="btn light" onClick={onBack}>
            Back
          </button>
          <button type="button" className="btn dark" onClick={onSelect}>
            Select
          </button>
        </div>
      </div>
      {preview}
    </div>
  );
}

function formatLabel(v: AnswerFormat) {
  if (v === "full-script") return "Full script";
  if (v === "bullets") return "Bullet points";
  return "Script + bullets";
}
function lengthLabel(v: AnswerLength) {
  return v[0].toUpperCase() + v.slice(1);
}
function toneLabel(v: AnswerTone) {
  return v[0].toUpperCase() + v.slice(1);
}

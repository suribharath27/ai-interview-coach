import { useMemo, useState } from "react";
import {
  loadAnswerHistory,
  loadTranscript,
  type AnswerTurn,
} from "../services/sessionStore";
import type { SessionRecord, TranscriptItem } from "../types/session";
import { AnswerContent } from "./AnswerContent";

type Props = {
  session: SessionRecord;
  onBack: () => void;
  onRestart: () => void;
  onCreateNew: () => void;
};

type Tab = "transcript" | "answers";

function roleLabel(role: TranscriptItem["role"]) {
  if (role === "me") return "You";
  if (role === "cue") return "Cue";
  if (role === "stakeholder") return "Stakeholder";
  return "Client";
}

function formatWhen(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionReview({
  session,
  onBack,
  onRestart,
  onCreateNew,
}: Props) {
  const [tab, setTab] = useState<Tab>("transcript");
  const transcript = useMemo(
    () => loadTranscript(session.id).slice().reverse(),
    [session.id]
  );
  const answers = useMemo(
    () => loadAnswerHistory(session.id).slice().reverse(),
    [session.id]
  );
  const [selectedAnswer, setSelectedAnswer] = useState<AnswerTurn | null>(
    () => answers[0] ?? null
  );

  return (
    <div className="session-review">
      <header className="row-between session-review-top">
        <div>
          <p className="eyebrow">
            {session.status === "ended" ? "Ended session" : "Session"}
          </p>
          <h1>{session.details.companyName || "Untitled session"}</h1>
          <p className="sub">
            {session.endedAt
              ? `Ended ${formatWhen(session.endedAt)}`
              : `Updated ${formatWhen(session.updatedAt)}`}
            {" · "}
            {transcript.length} transcript lines · {answers.length} answers
          </p>
        </div>
        <button type="button" className="btn light" onClick={onBack}>
          Back
        </button>
      </header>

      <div className="session-review-tabs">
        <button
          type="button"
          className={tab === "transcript" ? "active" : ""}
          onClick={() => setTab("transcript")}
        >
          Transcript
        </button>
        <button
          type="button"
          className={tab === "answers" ? "active" : ""}
          onClick={() => setTab("answers")}
        >
          Answers
        </button>
      </div>

      {tab === "transcript" ? (
        <section className="panel light session-review-panel">
          {transcript.length === 0 ? (
            <p className="empty">No transcript saved for this session.</p>
          ) : (
            <div className="transcript-feed session-review-feed">
              {transcript.map((line) => (
                <article
                  key={line.id}
                  className={`transcript-line ${line.role === "stakeholder" ? "client" : line.role}`}
                >
                  <div className="meta-row" style={{ margin: 0 }}>
                    <strong>{roleLabel(line.role)}</strong>
                    <span>{formatWhen(line.createdAt)}</span>
                  </div>
                  <p>{line.text}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="panel light session-review-panel session-review-answers">
          {answers.length === 0 ? (
            <p className="empty">No answers saved for this session.</p>
          ) : (
            <>
              <div className="session-review-answer-list">
                {answers.map((turn) => (
                  <button
                    key={turn.id}
                    type="button"
                    className={`history-item ${selectedAnswer?.id === turn.id ? "active" : ""}`}
                    onClick={() => setSelectedAnswer(turn)}
                  >
                    <strong>
                      {turn.question.slice(0, 80)}
                      {turn.question.length > 80 ? "…" : ""}
                    </strong>
                    <p>{formatWhen(turn.createdAt)}</p>
                  </button>
                ))}
              </div>
              <div className="session-review-answer-detail">
                {selectedAnswer ? (
                  <>
                    <p className="cue-q">{selectedAnswer.question}</p>
                    <AnswerContent text={selectedAnswer.answer} />
                  </>
                ) : (
                  <p className="empty">Select an answer.</p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <div className="home-actions session-review-actions">
        <button type="button" className="btn dark" onClick={onRestart}>
          Restart session
        </button>
        <button type="button" className="btn light" onClick={onCreateNew}>
          Create new session
        </button>
      </div>
    </div>
  );
}

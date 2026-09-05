import { useEffect, useRef, useState } from "react";
import { qualityPickAnimation } from "../../../shared/answerFeedback";
import { useQualityPickHold } from "../../../shared/useQualityPickHold";

const qualities = [[1, "Difficile"], [2, "Bien"], [3, "Facile"]];

function answerKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export default function EnumerationReview({
  q,
  submitAnswer,
  onComplete,
  trainingMode = false
}) {
  const [draft, setDraft] = useState("");
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { pendingQuality, hold } = useQualityPickHold();
  const input = useRef(null);

  useEffect(() => {
    setDraft("");
    setAnswers([]);
    setResult(null);
    setError("");
    input.current?.focus();
  }, [q.question_id]);

  function addAnswer() {
    const answer = draft.trim();
    const key = answerKey(answer);

    if (answer && !answers.some(value => answerKey(value) === key)) {
      setAnswers((current) => [...current, answer]);
      setDraft("");
    }
  }

  async function preview(event) {
    event?.preventDefault();
    if (busy) return;
    const nextAnswers = draft.trim() && !answers.some(value => answerKey(value) === answerKey(draft))
      ? [...answers, draft.trim()]
      : answers;
    setAnswers(nextAnswers);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const response = await submitAnswer({
        questionId: q.question_id,
        answers: nextAnswers,
        commit: false
      });
      setResult({ ...response, submittedAnswers: nextAnswers });
    } catch (requestError) {
      setError(requestError.message || "Vérification impossible");
    } finally {
      setBusy(false);
    }
  }

  async function commit(quality) {
    if (!result || busy) return;
    const submittedAnswers = result.submittedAnswers || answers;
    if (trainingMode) {
      onComplete?.(result.correct ? [] : [q.question_id]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await submitAnswer({
        questionId: q.question_id,
        answers: submittedAnswers,
        quality,
        commit: true
      });
      onComplete?.((saved.correct || saved.user_marked_close) ? [] : [q.question_id]);
    } catch (requestError) {
      setError(requestError.message || "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 14, margin: "0 auto", maxWidth: 700, padding: 24 }}>
      <div style={{ color: "#f3a8ef", fontSize: 12, fontWeight: 800 }}>ÉNUMÉRATION</div>
      <h2 style={{ margin: 0 }}>{q.question}</h2>
      <p style={{ color: "#aaa", margin: 0 }}>Donne au moins {q.enumeration?.required_count} réponses distinctes.</p>

      <form onSubmit={preview} style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {answers.map((answer) => (
            <button
              key={answer}
              type="button"
              onClick={() => setAnswers((current) => current.filter((value) => value !== answer))}
              style={{ background: "#4b2d4c", border: "1px solid #8b5a8f", borderRadius: "999px", color: "#f7d8fa", padding: "6px 10px" }}
            >
              {answer} ×
            </button>
          ))}
        </div>
        {!result && (
          <>
            <input
              ref={input}
              aria-label="Ajouter une réponse"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addAnswer();
                }
              }}
              style={{ background: "#111", border: "1px solid #7a4e80", borderRadius: "8px", color: "#fff", padding: "11px" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={addAnswer} disabled={busy} style={{ background: "#39203f", border: "1px solid #69406f", borderRadius: "8px", color: "#fff", padding: "9px" }}>Ajouter</button>
              <button type="submit" disabled={busy} style={{ background: "#7a3b83", border: 0, borderRadius: "8px", color: "#fff", fontWeight: 800, padding: "9px 13px" }}>Vérifier</button>
            </div>
          </>
        )}
      </form>

      {result && (
        <div style={{ display: "grid", gap: 9 }}>
          <strong style={{ color: result.correct ? "#9af0b2" : "#ff9e9e" }}>
            {result.correct ? "Quota atteint" : `Il manque ${result.missing_count || 1} réponse${(result.missing_count || 1) > 1 ? "s" : ""}`}
          </strong>
          {result.matched?.map(item => <div key={`${item.answer}:${item.expected}`} style={{ color: "#b9f6c9" }}>Reconnu : {item.answer} → {item.expected}</div>)}
          {result.duplicates?.map(answer => <div key={`duplicate:${answer}`} style={{ color: "#f7d78d" }}>Doublon : {answer}</div>)}
          {result.unmatched?.map(answer => <div key={`unmatched:${answer}`} style={{ color: "#f7d78d" }}>Non reconnu : {answer}</div>)}
          {result.correct && !trainingMode
            ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{qualities.map(([value, label]) => <button key={value} type="button" onClick={() => hold(value, commit)} disabled={busy || pendingQuality !== null} style={{ background: "#242424", border: "1px solid #555", borderRadius: "9px", color: "#fff", padding: "10px 14px", animation: pendingQuality === value ? qualityPickAnimation(value) : undefined }}>{label}</button>)}</div>
            : !result.correct && !trainingMode
              ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" onClick={() => hold(0, commit)} disabled={busy || pendingQuality !== null} style={{ background: "#442020", border: "1px solid #7f1d1d", borderRadius: "9px", color: "#fff", padding: "10px 14px", animation: pendingQuality === 0 ? qualityPickAnimation(0) : undefined }}>Again</button><button type="button" onClick={() => hold(1, commit)} disabled={busy || pendingQuality !== null} style={{ background: "#463418", border: "1px solid #92400e", borderRadius: "9px", color: "#fff", padding: "10px 14px", animation: pendingQuality === 1 ? qualityPickAnimation(1) : undefined }}>Close</button></div>
              : <button type="button" onClick={() => commit(0)} disabled={busy} style={{ background: "#242424", border: "1px solid #555", borderRadius: "9px", color: "#fff", padding: "10px 14px", width: "fit-content" }}>{trainingMode && result.correct ? "Suivant" : "Continuer"}</button>}
        </div>
      )}

      {error && <div style={{ color: "#ff9e9e" }}>{error}</div>}
    </section>
  );
}

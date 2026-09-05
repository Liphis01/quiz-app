import { useEffect, useRef, useState } from "react";
import { RichText } from "../../../shared/RichText";
import { qualityPickAnimation } from "../../../shared/answerFeedback";
import { useQualityPickHold } from "../../../shared/useQualityPickHold";

const qualities = [
  [1, "Difficile"],
  [2, "Bien"],
  [3, "Facile"]
];

export default function ClozeReview({ group, submitAnswer, onComplete, trainingMode = false }) {
  const item = group?.items?.[0];
  const inputRef = useRef(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { pendingQuality, hold } = useQualityPickHold();

  useEffect(() => { inputRef.current?.focus(); }, [item?.question_id]);

  async function preview(event) {
    event?.preventDefault();
    if (!item || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await submitAnswer({
        groupId: group.group_id,
        questionId: item.question_id,
        answer,
        commit: false
      });
      setResult(next);
    } catch (requestError) {
      setError(requestError.message || "Vérification impossible");
    } finally { setBusy(false); }
  }

  async function commit(quality) {
    if (!item || !result || busy) return;
    if (trainingMode) {
      onComplete?.(result.correct ? [] : [item.question_id]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await submitAnswer({
        groupId: group.group_id,
        questionId: item.question_id,
        answer,
        quality,
        commit: true
      });
      onComplete?.((saved.correct || saved.user_marked_close) ? [] : [item.question_id]);
    } catch (requestError) {
      setError(requestError.message || "Enregistrement impossible");
    } finally { setBusy(false); }
  }

  return (
    <section style={{ display: "grid", gap: "18px", margin: "0 auto", maxWidth: "760px", padding: "24px" }}>
      <div style={{ color: "#ef9cff", fontSize: "12px", fontWeight: 800, letterSpacing: ".08em" }}>TEXTE À TROUS</div>
      <h2 style={{ margin: 0 }}>{group?.name || "Note"}</h2>
      <div style={{ background: "#18131b", border: "1px solid #4b2850", borderRadius: "14px", fontSize: "18px", lineHeight: 1.7, padding: "22px" }}><RichText>{result?.source || group?.masked_source || group?.source}</RichText></div>
      {!result && <form onSubmit={preview} style={{ display: "flex", gap: "10px" }}><input ref={inputRef} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Ta réponse" style={{ background: "#111", border: "1px solid #555", borderRadius: "10px", color: "#fff", flex: 1, fontSize: "17px", padding: "12px" }} /><button type="submit" disabled={busy} style={{ background: "#6e2875", border: 0, borderRadius: "10px", color: "#fff", cursor: "pointer", fontWeight: 800, padding: "12px 16px" }}>Vérifier</button></form>}
      {result && <div style={{ display: "grid", gap: "12px" }}><div style={{ color: result.correct ? "#9af0b2" : "#ff9e9e", fontWeight: 800 }}>{result.correct ? "Bonne réponse" : `Réponse attendue : ${result.expected}`}</div>{result.correct && !trainingMode ? <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>{qualities.map(([quality, label]) => <button key={quality} type="button" onClick={() => hold(quality, commit)} disabled={busy || pendingQuality !== null} style={{ background: "#242424", border: "1px solid #555", borderRadius: "9px", color: "#fff", cursor: "pointer", padding: "10px 14px", animation: pendingQuality === quality ? qualityPickAnimation(quality) : undefined }}>{label}</button>)}</div> : !result.correct && !trainingMode ? <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}><button type="button" onClick={() => hold(0, commit)} disabled={busy || pendingQuality !== null} style={{ background: "#442020", border: "1px solid #7f1d1d", borderRadius: "9px", color: "#fff", cursor: "pointer", padding: "10px 14px", animation: pendingQuality === 0 ? qualityPickAnimation(0) : undefined }}>Again</button><button type="button" onClick={() => hold(1, commit)} disabled={busy || pendingQuality !== null} style={{ background: "#463418", border: "1px solid #92400e", borderRadius: "9px", color: "#fff", cursor: "pointer", padding: "10px 14px", animation: pendingQuality === 1 ? qualityPickAnimation(1) : undefined }}>Close</button></div> : <button type="button" onClick={() => commit(0)} disabled={busy} style={{ background: "#242424", border: "1px solid #555", borderRadius: "9px", color: "#fff", cursor: "pointer", padding: "10px 14px", width: "fit-content" }}>{trainingMode && result.correct ? "Suivant" : "Continuer"}</button>}</div>}
      {error && <div style={{ color: "#ff9e9e" }}>{error}</div>}
    </section>
  );
}

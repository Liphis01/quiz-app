import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeSequenceMode,
  SEQUENCE_MODE_GAP_FILL,
  SEQUENCE_MODE_MULTIPLE_CHOICE,
  SEQUENCE_MODE_RECITE,
  SEQUENCE_MODE_REORDER,
  SEQUENCE_MODE_TYPE_POSITION
} from "../sequenceModes";
import SequenceRail from "./SequenceRail";
import { isAnswerable, qualityColors } from "../sequenceRail";
import { matchesAnswerValue } from "../answerPolicy";
import { buildChoiceOptions } from "../distractorSelection";
import { eventDigit } from "../keyboardShortcuts";
import { qualityPickAnimation } from "../../../shared/answerFeedback";
import { useQualityPickFlash } from "../../../shared/useQualityPickHold";

const CHOICE_COUNT = 4;

const qualityLabels = {
  0: "Raté",
  1: "Presque",
  2: "Exact !",
  3: "Exact !"
};

const qualityRatingOptions = [
  { value: 1, label: "Dur" },
  { value: 2, label: "Bon" },
  { value: 3, label: "Facile" }
];

const inputStyle = {
  background: "#101010",
  border: "1px solid #2d2d2d",
  borderRadius: "8px",
  boxSizing: "border-box",
  color: "#eee",
  fontSize: "14px",
  outline: "none",
  padding: "9px 11px",
  width: "100%"
};

const buttonStyle = {
  background: "#232323",
  border: "1px solid #333",
  borderRadius: "8px",
  color: "#eee",
  cursor: "pointer",
  fontWeight: 700,
  padding: "10px 16px"
};

function matchCandidate(candidates, guess) {
  return (
    candidates.find(candidate => matchesAnswerValue(candidate, guess)) || null
  );
}

function shuffled(list) {
  const copy = [...list];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }

  return copy;
}

// Distractors are drawn from the ranks nearest the answer: a QCM whose options
// are scattered across the list is answerable on theme alone.
function buildChoices(item, contextItems) {
  const peers = contextItems.filter(
    candidate => candidate.question_id !== item.question_id
  );
  const byDistance = [...peers].sort(
    (left, right) =>
      Math.abs(left.position - item.position) -
      Math.abs(right.position - item.position)
  );
  const near = byDistance.slice(0, Math.max(0, (CHOICE_COUNT - 1) * 2));

  return buildChoiceOptions(
    item,
    [item, ...near],
    new Map(),
    null,
    { sequence: true }
  );
}

export default function SequenceReview({
  group,
  reviewItems,
  contextItems = reviewItems,
  mode: requestedMode,
  onAnsweringComplete,
  onComplete,
  submitAnswer,
  showQualityControls = true,
  fillAvailableHeight = false
}) {
  const mode = normalizeSequenceMode(requestedMode);
  const items = useMemo(
    () => [...(reviewItems || [])].sort((a, b) => a.position - b.position),
    [reviewItems]
  );
  const pool = useMemo(
    () => (contextItems && contextItems.length ? contextItems : items),
    [contextItems, items]
  );
  const rail = useMemo(() => group?.rail || [], [group]);
  const railBlanks = useMemo(
    () => rail.filter(slot => slot.kind === "blank"),
    [rail]
  );

  const [phase, setPhase] = useState("answer");
  const [inputs, setInputs] = useState({});
  const [placements, setPlacements] = useState({});
  const [heldId, setHeldId] = useState(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [reciteIndex, setReciteIndex] = useState(0);
  const [reciteRun, setReciteRun] = useState([]);
  const [results, setResults] = useState(null);
  const [qualities, setQualities] = useState({});
  const { flashQuality, isFlashing } = useQualityPickFlash();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const revealed = phase === "review";
  const isTypePosition = mode === SEQUENCE_MODE_TYPE_POSITION;
  const isGapFill = mode === SEQUENCE_MODE_GAP_FILL;
  const isChoice = mode === SEQUENCE_MODE_MULTIPLE_CHOICE;
  const isReorder = mode === SEQUENCE_MODE_REORDER;
  const isRecite = mode === SEQUENCE_MODE_RECITE;

  const failedRef = useRef([]);
  const attemptRef = useRef(null);

  const choicesByItem = useMemo(() => {
    if (!isChoice) return {};

    return items.reduce((acc, item) => {
      acc[item.question_id] = buildChoices(item, pool);

      return acc;
    }, {});
  }, [isChoice, items, pool]);

  const itemsById = useMemo(
    () =>
      items.reduce((acc, item) => {
        acc[item.question_id] = item;

        return acc;
      }, {}),
    [items]
  );

  const labelByQuestionId = useMemo(() => {
    const map = {};

    [...pool, ...items].forEach(entry => {
      map[entry.question_id] = entry.label || entry.answer;
    });
    rail.forEach(slot => {
      if (slot.label) map[slot.question_id] = slot.label;
    });

    return map;
  }, [items, pool, rail]);

  // reorder places due items into free slots; the tray holds exactly those
  // items, which is why decoys are never drawn for this mode -- a slot with no
  // tile to fill it would be a decoy at a glance.
  const tray = useMemo(() => (isReorder ? shuffled(items) : []), [isReorder, items]);
  const placedByPosition = useMemo(() => {
    const map = new Map();

    Object.entries(placements).forEach(([questionId, position]) => {
      map.set(position, Number(questionId));
    });

    return map;
  }, [placements]);

  const recitation = group?.recitation || null;
  const runStart = recitation?.run_start ?? 0;
  const reciteTargets = useMemo(
    () => recitation?.targets || [],
    [recitation]
  );
  const targetIds = useMemo(
    () => reciteTargets.map(target => target.question_id),
    [reciteTargets]
  );
  const scheduledIds = useMemo(
    () => recitation?.scheduled_ids || items.map(item => item.question_id),
    [items, recitation]
  );

  const activeChoiceItem = isChoice ? items[choiceIndex] : null;

  const answeredCount = isChoice
    ? Object.keys(inputs).length
    : isReorder
      ? Object.keys(placements).length
      : isRecite
        ? reciteRun.length
        : Object.values(inputs).filter(value => String(value || "").trim()).length;

  const canSubmit = isChoice
    ? Object.keys(inputs).length >= items.length
    : isReorder
      ? Object.keys(placements).length >= items.length
      : true;

  const place = useCallback((questionId, position) => {
    if (!questionId) return;

    setPlacements(prev => {
      const next = {};

      // A slot holds one item and an item sits in one slot, so placing evicts
      // whatever was in either.
      Object.entries(prev).forEach(([id, slot]) => {
        if (Number(id) !== questionId && slot !== position) {
          next[id] = slot;
        }
      });

      next[questionId] = position;

      return next;
    });
    setHeldId(null);
  }, []);

  const unplace = useCallback(questionId => {
    setPlacements(prev => {
      const next = { ...prev };
      delete next[questionId];

      return next;
    });
  }, []);

  const buildPayload = useCallback(
    (currentInputs, currentRun, commit, stopReason = undefined) => {
      const base = {
        rail: rail.map(slot => ({
          question_id: slot.question_id,
          position: slot.position,
          kind: slot.kind
        })),
        groupId: group?.group_id,
        commit
      };

      if (isRecite) {
        return {
          ...base,
          run: currentRun,
          runStart,
          targetIds,
          scheduledIds,
          stopReason,
          candidates: Object.fromEntries(
            targetIds.map(questionId => [questionId, targetIds])
          )
        };
      }

      const payloadItems = {};
      const railCandidateIds = rail
        .map(slot => slot.question_id)
        .filter(id => id != null);
      const poolCandidateIds = pool
        .map(item => item.question_id)
        .filter(id => id != null);
      const candidates = {};

      if (isReorder) {
        items.forEach(item => {
          payloadItems[item.question_id] = {
            position: placements[item.question_id] ?? null,
            ...(qualities[item.question_id]
              ? { quality: qualities[item.question_id] }
              : {})
          };
          candidates[item.question_id] = railCandidateIds;
        });
      } else if (isChoice) {
        items.forEach(item => {
          payloadItems[item.question_id] = {
            position: currentInputs[item.question_id] ?? null,
            text: pool.find(candidate => (
              candidate.position === currentInputs[item.question_id]
            ))?.answer || "",
            ...(qualities[item.question_id]
              ? { quality: qualities[item.question_id] }
              : {})
          };
          candidates[item.question_id] = (choicesByItem[item.question_id] || [])
            .map(option => option.question_id)
            .filter(id => id != null);
        });
      } else if (isGapFill) {
        // Only real blanks are posted. Decoys are answered so the blanks
        // cannot be found by subtraction, but grading them would schedule
        // cards the session never intended to review.
        railBlanks.forEach(slot => {
          const match = matchCandidate(pool, currentInputs[slot.position]);

          payloadItems[slot.question_id] = {
            position: match ? match.position : null,
            text: currentInputs[slot.position] || "",
            ...(qualities[slot.question_id]
              ? { quality: qualities[slot.question_id] }
              : {})
          };
          candidates[slot.question_id] = railCandidateIds;
        });
      } else {
        items.forEach(item => {
          const match = matchCandidate(pool, currentInputs[item.question_id]);

          payloadItems[item.question_id] = {
            position: match ? match.position : null,
            text: currentInputs[item.question_id] || "",
            ...(qualities[item.question_id]
              ? { quality: qualities[item.question_id] }
              : {})
          };
          candidates[item.question_id] = poolCandidateIds;
        });
      }

      return { ...base, items: payloadItems, candidates };
    },
    [
      choicesByItem,
      group,
      isChoice,
      isGapFill,
      isRecite,
      isReorder,
      items,
      placements,
      pool,
      qualities,
      rail,
      railBlanks,
      runStart,
      scheduledIds,
      targetIds
    ]
  );

  const commitPayload = useCallback(() => {
    const attempt = attemptRef.current;

    if (!attempt) return null;

    if (isRecite) {
      return { ...attempt, commit: true, qualities };
    }

    return {
      ...attempt,
      commit: true,
      items: Object.fromEntries(
        Object.entries(attempt.items || {}).map(([questionId, answer]) => [
          questionId,
          {
            ...answer,
            ...(qualities[questionId] ? { quality: qualities[questionId] } : {})
          }
        ])
      )
    };
  }, [isRecite, qualities]);

  // Grade first, schedule second. The server is the only grader -- reproducing
  // relative-order grading over a windowed rail in JS would be a second
  // implementation free to drift from the Python one.
  const grade = useCallback(
    async (
      currentInputs = inputs,
      currentRun = reciteRun,
      stopReason = undefined
    ) => {
      if (submitting || revealed) return;

      setSubmitting(true);
      setError(null);

      try {
        const attempt = buildPayload(
          currentInputs,
          currentRun,
          false,
          stopReason
        );
        attemptRef.current = attempt;
        const response = await submitAnswer?.(
          attempt,
          mode,
          rail.length
        );
        const graded = (response?.results || []).reduce((acc, result) => {
          acc[result.question_id] = result;

          return acc;
        }, {});

        failedRef.current = Object.values(graded)
          .filter(result => (
            result.scheduled !== false && (
              result.quality === 0 || result.status === "unattempted"
            )
          ))
          .map(result => result.question_id);

        setResults(graded);
        setPhase("review");
        onAnsweringComplete?.(failedRef.current);
      } catch (caught) {
        console.error(caught);
        setError("La correction n'a pas pu être envoyée.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      buildPayload,
      inputs,
      mode,
      onAnsweringComplete,
      rail.length,
      reciteRun,
      revealed,
      submitAnswer,
      submitting
    ]
  );

  const finish = useCallback(async () => {
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const payload = commitPayload();

      if (!payload) throw new Error("Missing graded sequence attempt");

      await submitAnswer?.(payload, mode, rail.length);
      onComplete?.(failedRef.current);
    } catch (caught) {
      // Stay on the recap rather than reporting a clean sweep: the previous
      // behaviour swallowed the error and marked the whole chunk complete with
      // zero failures, silently losing the session's answers.
      console.error(caught);
      setError("L'enregistrement a échoué. Réessaie.");
    } finally {
      setSubmitting(false);
    }
  }, [
    commitPayload,
    mode,
    onComplete,
    rail.length,
    submitAnswer,
    submitting
  ]);

  const pickChoice = useCallback(
    (item, choice) => {
      const nextInputs = { ...inputs, [item.question_id]: choice.position };

      setInputs(nextInputs);
      setChoiceIndex(prev => prev + 1);

      if (choiceIndex + 1 >= items.length) {
        grade(nextInputs);
      }
    },
    [choiceIndex, grade, inputs, items.length]
  );

  const submitRecitedItem = useCallback(
    value => {
      const match = matchCandidate(pool, value);
      const expectedId = reciteTargets[reciteIndex]?.question_id;
      const nextRun = [
        ...reciteRun,
        { text: value, question_id: match?.question_id ?? null }
      ];
      const wrong = !match || match.question_id !== expectedId;
      const completed = reciteIndex + 1 >= reciteTargets.length;

      setReciteRun(nextRun);
      setReciteIndex(prev => prev + 1);
      setInputs(prev => ({ ...prev, recite: "" }));

      // A wrong item IS the stall -- the run ends there by definition, so
      // there is nothing to gain by asking for more.
      if (wrong || completed) {
        grade(inputs, nextRun, wrong ? "wrong_answer" : "completed");
      }
    },
    [grade, inputs, pool, reciteIndex, reciteRun, reciteTargets]
  );

  useEffect(() => {
    if (!isChoice || revealed || !activeChoiceItem) return undefined;

    function onKeyDown(event) {
      const digit = eventDigit(event, { min: 1, max: 9 });
      const index = digit === null ? -1 : digit - 1;
      const choices = choicesByItem[activeChoiceItem.question_id] || [];

      if (index >= 0 && index < choices.length) {
        event.preventDefault();
        pickChoice(activeChoiceItem, choices[index]);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeChoiceItem, choicesByItem, isChoice, pickChoice, revealed]);

  const containerStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    ...(fillAvailableHeight ? { flex: 1, minHeight: 0 } : {})
  };

  function resultFor(questionId) {
    return results?.[questionId] || null;
  }

  function renderFeedback(questionId) {
    const result = resultFor(questionId);

    if (!result) return null;

    if (result.status === "unattempted") {
      return (
        <span data-sequence-feedback="unattempted" style={{ color: "#888", fontSize: "13px" }}>
          Non présenté · à revoir
        </span>
      );
    }

    const gap =
      result.quality >= 2 || result.distance === null || result.distance === undefined
        ? ""
        : ` · ${result.distance} rang${result.distance > 1 ? "s" : ""} d'écart`;

    return (
      <span
        data-sequence-feedback={
          result.quality === 0 ? "wrong" : result.quality === 1 ? "close" : "correct"
        }
        style={{ color: qualityColors[result.quality], fontSize: "13px" }}
      >
        {qualityLabels[result.quality]} · n° {result.expected_position}
        {gap}
        {result.stall ? " · bloqué ici" : ""}
      </span>
    );
  }

  // Only a hit is adjustable, and only when something is actually scheduled --
  // the same rule timeline uses. A miss stays Again.
  function renderQualityBar(questionId) {
    const result = resultFor(questionId);

    if (
      !showQualityControls ||
      !result ||
      result.scheduled === false ||
      result.quality === null ||
      result.quality === 0
    ) return null;

    const selected = qualities[questionId] ?? result.quality;

    return (
      <span data-sequence-quality-bar="" style={{ display: "flex", gap: "4px" }}>
        {qualityRatingOptions.map(option => (
          <button
            key={option.value}
            data-sequence-quality={option.value}
            data-active={selected === option.value ? "" : undefined}
            onClick={() => {
              setQualities(prev => ({ ...prev, [questionId]: option.value }));
              flashQuality(questionId, option.value);
            }}
            style={{
              ...buttonStyle,
              background: selected === option.value ? "#2f3a2f" : "#1b1b1b",
              borderColor: selected === option.value ? "#4a7a52" : "#2d2d2d",
              fontSize: "12px",
              fontWeight: 500,
              padding: "4px 9px",
              animation: isFlashing(questionId, option.value)
                ? qualityPickAnimation(option.value)
                : undefined
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </span>
    );
  }

  function renderRailSlot(slot) {
    const answerable = isAnswerable(slot);
    const isDecoy = slot.kind === "decoy";

    if (isReorder) {
      const placedId = placedByPosition.get(slot.position);
      const placedItem = placedId ? itemsById[placedId] : null;

      return (
        <>
          {slot.kind === "anchor" && (
            <span style={{ color: "#777" }}>{slot.label}</span>
          )}
          {slot.kind === "hidden" && <span style={{ color: "#444" }}>•</span>}
          {answerable && (
            <span style={{ color: "#eee" }}>
              {placedItem ? placedItem.label : ""}
            </span>
          )}
          {revealed && placedItem && (
            <span style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
              {renderFeedback(placedItem.question_id)}
              {renderQualityBar(placedItem.question_id)}
            </span>
          )}
        </>
      );
    }

    if (!answerable) {
      return slot.kind === "anchor" ? (
        <span style={{ color: "#777" }}>{slot.label}</span>
      ) : (
        <span style={{ color: "#444" }}>•</span>
      );
    }

    if (revealed) {
      return (
        <>
          <span style={{ color: isDecoy ? "#777" : "#eee" }}>
            {labelByQuestionId[slot.question_id]}
          </span>
          {isDecoy ? (
            <span
              data-sequence-decoy=""
              style={{ color: "#666", fontSize: "12px", marginLeft: "auto" }}
            >
              hors barème
            </span>
          ) : (
            <span style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
              {renderFeedback(slot.question_id)}
              {renderQualityBar(slot.question_id)}
            </span>
          )}
        </>
      );
    }

    return (
      <input
        aria-label={`Élément au rang ${slot.position}`}
        onChange={event =>
          setInputs(prev => ({ ...prev, [slot.position]: event.target.value }))
        }
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            grade();
          }
        }}
        style={inputStyle}
        value={inputs[slot.position] || ""}
      />
    );
  }

  const showRail = isGapFill || isReorder;

  return (
    <div style={containerStyle} data-sequence-review={mode}>
      <div style={{ color: "#888", fontSize: "13px" }}>
        {!fillAvailableHeight && group?.name && `${group.name} · `}
        {answeredCount}/{isRecite ? reciteTargets.length : items.length}
      </div>

      {error && (
        <div data-sequence-error="" style={{ color: "#ff8c94", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {isRecite && !revealed && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {recitation?.cue?.label && (
            <div data-sequence-recite-cue="" style={{ color: "#888", fontSize: "14px" }}>
              Après {recitation.cue.label}
            </div>
          )}
          <div style={{ color: "#eee", fontSize: "16px", fontWeight: 700 }}>
            {reciteIndex < reciteTargets.length
              ? `Continue la liste — élément n° ${
                  reciteTargets[reciteIndex]?.position
                }`
              : "Liste terminée"}
          </div>

          {reciteIndex < reciteTargets.length && (
            <input
              aria-label="Élément suivant"
              autoFocus
              onChange={event =>
                setInputs(prev => ({ ...prev, recite: event.target.value }))
              }
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitRecitedItem(inputs.recite);
                }
              }}
              style={inputStyle}
              value={inputs.recite || ""}
            />
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              data-sequence-stall=""
              onClick={() => grade(inputs, reciteRun, "declared_stall")}
              style={{ ...buttonStyle, fontWeight: 500 }}
              type="button"
            >
              Je bloque
            </button>
          </div>

          {reciteRun.length > 0 && (
            <div style={{ color: "#888", fontSize: "13px" }}>
              {reciteRun
                .map(item => labelByQuestionId[item.question_id] || item.text || "?")
                .join(" · ")}
            </div>
          )}
        </div>
      )}

      {showRail && (
        <div
          style={
            isReorder
              ? {
                  display: "grid",
                  gap: "16px",
                  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
                  minHeight: 0
                }
              : { display: "flex", flexDirection: "column", minHeight: 0 }
          }
        >
          <SequenceRail
            slots={rail}
            revealed={revealed}
            renderSlot={renderRailSlot}
            onSlotClick={
              isReorder
                ? slot => {
                    if (!isAnswerable(slot) || revealed) return;

                    const placedId = placedByPosition.get(slot.position);

                    if (heldId) {
                      place(heldId, slot.position);
                    } else if (placedId) {
                      unplace(placedId);
                    }
                  }
                : undefined
            }
            onSlotDrop={
              isReorder ? (slot, questionId) => place(questionId, slot.position) : undefined
            }
            slotBorder={slot => {
              if (!isAnswerable(slot)) return "1px solid #1e1e1e";

              const placedId = placedByPosition.get(slot.position);
              const result = isReorder
                ? placedId && resultFor(placedId)
                : resultFor(slot.question_id);

              return `1px ${
                isReorder && !placedId ? "dashed" : "solid"
              } ${result ? qualityColors[result.quality] : "#3a3a3a"}`;
            }}
          />

          {isReorder && (
            <div
              className="app-scrollbar"
              data-sequence-tray=""
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                overflowY: "auto"
              }}
            >
              {tray
                .filter(item => placements[item.question_id] === undefined)
                .map(item => (
                  <button
                    key={item.question_id}
                    data-sequence-tray-item={item.question_id}
                    disabled={revealed}
                    draggable={!revealed}
                    onClick={() =>
                      setHeldId(prev =>
                        prev === item.question_id ? null : item.question_id
                      )
                    }
                    onDragStart={event => {
                      event.dataTransfer.setData(
                        "text/plain",
                        String(item.question_id)
                      );
                    }}
                    style={{
                      ...buttonStyle,
                      background:
                        heldId === item.question_id ? "#2f3a2f" : buttonStyle.background,
                      borderColor: heldId === item.question_id ? "#4a7a52" : "#333",
                      fontWeight: 500,
                      textAlign: "left"
                    }}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {isTypePosition && (
        <div
          className="app-scrollbar"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            overflowY: "auto"
          }}
        >
          {items.map(item => (
            <div
              key={item.question_id}
              data-sequence-row={item.position}
              style={{
                alignItems: "center",
                display: "grid",
                gap: "10px",
                gridTemplateColumns: "minmax(120px, 200px) 1fr auto"
              }}
            >
              <span style={{ color: "#aaa", fontSize: "14px" }}>
                n° {item.position}
              </span>

              <input
                aria-label={`Élément au rang ${item.position}`}
                disabled={revealed}
                onChange={event =>
                  setInputs(prev => ({
                    ...prev,
                    [item.question_id]: event.target.value
                  }))
                }
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    grade();
                  }
                }}
                style={inputStyle}
                value={inputs[item.question_id] || ""}
              />

              {revealed ? (
                <span style={{ display: "flex", gap: "8px" }}>
                  {renderFeedback(item.question_id)}
                  {renderQualityBar(item.question_id)}
                </span>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}

      {isChoice && !revealed && activeChoiceItem && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ color: "#eee", fontSize: "16px", fontWeight: 700 }}>
            Quel élément occupe le rang {activeChoiceItem.position} ?
          </div>

          <div
            style={{
              display: "grid",
              gap: "8px",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))"
            }}
          >
            {(choicesByItem[activeChoiceItem.question_id] || []).map(
              (choice, index) => (
                <button
                  key={choice.question_id}
                  data-sequence-choice={choice.position}
                  onClick={() => pickChoice(activeChoiceItem, choice)}
                  style={{ ...buttonStyle, textAlign: "left" }}
                  type="button"
                >
                  <span style={{ color: "#666", marginRight: "8px" }}>
                    {index + 1}
                  </span>
                  {choice.label}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {(isChoice || isRecite) && revealed && (
        <div
          className="app-scrollbar"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            overflowY: "auto"
          }}
        >
          {Object.values(results || {}).map(result => (
            <div
              key={result.question_id}
              data-sequence-row={result.expected_position}
              style={{
                alignItems: "center",
                display: "flex",
                gap: "10px",
                justifyContent: "space-between"
              }}
            >
              <span style={{ color: "#eee" }}>{result.label}</span>
              <span style={{ display: "flex", gap: "8px" }}>
                {renderFeedback(result.question_id)}
                {renderQualityBar(result.question_id)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
        {revealed ? (
          <button
            disabled={submitting}
            onClick={finish}
            style={{ ...buttonStyle, opacity: submitting ? 0.5 : 1 }}
            type="button"
          >
            Continuer ↵
          </button>
        ) : (
          !isChoice &&
          !isRecite && (
            <button
              disabled={!canSubmit || submitting}
              onClick={() => grade()}
              style={{
                ...buttonStyle,
                opacity: canSubmit && !submitting ? 1 : 0.5
              }}
              type="button"
            >
              Valider ↵
            </button>
          )
        )}
      </div>
    </div>
  );
}

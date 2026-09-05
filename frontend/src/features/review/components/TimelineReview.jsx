import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendTimelineAnswer } from "../../../api/review";
import { fadeInStyle } from "../../../shared/styles";
import { qualityPickAnimation } from "../../../shared/answerFeedback";
import { useQualityPickFlash } from "../../../shared/useQualityPickHold";
import { buildSessionAnchors, describeValue } from "../../timeline/anchors";
import {
  buildAnswerSlice,
  buildDisplayRange,
  clampSlice,
  sliceToOrdinalRange,
  yearBoundsFromRange,
  zoomSliceAt
} from "../../timeline/railGeometry";
import {
  centerOrdinal,
  clampNumber,
  daysInMonth,
  formatTimelineDate,
  formatTypedDate,
  lowerOrdinal,
  parseTimelineInput,
  yearToTimelineIndex
} from "../../timeline/timelineUtils";
import TimelineCascade from "./TimelineCascade";
import TimelineGlobalTrack from "./TimelineGlobalTrack";
import useTimelineReview from "../hooks/useTimelineReview";
import { GOT_IT_QUALITY, STILL_LEARNING_QUALITY } from "../relearningGrades";
import { eventDigit } from "../keyboardShortcuts";

const emptyAnchors = [];

// The correction bar's slot is held open for the whole question. If it only took
// up space once a date was graded, the rails below it would shift by exactly
// that much mid-question and the whole cascade would jump under the pointer.
const feedbackSlotHeight = "clamp(44px, 6.6vh, 60px)";

const typeBadgeStyle = {
  alignItems: "center",
  background: "rgba(196, 181, 253, 0.15)",
  border: "1px solid rgba(196, 181, 253, 0.3)",
  borderRadius: "999px",
  color: "#c4b5fd",
  display: "flex",
  fontSize: "12px",
  fontWeight: 700,
  gap: "6px",
  padding: "5px 10px",
  width: "fit-content"
};

const buttonStyle = {
  background: "#232323",
  border: "1px solid #333",
  borderRadius: "10px",
  color: "#eee",
  cursor: "pointer",
  fontWeight: 700,
  padding: "11px 16px",
  transition: "all 0.15s ease"
};

const primaryButtonStyle = {
  ...buttonStyle,
  background: "#2b2047",
  border: "1px solid rgba(196, 181, 253, 0.45)",
  color: "#d9ccff"
};

const successButtonStyle = {
  ...buttonStyle,
  background: "#1d3a29",
  border: "1px solid #2c5c3e",
  color: "#7ee2a8"
};

const zoomButtonStyle = {
  background: "#161616",
  border: "1px solid #2d2d2d",
  borderRadius: "7px",
  color: "#8a8a8a",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 800,
  padding: "3px 9px"
};

const keycapStyle = {
  alignItems: "center",
  background: "#0d0d0d",
  border: "1px solid #363636",
  borderRadius: "5px",
  color: "#8a8a8a",
  display: "inline-flex",
  fontSize: "10px",
  fontWeight: 800,
  justifyContent: "center",
  lineHeight: 1,
  minWidth: "18px",
  padding: "3px 5px"
};

const endpointPillStyle = (active) => ({
  background: active ? "#2b2047" : "#161616",
  border: `1px solid ${active ? "rgba(196, 181, 253, 0.6)" : "#2d2d2d"}`,
  borderRadius: "8px",
  color: active ? "#d9ccff" : "#7d7d7d",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 800,
  padding: "6px 12px"
});

// Format masks, not example dates. These used to be "14/07/1789" / "1789" — which,
// on a French history deck, is the answer to a card you are quite likely to be
// holding. A hint about the format must not be a hint about the date.
const placeholderByPrecision = {
  day: "JJ/MM/AAAA",
  month: "MM/AAAA",
  year: "AAAA"
};

const unitNouns = {
  days: ["jour", "jours"],
  months: ["mois", "mois"],
  years: ["an", "ans"]
};

function isEditableTarget(target) {
  if (!target || typeof target.closest !== "function") return false;

  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

function projectedIntervalLabel(item, quality) {
  const value = item?.projected_intervals?.[quality];

  return Number(value) > 0 ? `≈ ${value} j` : null;
}

// A relearning retry never re-grades FSRS: Encore and Acquis lead to the same
// already-frozen interval, so both buttons show that one value rather than a
// per-grade estimate that would wrongly suggest the choice changes anything.
function relearningIntervalLabel(item) {
  const value = item?.relearning_interval;

  return Number(value) > 0 ? `≈ ${value} j` : null;
}

function qualityColor(quality) {
  if (quality === 2) return "#7ee2a8";
  if (quality === 1) return "#f3d36a";

  return "#ff9aa5";
}

// Refinement offered on a hit: the auto grade is pre-selected, and the learner
// can say it was actually Dur/Bon/Facile. Same 1/2/3 = Hard/Good/Easy scale the
// other question types use.
const qualityRatingOptions = [
  { value: 1, label: "Dur", color: "#f3d36a", activeBg: "#35311f" },
  { value: 2, label: "Bon", color: "#8fc7ff", activeBg: "#1f2f3a" },
  { value: 3, label: "Facile", color: "#7ee2a8", activeBg: "#183a24" }
];

// A relearning retry never re-grades FSRS, so the Dur/Bon/Facile nuance above
// is meaningless there — it collapses to the same binary Encore/Acquis choice
// every other question type uses for relearning. See relearningGrades.js.
const relearningRatingOptions = [
  { value: STILL_LEARNING_QUALITY, label: "Encore", color: "#ff9aa5", activeBg: "#3a1f24" },
  { value: GOT_IT_QUALITY, label: "Acquis", color: "#7ee2a8", activeBg: "#1d3a2b" }
];

// The backend returns an unsigned distance; the direction is ours to work out,
// and "3 ans trop tôt" teaches far more than "3 ans d'écart".
function describeGap(result) {
  if (!result || result.quality === 2) return "Exact !";

  const distance = result.start?.distance ?? 0;
  const unit = result.start?.unit || "years";
  const [singular, plural] = unitNouns[unit] || unitNouns.years;
  const noun = distance > 1 ? plural : singular;
  const expectedValue = lowerOrdinal(result.expected?.start);
  const guessValue = lowerOrdinal(result.guess?.start || result.start?.guess);
  const direction = guessValue < expectedValue ? "trop tôt" : "trop tard";

  return `${distance} ${noun} ${direction}`;
}

function answerCenterValue(answer, isInterval, precision) {
  const start = draftCenter(answer.start, precision);

  if (!isInterval) return start;

  const end = draftCenter(answer.end, precision);

  if (start === null || end === null) return start;

  return Math.round((start + end) / 2);
}

function draftCenter(draft, precision) {
  if (!draft || draft.year === null) return null;

  return centerOrdinal({
    year: draft.year,
    month: draft.month ?? 1,
    day: draft.day ?? 1,
    precision
  });
}

function formatDraft(draft, precision) {
  if (!draft || draft.year === null) return "";

  return formatTimelineDate({
    year: draft.year,
    month: draft.month ?? 1,
    day: draft.day ?? 1,
    precision: draft.month === null
      ? "year"
      : draft.day === null
        ? "month"
        : precision
  });
}

export default function TimelineReview({
  group,
  reviewItems,
  onAnsweringComplete,
  onComplete,
  submitAnswer = sendTimelineAnswer,
  graduateAnswer,
  showQualityControls = true,
  fillAvailableHeight = false
}) {
  const {
    activeItem,
    activeItemRelearning,
    activeTimeline,
    adjustQuality,
    answer,
    answeredCount,
    canAdjustQuality,
    draft,
    endpoint,
    error,
    goNext,
    isComplete,
    isInterval,
    isSubmitting,
    precision,
    range,
    result,
    revealed,
    selectedQuality,
    setEndpoint,
    setParsedDate,
    setUnit,
    skip,
    toggleEndpoint,
    totalCount,
    validate
  } = useTimelineReview({
    group,
    graduateAnswer,
    onAnsweringComplete,
    onComplete,
    reviewItems,
    showQualityControls,
    submitAnswer
  });
  const activeQualityOptions = activeItemRelearning ? relearningRatingOptions : qualityRatingOptions;

  const displayRange = useMemo(() => buildDisplayRange(range), [range]);
  const bounds = useMemo(() => yearBoundsFromRange(displayRange), [displayRange]);
  const [slice, setSliceState] = useState(() => ({ ...bounds }));
  const [quickInput, setQuickInput] = useState("");
  const [quickError, setQuickError] = useState("");
  const inputRef = useRef(null);
  const { flashQuality, isFlashing } = useQualityPickFlash();
  const activeId = activeItem?.question_id ?? null;

  // The map above stays the same picture on every card (that is what spatial
  // memory attaches to). The rail is the opposite: it opens on a fresh random
  // window around this card's answer, so you can aim at a year straight away
  // instead of hunting across a millennium. Zooming out to the full frame is
  // always one "Reset" away.
  useEffect(() => {
    if (!activeTimeline) {
      setSliceState({ ...bounds });
    } else {
      const targets = [yearToTimelineIndex(activeTimeline.start.year)];

      if (activeTimeline.kind === "interval" && activeTimeline.end) {
        targets.push(yearToTimelineIndex(activeTimeline.end.year));
      }

      setSliceState(buildAnswerSlice(targets, bounds));
    }

    setQuickInput("");
    setQuickError("");
    // activeTimeline is memoised on activeId, so this re-draws the window once
    // per card rather than on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, bounds]);

  const setSlice = useCallback((updater) => {
    setSliceState(current => clampSlice(
      typeof updater === "function" ? updater(current) : updater,
      bounds
    ));
  }, [bounds]);

  const anchors = useMemo(
    () => buildSessionAnchors(reviewItems || [], group?.anchors || emptyAnchors),
    [group?.anchors, reviewItems]
  );

  const nudge = useCallback((unit, delta) => {
    if (revealed) return;

    if (unit === "year") {
      const base = draft.year ?? 0;
      const next = base + delta;

      setUnit("year", next === 0 ? (delta > 0 ? 1 : -1) : next);
      return;
    }

    if (unit === "month" && draft.month !== null) {
      setUnit("month", clampNumber(draft.month + delta, 1, 12));
      return;
    }

    if (unit === "day" && draft.day !== null && draft.year !== null && draft.month !== null) {
      setUnit("day", clampNumber(draft.day + delta, 1, daysInMonth(draft.year, draft.month)));
    }
  }, [draft, revealed, setUnit]);

  // The finest unit the question asks for is the one the arrows should move —
  // on a day question you almost always want to shift by a day, not a year.
  const finestUnit = precision === "day" && draft.day !== null
    ? "day"
    : (precision === "month" || precision === "day") && draft.month !== null
      ? "month"
      : "year";

  useEffect(() => {
    function handleKeyDown(event) {
      if (isEditableTarget(event.target)) return;

      if (event.key === "Enter") {
        event.preventDefault();

        if (revealed) {
          goNext();
        } else {
          validate();
        }

        return;
      }

      if (revealed) {
        // On a hit, 1/2/3 refine the felt difficulty (Dur/Bon/Facile). AZERTY
        // top-row digits need the physical-key fallback.
        if (!canAdjustQuality) return;

        const quality = eventDigit(event, { min: 1, max: 3 });

        if (quality !== null) {
          event.preventDefault();
          adjustQuality(quality);
        }

        return;
      }

      if (event.key === "Tab" && isInterval) {
        event.preventDefault();
        toggleEndpoint();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        nudge(finestUnit, (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1));
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        nudge("year", (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
        return;
      }

      // Typing a digit anywhere means "I know the date" — hand the keystroke to
      // the quick field rather than making the user click into it first.
      if (/^[0-9-]$/.test(event.key)) {
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [adjustQuality, canAdjustQuality, finestUnit, goNext, isInterval, nudge, revealed, toggleEndpoint, validate]);

  function applyQuickInput() {
    const parsed = parseTimelineInput(quickInput);

    if (!parsed.timeline) {
      setQuickError(parsed.error || "Format de date invalide");
      return;
    }

    setParsedDate(parsed.timeline.start);
    setQuickError("");
    setQuickInput("");
    inputRef.current?.blur();
  }

  function handleQuickKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();

      if (quickInput.trim()) {
        applyQuickInput();
      } else if (revealed) {
        goNext();
      } else {
        validate();
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setQuickInput("");
      setQuickError("");
      inputRef.current?.blur();
    }
  }

  if (!activeItem || !activeTimeline) {
    return null;
  }

  const expected = result?.expected || null;
  const truthDate = expected ? expected.start : null;
  const guessCenter = answerCenterValue(answer, isInterval, precision);
  const guessLabel = isInterval
    ? `${formatDraft(answer.start, precision)} – ${formatDraft(answer.end, precision)}`
    : formatDraft(answer.start, precision);
  const context = draft.year !== null && guessCenter !== null
    ? describeValue(guessCenter)
    : null;
  const sliceRange = sliceToOrdinalRange(slice);

  return (
    <div
      style={{
        background: "#181818",
        border: "1px solid #262626",
        borderRadius: "18px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        // Everything that is not the footer yields on a short window. The footer
        // carries the primary action, so it is the one thing that must never be
        // the element pushed off the bottom of the card.
        gap: fillAvailableHeight ? "clamp(9px, 1.5vh, 14px)" : "14px",
        height: fillAvailableHeight ? "100%" : undefined,
        minHeight: fillAvailableHeight ? 0 : undefined,
        overflow: "hidden",
        padding: fillAvailableHeight
          ? "clamp(12px, 2.4vh, 20px) 22px clamp(6px, 1.4vh, 18px)"
          : "24px 24px 22px",
        ...fadeInStyle
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "grid",
          flexShrink: 0,
          gap: "16px",
          // Equal flexible sides so the question is centred on the card itself,
          // not on whatever room the right-hand controls happen to leave.
          gridTemplateColumns: "1fr minmax(0, auto) 1fr",
          // The prompt is the thing being asked — it gets air on both sides of it
          // rather than being pressed against the track.
          marginBottom: "4px"
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          {!fillAvailableHeight && <div style={typeBadgeStyle}>TIMELINE</div>}
        </div>

        {/* The prompt has to win the eye against three rulers and a landscape, and
            size alone was not doing it. So it gets framed instead: the same violet
            the app already uses for timeline, as a plaque with a kicker above it.
            Keying on the question id replays the card's fadeIn on every new
            question, so the eye is pulled back up here each time. */}
        <div
          key={activeId}
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: "7px",
            minWidth: 0,
            ...fadeInStyle
          }}
        >
          <div
            style={{
              color: "#7a7a7a",
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase"
            }}
          >
            Datez cet évènement
          </div>
          <div
            data-testid="timeline-prompt"
            style={{
              // Neutral on purpose. Violet in this card means "your mark"; the
              // prompt is not your mark. It earns the eye by being a raised,
              // high-contrast surface, not by borrowing a colour that means
              // something else two rows down.
              background: "linear-gradient(180deg, #232327, #1a1a1d)",
              border: "1px solid #34343a",
              borderRadius: "12px",
              boxShadow: "0 8px 26px rgba(0, 0, 0, 0.38)",
              color: "#f6f6f8",
              // Viewport-relative so a short window trades a little prompt size
              // for the rails, rather than pushing the footer off the card.
              fontSize: fillAvailableHeight ? "clamp(19px, 2.7vh, 26px)" : "32px",
              fontWeight: 900,
              letterSpacing: "-0.01em",
              lineHeight: 1.25,
              maxWidth: "100%",
              overflow: "hidden",
              padding: "clamp(7px, 1.2vh, 11px) 28px",
              textAlign: "center",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {activeItem.question}
          </div>
        </div>

        <div style={{ alignItems: "center", display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          {isInterval && !revealed && (
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                data-timeline-endpoint={endpoint === "start" ? "active" : "idle"}
                onClick={() => setEndpoint("start")}
                style={endpointPillStyle(endpoint === "start")}
                type="button"
              >
                Début
              </button>
              <button
                data-timeline-endpoint={endpoint === "end" ? "active" : "idle"}
                onClick={() => setEndpoint("end")}
                style={endpointPillStyle(endpoint === "end")}
                type="button"
              >
                Fin
              </button>
            </div>
          )}
          <div style={{ color: "#777", fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap" }}>
            {/* While a correction is on screen the card is still the current one:
                answeredCount already counts it, so don't advance the counter too. */}
            {Math.min(revealed ? answeredCount : answeredCount + 1, totalCount)} / {totalCount}
          </div>
        </div>
      </div>

      <TimelineGlobalTrack
        anchors={anchors}
        guess={guessCenter === null ? null : { label: guessLabel, value: guessCenter }}
        quality={result?.quality}
        range={displayRange}
        resetSignal={activeId}
        sliceRange={sliceRange}
        truth={truthDate
          ? { label: formatTimelineDate(truthDate), value: centerOrdinal(truthDate) }
          : null}
      />

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexShrink: 0,
          gap: "12px",
          justifyContent: "space-between"
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "10px", minWidth: 0 }}>
          <input
            aria-label="Saisir la date"
            className="app-scrollbar"
            disabled={revealed}
            onBlur={() => quickInput.trim() && applyQuickInput()}
            onChange={event => {
              setQuickInput(formatTypedDate(event.target.value, precision));
              setQuickError("");
            }}
            onKeyDown={handleQuickKeyDown}
            placeholder={placeholderByPrecision[precision]}
            ref={inputRef}
            style={{
              background: "#101010",
              border: `1px solid ${quickError ? "#f87171" : "#2d2d2d"}`,
              borderRadius: "10px",
              boxSizing: "border-box",
              color: "#eee",
              fontSize: "16px",
              fontWeight: 700,
              outline: "none",
              padding: "clamp(7px, 1.3vh, 10px) 14px",
              transition: "border 0.18s ease",
              width: "150px"
            }}
            value={quickInput}
          />
          <div
            data-testid="timeline-answer"
            style={{
              color: guessLabel ? "#e5dcff" : "#5a5a5a",
              fontSize: "20px",
              fontWeight: 900,
              whiteSpace: "nowrap"
            }}
          >
            {guessLabel || "—"}
          </div>
          {context && !revealed && (
            <div style={{ color: "#6d6d6d", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
              {context.eraLabel} · {context.centuryLabel}
            </div>
          )}
        </div>

        <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "6px" }}>
          <button
            onClick={() => setSlice(current => zoomSliceAt(current, 50, 1.6, bounds))}
            style={zoomButtonStyle}
            type="button"
          >
            −
          </button>
          <button
            onClick={() => setSlice(current => zoomSliceAt(current, 50, 0.55, bounds))}
            style={zoomButtonStyle}
            type="button"
          >
            +
          </button>
          <button
            onClick={() => setSlice({ ...bounds })}
            style={zoomButtonStyle}
            type="button"
          >
            Reset
          </button>
        </div>
      </div>

      <TimelineCascade
        bounds={bounds}
        disabled={revealed || isSubmitting}
        draft={revealed && truthDate ? (answer[endpoint] || draft) : draft}
        onUnit={setUnit}
        precision={precision}
        setSlice={setSlice}
        slice={slice}
        truthDate={truthDate}
      />

      <div data-feedback-slot style={{ flexShrink: 0, height: feedbackSlotHeight }}>
        {revealed && result && (
          <div
            data-timeline-feedback={result.quality === 0 ? "wrong" : result.quality === 1 ? "close" : "correct"}
            style={{
              alignItems: "center",
              animation: result.quality === 0 ? "answer-shake 0.4s ease" : "answer-pop 0.42s ease",
              background: result.quality === 0 ? "#3a1d1d" : result.quality === 1 ? "#35311f" : "#183a24",
              border: `1px solid ${qualityColor(result.quality)}`,
              borderRadius: "12px",
              boxSizing: "border-box",
              display: "flex",
              gap: "14px",
              height: "100%",
              padding: "0 16px"
            }}
          >
            <div style={{ color: qualityColor(result.quality), fontSize: "17px", fontWeight: 900 }}>
              {result.quality === 2 ? "Exact !" : result.quality === 1 ? "Presque" : "Raté"}
            </div>
            <div style={{ color: "#ddd", fontSize: "14px", fontWeight: 700 }}>
              {formatTimelineDate(expected.start)}
              {expected.end ? ` – ${formatTimelineDate(expected.end)}` : ""}
            </div>
            {result.quality !== 2 && (
              <div style={{ color: "#9a9a9a", fontSize: "13px", fontWeight: 700 }}>
                {describeGap(result)}
              </div>
            )}

            {canAdjustQuality && (
              <div
                data-timeline-quality-bar
                style={{ alignItems: "center", display: "flex", gap: "6px", marginLeft: "auto" }}
              >
                {activeQualityOptions.map(option => {
                  const active = selectedQuality === option.value;
                  const intervalLabel = activeItemRelearning
                    ? relearningIntervalLabel(activeItem)
                    : projectedIntervalLabel(activeItem, option.value);

                  return (
                    <button
                      key={option.value}
                      type="button"
                      data-timeline-quality={option.value}
                      data-active={active ? "true" : "false"}
                      onClick={() => {
                        adjustQuality(option.value);
                        flashQuality(activeId, option.value);
                      }}
                      style={{
                        background: active ? option.activeBg : "#161616",
                        border: `1px solid ${active ? option.color : "#333"}`,
                        borderRadius: "8px",
                        color: active ? option.color : "#8a8a8a",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 800,
                        padding: "6px 10px",
                        transition: "background 0.14s ease, color 0.14s ease, border-color 0.14s ease",
                        animation: isFlashing(activeId, option.value)
                          ? qualityPickAnimation(option.value)
                          : undefined
                      }}
                    >
                      {option.value} {option.label}
                      {intervalLabel && (
                        <span style={{ fontWeight: 600, marginLeft: "5px", opacity: 0.75 }}>
                          {intervalLabel}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!revealed && (error || quickError) && (
          <div
            style={{
              alignItems: "center",
              color: "#ff9aa5",
              display: "flex",
              fontSize: "13px",
              fontWeight: 700,
              height: "100%"
            }}
          >
            {error || quickError}
          </div>
        )}
      </div>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexShrink: 0,
          gap: "10px",
          justifyContent: "space-between"
        }}
      >
        <div style={{ color: "#5f5f5f", fontSize: "11px", fontWeight: 700 }}>
          {revealed ? (
            canAdjustQuality ? (
              activeItemRelearning ? (
                <>
                  <span style={keycapStyle}>1</span> acquis · <span style={keycapStyle}>↵</span> continuer
                </>
              ) : (
                <>
                  <span style={keycapStyle}>1</span>/<span style={keycapStyle}>2</span>/
                  <span style={keycapStyle}>3</span> difficulté · <span style={keycapStyle}>↵</span> continuer
                </>
              )
            ) : (
              <><span style={keycapStyle}>↵</span> continuer</>
            )
          ) : (
            <>
              <span style={keycapStyle}>↑↓</span> année · <span style={keycapStyle}>←→</span> ajuster ·{" "}
              <span style={keycapStyle}>↵</span> valider
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          {!revealed && (
            <button onClick={skip} style={buttonStyle} type="button">
              Passer
            </button>
          )}
          {revealed ? (
            <button data-timeline-continue onClick={goNext} style={successButtonStyle} type="button">
              Continuer ↵
            </button>
          ) : (
            <button
              disabled={!isComplete || isSubmitting}
              onClick={validate}
              style={{
                ...primaryButtonStyle,
                cursor: isComplete && !isSubmitting ? "pointer" : "default",
                opacity: isComplete && !isSubmitting ? 1 : 0.45
              }}
              type="button"
            >
              {isSubmitting ? "…" : "Valider ↵"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

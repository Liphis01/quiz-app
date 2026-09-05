import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SvgMap from "../../map/components/SvgMap";
import { resolveMediaUrl } from "../../../shared/media";
import { fadeInStyle } from "../../../shared/styles";
import { centerListItem } from "../../../shared/scroll";
import { useFlip } from "../../../shared/useFlip";
import { qualityPickAnimation } from "../../../shared/answerFeedback";
import { useQualityPickFlash } from "../../../shared/useQualityPickHold";
import {
  MAP_RECAP_UNANSWERED,
  useMapReview
} from "../hooks/useMapReview";
import { eventDigit } from "../keyboardShortcuts";
import TrainingTimerPanel from "./TrainingTimerPanel";
import {
  GOT_IT_QUALITY,
  isRelearningGroupItem,
  relearningQualityOptions
} from "../relearningGrades";
import {
  MAP_MODE_CLICK_PROMPT,
  MAP_MODE_MULTIPLE_CHOICE,
  MAP_MODE_TYPE_ALL,
  MAP_MODE_TYPE_PROMPT,
  mapModeLabels,
  normalizeMapMode
} from "../mapModes";

const typeBadgeStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  width: "fit-content",
  padding: "5px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "600",
  background: "rgba(56, 189, 248, 0.16)",
  color: "#7dd3fc",
  border: "1px solid rgba(56, 189, 248, 0.28)"
};

const inputStyle = {
  width: "100%",
  padding: "14px 16px",
  background: "#101010",
  color: "#eee",
  border: "1px solid #2d2d2d",
  borderRadius: "12px",
  boxSizing: "border-box",
  outline: "none",
  fontSize: "15px"
};

const buttonStyle = {
  padding: "12px 18px",
  borderRadius: "10px",
  border: "1px solid #333",
  background: "#232323",
  color: "#eee",
  cursor: "pointer",
  fontWeight: "600"
};

const abandonButtonStyle = {
  ...buttonStyle,
  background: "#3a2424",
  border: "1px solid #7f3535",
  color: "#fecaca"
};

const successButton = {
  ...buttonStyle,
  background: "#1d3a29",
  border: "1px solid #2c5c3e",
  color: "#7ee2a8"
};

const qualityButtonStyles = {
  0: {
    background: "#3a3420",
    border: "1px solid #6b2b31",
    color: "#ff8c94"
  },
  1: {
    background: "#3a3420",
    border: "1px solid #6f6434",
    color: "#f3d36a"
  },
  2: {
    background: "#20303a",
    border: "1px solid #345b7a",
    color: "#8fc7ff"
  },
  3: {
    background: "#3a3420",
    border: "1px solid #2c5c3e",
    color: "#7ee2a8"
  },
  [MAP_RECAP_UNANSWERED]: {
    background: "#202020",
    border: "1px solid #575757",
    color: "#cfcfcf"
  }
};

const qualityOptions = [
  { value: 0, icon: "❌", title: "Faux" },
  { value: 1, icon: "😐", title: "Dur" },
  { value: 2, icon: "🙂", title: "Bon" },
  { value: 3, icon: "✅", title: "Facile" }
];

// A correct pick is never "Faux"; the grades occupy slots 1, 2, and 3 while the
// revealed correct answer moves to slot 4.
const choiceQualityOptions = qualityOptions.filter(option => option.value > 0);
const correctChoiceRevealOrder = 4;

// A relearning zone never re-grades: FSRS is frozen for the day, so any success
// graduates it identically. The three "how easy" grades collapse to the single
// "Acquis" from relearningQualityOptions. See relearningGrades.js.
const acquisOnlyOptions = relearningQualityOptions.filter(
  option => option.value === GOT_IT_QUALITY
);

const unansweredQualityOption = {
  value: MAP_RECAP_UNANSWERED,
  icon: "NR",
  title: "Non répondu"
};

const recapHeaderColumns = [
  { key: "answer", label: "Réponse" },
  { key: "success", label: "Réussite" },
  { key: "interval", label: "Intervalle" },
  { key: "quality", label: "Qualité" }
];

const mapAutoZoomStorageKey = "quizApp.mapReview.autoZoomEnabled";
// The recap keeps its own preference: wanting the map to follow the prompt while
// answering is independent from wanting it to follow the selected row afterwards.
const recapAutoZoomStorageKey = "quizApp.mapReview.recapAutoZoomEnabled";

function readAutoZoomPreference(storageKey) {
  try {
    return window.localStorage.getItem(storageKey) !== "false";
  } catch {
    return true;
  }
}

function writeAutoZoomPreference(storageKey, enabled) {
  try {
    window.localStorage.setItem(storageKey, enabled ? "true" : "false");
  } catch {
    // The in-memory toggle should still work if storage is unavailable.
  }
}

function readMapAutoZoomPreference() {
  return readAutoZoomPreference(mapAutoZoomStorageKey);
}

function readRecapAutoZoomPreference() {
  return readAutoZoomPreference(recapAutoZoomStorageKey);
}

// The revealed answer keeps its own box and slides between slots (see useFlip), so
// the slot wrapper — not the button — is what FLIP moves. It rides above the
// quality buttons while it travels.
const choiceSlotStyle = {
  display: "flex",
  minWidth: 0,
  position: "relative",
  zIndex: 2
};

// The quality buttons only appear once the answer has finished sliding, so the
// two never read as one row of answers.
const choiceRevealDelay = "0.3s";

// Keeps the regular answer-button shape — only the centred label and the muted
// text set it apart, since the sliding green answer is what carries the emphasis.
// The three grades stay visually identical: picking one grades and advances
// immediately, so there is no lasting selection to show (and tinting the default
// "Bon" only made it look pre-chosen).
function choiceQualityButtonStyle() {
  return {
    ...choiceButtonStyle,
    animation: `fadeIn 0.26s ease ${choiceRevealDelay} both`,
    border: "1px solid #333",
    color: "#c9c9c9",
    gap: "8px",
    justifyContent: "center"
  };
}

function choiceFeedbackState(option, feedback) {
  if (!feedback) return "";

  if (option.question_id === feedback.correctQuestionId) return "correct";
  if (option.question_id === feedback.selectedQuestionId) return "wrong";

  return "neutral";
}


function choiceFeedbackLabel(option, feedback) {
  const state = choiceFeedbackState(option, feedback);

  if (state === "correct") return "Correct";
  if (state === "wrong") return "Faux";

  return "";
}


function getChoiceButtonStyle(option, feedback) {
  const state = choiceFeedbackState(option, feedback);

  if (state === "correct") {
    return {
      ...choiceButtonStyle,
      animation: "answer-pop 0.42s ease",
      background: "linear-gradient(180deg, #183a24, #12291b)",
      border: "1px solid rgba(134, 239, 172, 0.7)",
      boxShadow: "0 0 0 3px rgba(34, 197, 94, 0.16)",
      color: "#d7f5df"
    };
  }

  if (state === "wrong") {
    return {
      ...choiceButtonStyle,
      animation: "answer-shake 0.4s ease",
      background: [
        "repeating-linear-gradient(135deg, rgba(127, 29, 29, 0.24) 0 4px, rgba(127, 29, 29, 0) 4px 8px)",
        "linear-gradient(180deg, #3a1d1d, #271414)"
      ].join(", "),
      border: "1px solid rgba(248, 113, 113, 0.72)",
      boxShadow: "0 0 0 3px rgba(248, 113, 113, 0.14)",
      color: "#ffd7d7"
    };
  }

  if (state === "neutral") {
    return {
      ...choiceButtonStyle,
      cursor: "default",
      opacity: 0.55
    };
  }

  return choiceButtonStyle;
}


export default function MapReview({
  group,
  reviewZones,
  onAnsweringComplete,
  onComplete,
  submitAnswer,
  graduateAnswer,
  allowPartialSubmit = false,
  showQualityControls = true,
  trainingElapsedMs = null,
  trainingBestTimeMs = null,
  mode: modeProp,
  contextItems = [],
  fillAvailableHeight = false
}) {
  const normalizedMode = normalizeMapMode(modeProp || group.mode);
  const [mapGeometry, setMapGeometry] = useState(null);
  const handleMapGeometryLoaded = useCallback(geometry => {
    setMapGeometry(geometry?.diagonal > 0 ? geometry : null);
  }, []);
  const {
    activeMissedCodes,
    canFinishReview = false,
    choiceFeedback,
    choiceOptions,
    clickRatingFeedback,
    dueCodes,
    feedbackTone,
    flashCodes,
    focusedCode,
    focusNextRemainingZone,
    focusVersion,
    foundQuestionIds,
    foundCodes,
    foundQuestionIdSet,
    finishMap,
    handleChoiceSelect,
    handleSubmit,
    handleZoneSelect,
    input,
    manualFocusCode,
    mode,
    qualityByQuestionId,
    missedCodes,
    promptCode,
    promptLabel,
    rateChoice = () => {},
    rateClickAnswer = () => {},
    rateTypedAnswer = () => {},
    recapMissCount,
    recapRows,
    recapSort,
    recapSuccessCount,
    recapSuccessRate,
    recapUnansweredCount,
    remainingFocusCode,
    remainingZones,
    selectedCode,
    selectNextPrompt,
    sendResult,
    setFocusedCode,
    setFoundZoneQualities,
    setInput,
    setQuality,
    showRecap,
    showRecapSections,
    skipCurrentPrompt,
    submitError,
    submitting,
    typedRatingFeedback,
    toggleRecapSort
  } = useMapReview(reviewZones, onComplete, submitAnswer, {
    allowPartialSubmit,
    mode: normalizedMode,
    contextItems,
    inlineChoiceRating: showQualityControls,
    inlineClickRating: showQualityControls,
    inlineTypedRating: showQualityControls,
    onAnsweringComplete,
    group,
    graduateAnswer,
    mapGeometry
  });
  const showChoiceRating = (
    mode === MAP_MODE_MULTIPLE_CHOICE &&
    !showRecap &&
    Boolean(choiceFeedback) &&
    showQualityControls
  );
  // Training has no quality buttons to fill the freed slots, so instead of leaving
  // the answer pinned to the first slot with dead space beside it, center the
  // surviving answer(s) in the row.
  const centerReveal = (
    mode === MAP_MODE_MULTIPLE_CHOICE &&
    !showRecap &&
    Boolean(choiceFeedback) &&
    !showQualityControls
  );
  const correctChoiceId = choiceFeedback?.correctQuestionId;
  // Once answered, only the zones worth looking at stay on the board: the correct
  // one, plus your pick when it was wrong. The decoys leave, freeing their slots.
  const revealedChoices = useMemo(() => {
    if (!choiceFeedback) return choiceOptions;

    const correct = choiceOptions.find(
      option => option.question_id === correctChoiceId
    );

    if (choiceFeedback.isCorrect) return correct ? [correct] : [];

    const picked = choiceOptions.find(
      option => option.question_id === choiceFeedback.selectedQuestionId
    );

    return [correct, picked].filter(Boolean);
  }, [choiceFeedback, choiceOptions, correctChoiceId]);
  const choiceGridRef = useRef(null);
  // Scope the flip keys to the zone being *answered*, not to promptCode — that one
  // advances to the next zone the moment you pick, which would change every key and
  // make FLIP treat the correct answer as a brand-new element (so it never slid).
  const choiceScope = choiceFeedback?.correctCode ?? promptCode;
  // Slide the surviving answers into their new slots. Scoped per question so the
  // next one starts fresh instead of animating out of the previous one's layout.
  useFlip(choiceGridRef, `${choiceScope}:${choiceFeedback?.id ?? "idle"}`);
  const inputRef = useRef(null);
  const recapTableBodyRef = useRef(null);
  const recapRowRefs = useRef(new Map());
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(readMapAutoZoomPreference);
  const [recapAutoZoomEnabled, setRecapAutoZoomEnabled] = useState(readRecapAutoZoomPreference);
  const [recapFocusCode, setRecapFocusCode] = useState(null);
  const [recapFocusVersion, setRecapFocusVersion] = useState(0);
  const [activeMapZoom, setActiveMapZoom] = useState({ direction: 0, version: 0 });
  const [recapMapZoom, setRecapMapZoom] = useState({ direction: 0, version: 0 });
  const [wrongInputShakeId, setWrongInputShakeId] = useState(0);
  const { flashQuality: flashRecapQuality, isFlashing: isRecapFlashing } = useQualityPickFlash();
  const recapRowKey = recapRows.map(row => row.item.code).join("|");
  const recapGridColumns = showQualityControls
    ? recapTableGridColumns
    : "minmax(0, 1fr)";
  const visibleRecapHeaderColumns = showQualityControls
    ? recapHeaderColumns
    : recapHeaderColumns.filter(column => column.key === "answer");
  const showTrainingTimer = trainingElapsedMs !== null && !showRecap;
  const showTextInput = mode === MAP_MODE_TYPE_ALL || mode === MAP_MODE_TYPE_PROMPT;
  const showTypedRating = (
    showTextInput &&
    !showRecap &&
    Boolean(typedRatingFeedback) &&
    showQualityControls
  );
  const typedRatingItem = typedRatingFeedback?.item || null;
  const typedRatingItemRelearning = Boolean(
    typedRatingItem && isRelearningGroupItem(group, typedRatingItem)
  );
  const typedRatingOptions = typedRatingItemRelearning
    ? acquisOnlyOptions
    : choiceQualityOptions;
  const typedRatingDefaultQuality = typedRatingItemRelearning ? GOT_IT_QUALITY : 2;
  const showClickRating = (
    mode === MAP_MODE_CLICK_PROMPT &&
    !showRecap &&
    Boolean(clickRatingFeedback) &&
    showQualityControls
  );
  const clickRatingItem = clickRatingFeedback?.item || null;
  const clickRatingItemRelearning = Boolean(
    clickRatingItem && isRelearningGroupItem(group, clickRatingItem)
  );
  const clickRatingOptions = clickRatingItemRelearning
    ? acquisOnlyOptions
    : choiceQualityOptions;
  const clickRatingDefaultQuality = clickRatingItemRelearning ? GOT_IT_QUALITY : 2;
  const showPromptPanel = (
    mode !== MAP_MODE_TYPE_ALL &&
    mode !== MAP_MODE_TYPE_PROMPT &&
    mode !== MAP_MODE_MULTIPLE_CHOICE &&
    !showRecap
  );
  const canSkipPrompt = mode === MAP_MODE_TYPE_PROMPT;
  const showAutoZoomToggle = !showRecap && (
    mode === MAP_MODE_TYPE_PROMPT ||
    mode === MAP_MODE_MULTIPLE_CHOICE
  );
  // The click-prompt quality overlay is feedback, not a navigation request. Keep
  // the zone highlighted through selected/due props without asking SvgMap to fit
  // it again when the quality buttons appear.
  const activeMapFocusSourceCode = showClickRating
    ? manualFocusCode
    : remainingFocusCode;
  const activeMapFocusCode = showAutoZoomToggle && !autoZoomEnabled
    ? manualFocusCode
    : activeMapFocusSourceCode;
  const activeMapClickableCodes = mode === MAP_MODE_CLICK_PROMPT && !showRecap
    ? dueCodes
    : undefined;
  const completedQuestionCount = Math.max(0, reviewZones.length - remainingZones.length);
  const wrongQuestionCount = mode !== MAP_MODE_TYPE_ALL
    ? Math.max(0, completedQuestionCount - foundQuestionIds.length)
    : 0;
  const correctProgressPercent = reviewZones.length
    ? Math.min((foundQuestionIds.length / reviewZones.length) * 100, 100)
    : 0;
  const wrongProgressPercent = reviewZones.length
    ? Math.min((wrongQuestionCount / reviewZones.length) * 100, 100)
    : 0;
  const baseFeedbackCopy = feedbackTone === "duplicate"
    ? "Déjà répondu."
    : feedbackTone === "incorrect"
    ? mode === MAP_MODE_TYPE_PROMPT
      ? "Réponse incorrecte."
      : "Mauvaise zone."
    : feedbackTone === "correct"
      ? "Bonne réponse."
      : mode === MAP_MODE_TYPE_ALL
        ? "Tape les réponses."
        : mode === MAP_MODE_CLICK_PROMPT
          ? "Clique la zone demandée."
          : mode === MAP_MODE_MULTIPLE_CHOICE
            ? "Choisis la réponse."
            : "Tape le nom de la zone.";
  const feedbackCopy = fillAvailableHeight && !feedbackTone ? "" : baseFeedbackCopy;
  // When every found zone is a relearning retry, the bulk row collapses to the
  // same binary Encore/Acquis choice as its individual rows — the Dur/Bon/Facile
  // split is meaningless there since none of it is ever re-sent as an FSRS grade.
  const allFoundRelearning = useMemo(() => {
    const foundRows = recapRows.filter(row => row.isFound);

    return foundRows.length > 0 && foundRows.every(row => isRelearningGroupItem(group, row.item));
  }, [group, recapRows]);
  const bulkQualityOptions = allFoundRelearning ? relearningQualityOptions : qualityOptions;
  const bulkQualityDefault = allFoundRelearning ? GOT_IT_QUALITY : 2;
  const foundBulkQuality = useMemo(() => {
    if (foundQuestionIds.length === 0) return null;

    const firstQuality = qualityByQuestionId[foundQuestionIds[0]] ?? bulkQualityDefault;

    return foundQuestionIds.every(
      questionId => (qualityByQuestionId[questionId] ?? bulkQualityDefault) === firstQuality
    )
      ? firstQuality
      : null;
  }, [bulkQualityDefault, foundQuestionIds, qualityByQuestionId]);
  const foundZoneLabels = useMemo(() => {
    const labels = {};
    const activeMissedCodeSet = new Set(activeMissedCodes);

    reviewZones.forEach(item => {
      if (
        !item.code ||
        !item.label ||
        (
          !foundQuestionIdSet.has(item.question_id) &&
          !activeMissedCodeSet.has(item.code)
        )
      ) {
        return;
      }

      labels[item.code] = item.label;
    });

    return labels;
  }, [activeMissedCodes, foundQuestionIdSet, reviewZones]);
  // While answering, only found/missed zones are labelled so hovering can't spoil
  // the answer. By the recap every zone is revealed, so all of them get a name.
  const recapZoneLabels = useMemo(() => {
    const labels = {};

    reviewZones.forEach(item => {
      if (!item.code || !item.label) return;

      labels[item.code] = item.label;
    });

    return labels;
  }, [reviewZones]);

  function setRecapRowRef(code) {
    return (element) => {
      if (!code) return;

      if (element) {
        recapRowRefs.current.set(code, element);
      } else {
        recapRowRefs.current.delete(code);
      }
    };
  }

  const scrollRecapRowIntoView = useCallback((code) => {
    const list = recapTableBodyRef.current;
    const row = recapRowRefs.current.get(code);
    if (!list || !row) return;

    centerListItem(list, row);
  }, []);

  const selectRecapCode = useCallback((code) => {
    if (!code) return;

    setFocusedCode(code);
    window.requestAnimationFrame(() => scrollRecapRowIntoView(code));
  }, [scrollRecapRowIntoView, setFocusedCode]);

  const focusRecapCode = useCallback((code) => {
    if (!code) return;

    selectRecapCode(code);
    setRecapFocusCode(code);
    setRecapFocusVersion(version => version + 1);
  }, [selectRecapCode]);

  // Selecting a recap row (click, Enter/Space or arrow keys) always highlights it
  // and scrolls it into view; only the map zoom is gated by the recap toggle.
  const selectRecapZone = useCallback((code) => {
    if (recapAutoZoomEnabled) {
      focusRecapCode(code);
    } else {
      selectRecapCode(code);
    }
  }, [focusRecapCode, recapAutoZoomEnabled, selectRecapCode]);

  const toggleRecapAutoZoom = useCallback(() => {
    const nextEnabled = !recapAutoZoomEnabled;

    setRecapAutoZoomEnabled(nextEnabled);
    writeAutoZoomPreference(recapAutoZoomStorageKey, nextEnabled);

    // Turning it back on catches the map up with the row already selected.
    if (nextEnabled && focusedCode) {
      focusRecapCode(focusedCode);
    }
  }, [focusRecapCode, focusedCode, recapAutoZoomEnabled]);

  const handleZoomRemaining = useCallback((direction = 1) => {
    focusNextRemainingZone(direction);
    inputRef.current?.focus({ preventScroll: true });
  }, [focusNextRemainingZone]);

  const focusAnswerInput = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleActiveMapMouseDown = useCallback((event) => {
    if (!inputRef.current) return;

    event.preventDefault();
    focusAnswerInput();
  }, [focusAnswerInput]);

  const handleActiveMapSelect = useCallback((code) => {
    handleZoneSelect(code);
    focusAnswerInput();
  }, [focusAnswerInput, handleZoneSelect]);

  const zoomActiveMap = useCallback((direction) => {
    setActiveMapZoom(command => ({
      direction,
      version: command.version + 1
    }));
  }, []);

  const zoomRecapMap = useCallback((direction) => {
    setRecapMapZoom(command => ({
      direction,
      version: command.version + 1
    }));
  }, []);

  useEffect(() => {
    if (!wrongInputShakeId) return undefined;

    const timeout = window.setTimeout(() => {
      setWrongInputShakeId(0);
    }, 420);

    return () => window.clearTimeout(timeout);
  }, [wrongInputShakeId]);

  const toggleAutoZoom = useCallback(() => {
    setAutoZoomEnabled(enabled => {
      const nextEnabled = !enabled;

      writeAutoZoomPreference(mapAutoZoomStorageKey, nextEnabled);

      return nextEnabled;
    });
  }, []);

  useEffect(() => {
    if (mode !== MAP_MODE_TYPE_ALL || showRecap || remainingZones.length === 0) {
      return undefined;
    }

    function handleMapKeyDown(event) {
      if (
        event.defaultPrevented ||
        event.key !== "Tab" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      event.preventDefault();
      handleZoomRemaining(event.shiftKey ? -1 : 1);
    }

    window.addEventListener("keydown", handleMapKeyDown);

    return () => {
      window.removeEventListener("keydown", handleMapKeyDown);
    };
  }, [handleZoomRemaining, mode, remainingZones.length, showRecap]);

  useEffect(() => {
    function handleMapZoomKeyDown(event) {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const direction = mapZoomDirectionFromKey(event);
      if (!direction) return;

      event.preventDefault();
      if (showRecap) {
        zoomRecapMap(direction);
      } else {
        zoomActiveMap(direction);
      }
    }

    window.addEventListener("keydown", handleMapZoomKeyDown);

    return () => {
      window.removeEventListener("keydown", handleMapZoomKeyDown);
    };
  }, [showRecap, zoomActiveMap, zoomRecapMap]);

  useEffect(() => {
    if (
      ![MAP_MODE_CLICK_PROMPT, MAP_MODE_MULTIPLE_CHOICE].includes(mode) ||
      showRecap ||
      remainingZones.length === 0
    ) {
      return undefined;
    }

    function handlePromptCycleKeyDown(event) {
      if (
        event.defaultPrevented ||
        event.key !== "Tab" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      event.preventDefault();
      selectNextPrompt(event.shiftKey ? -1 : 1);
    }

    window.addEventListener("keydown", handlePromptCycleKeyDown);

    return () => {
      window.removeEventListener("keydown", handlePromptCycleKeyDown);
    };
  }, [mode, remainingZones.length, selectNextPrompt, showRecap]);

  // Keyboard grading of the inline choice reveal: 1/2/3 (or Enter for the Bon
  // default) on a correct pick, Enter/Space to continue after a wrong pick.
  useEffect(() => {
    if (!showChoiceRating) return undefined;

    const correctPick = Boolean(choiceFeedback?.isCorrect);

    function handleChoiceRatingKeyDown(event) {
      if (isEditableTarget(event.target)) return;

      // A correct pick is graded 1/2/3 (never "Faux"); Enter takes the Bon default.
      if (correctPick) {
        const quality = eventDigit(event, { min: 1, max: 3 });

        if (quality !== null) {
          event.preventDefault();
          rateChoice(quality);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          rateChoice(2);
        }

        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        rateChoice();
      }
    }

    window.addEventListener("keydown", handleChoiceRatingKeyDown);

    return () => {
      window.removeEventListener("keydown", handleChoiceRatingKeyDown);
    };
  }, [showChoiceRating, choiceFeedback, rateChoice]);

  // Keyboard grading for typed recall: after a correct typed answer, Enter keeps
  // the fast path on the default "Bon" grade while 1/2/3 lets the learner adjust.
  useEffect(() => {
    if (!showTypedRating) return undefined;

    function handleTypedRatingKeyDown(event) {
      if (event.defaultPrevented) return;

      const quality = eventDigit(event, { min: 1, max: 3 });

      if (quality !== null) {
        event.preventDefault();
        rateTypedAnswer(quality);
        inputRef.current?.focus({ preventScroll: true });
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        rateTypedAnswer(typedRatingDefaultQuality);
        inputRef.current?.focus({ preventScroll: true });
      }
    }

    window.addEventListener("keydown", handleTypedRatingKeyDown);

    return () => {
      window.removeEventListener("keydown", handleTypedRatingKeyDown);
    };
  }, [rateTypedAnswer, showTypedRating, typedRatingDefaultQuality]);

  // Keyboard grading for click prompts: the correct zone is already known, so
  // Enter keeps the fast default while 1/2/3 lets the learner adjust.
  useEffect(() => {
    if (!showClickRating) return undefined;

    function handleClickRatingKeyDown(event) {
      const quality = eventDigit(event, { min: 1, max: 3 });

      if (quality !== null) {
        event.preventDefault();
        rateClickAnswer(quality);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        rateClickAnswer(clickRatingDefaultQuality);
      }
    }

    window.addEventListener("keydown", handleClickRatingKeyDown);

    return () => {
      window.removeEventListener("keydown", handleClickRatingKeyDown);
    };
  }, [clickRatingDefaultQuality, rateClickAnswer, showClickRating]);

  // Quick answer: number keys pick the matching option before the reveal,
  // mirroring the keyboard flow of text review (Enter reveals, digits grade).
  useEffect(() => {
    if (mode !== MAP_MODE_MULTIPLE_CHOICE || showRecap || choiceFeedback) {
      return undefined;
    }

    function handleChoiceKeyDown(event) {
      if (isEditableTarget(event.target)) return;

      const digit = eventDigit(event, { min: 1, max: 9 });
      const index = digit === null ? -1 : digit - 1;

      if (!Number.isInteger(index) || index < 0 || index >= choiceOptions.length) {
        return;
      }

      event.preventDefault();
      handleChoiceSelect(choiceOptions[index].question_id);
    }

    window.addEventListener("keydown", handleChoiceKeyDown);

    return () => {
      window.removeEventListener("keydown", handleChoiceKeyDown);
    };
  }, [mode, showRecap, choiceFeedback, choiceOptions, handleChoiceSelect]);

  const previousPromptCodeRef = useRef(promptCode);

  useEffect(() => {
    if (![MAP_MODE_TYPE_PROMPT, MAP_MODE_MULTIPLE_CHOICE].includes(mode)) return;

    // While a choice reveal is up, the answered zone is still the one on screen
    // but promptCode has already advanced to the next zone. Re-focusing now would
    // only bump focusVersion and make SvgMap re-fit the zone it is already framed
    // on. Leave previousPromptCodeRef untouched so the zoom still follows the
    // prompt once the reveal is dismissed.
    if (choiceFeedback) return;

    if (
      autoZoomEnabled &&
      !showRecap &&
      promptCode &&
      promptCode !== previousPromptCodeRef.current
    ) {
      // Auto-zoom follows the prompt: when it advances (e.g. via Tab/skip),
      // re-center the map onto the new target zone.
      focusNextRemainingZone();
    }

    previousPromptCodeRef.current = promptCode;
  }, [autoZoomEnabled, choiceFeedback, focusNextRemainingZone, mode, promptCode, showRecap]);

  useLayoutEffect(() => {
    if (!showRecap || !focusedCode) return;

    scrollRecapRowIntoView(focusedCode);
    // Keep DOM focus on the selected row so a click never leaves a stale focus
    // outline on a row that is no longer selected.
    recapRowRefs.current.get(focusedCode)?.focus({ preventScroll: true });
  }, [focusedCode, recapRowKey, scrollRecapRowIntoView, showRecap]);

  // Recap keyboard: up/down to move the selected zone, 0-3 to grade it.
  useEffect(() => {
    if (!showRecap || recapRows.length === 0) return undefined;

    function handleRecapKeyDown(event) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const currentIndex = recapRows.findIndex(row => row.item.code === focusedCode);
        const baseIndex = currentIndex === -1 ? (delta === 1 ? -1 : 0) : currentIndex;
        const nextIndex = Math.min(
          recapRows.length - 1,
          Math.max(0, baseIndex + delta)
        );
        const nextCode = recapRows[nextIndex]?.item.code;

        // selectRecapZone zooms the left map preview onto the newly selected
        // zone, unless the recap "Zoom auto" toggle is off.
        if (nextCode) selectRecapZone(nextCode);
        return;
      }

      if (!showQualityControls) return;

      // Accept the character (0-3) or the physical key, so the shortcut works
      // on AZERTY layouts where the top-row digits need Shift.
      const quality = eventDigit(event, { min: 0, max: 3 });

      if (quality === null) return;

      const focusedRow = recapRows.find(row => row.item.code === focusedCode);
      if (!focusedRow) return;

      event.preventDefault();
      setQuality(focusedRow.item.question_id, quality);
    }

    window.addEventListener("keydown", handleRecapKeyDown);
    return () => window.removeEventListener("keydown", handleRecapKeyDown);
  }, [showRecap, recapRows, focusedCode, selectRecapZone, setQuality, showQualityControls]);

  return (
    <>
      <div
        data-map-review-shell
        style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: "18px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          height: fillAvailableHeight ? "100%" : undefined,
          minHeight: fillAvailableHeight ? 0 : undefined,
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          ...fadeInStyle
        }}
      >

        {/* HEADER */}
        <div
          data-map-review-header
          style={{
            padding: fillAvailableHeight ? "8px 12px 9px" : "22px 24px 18px",
            borderBottom: "1px solid #262626",
            flexShrink: 0,
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "20px",
              marginBottom: fillAvailableHeight ? "6px" : "16px",
              position: "relative"
            }}
          >
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              {!fillAvailableHeight && (
                <>
                  <div style={typeBadgeStyle}>
                    MAP · {mapModeLabels[mode]}
                  </div>

                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "12px",
                      marginTop: "14px",
                      minWidth: 0
                    }}
                  >
                    <div
                      style={{
                        color: "#f3f3f3",
                        fontSize: "28px",
                        fontWeight: "700",
                        lineHeight: 1.15,
                        minWidth: 0
                      }}
                    >
                      {group.name || group.media}
                    </div>

                    {showTrainingTimer && (
                      <TrainingTimerPanel
                        elapsedMs={trainingElapsedMs}
                        bestTimeMs={trainingBestTimeMs}
                      />
                    )}
                  </div>
                </>
              )}
            </div>

            <div
              style={{
                minWidth: "90px",
                textAlign: "right"
              }}
            >
              <div
                style={{
                  fontSize: fillAvailableHeight ? "22px" : "28px",
                  fontWeight: "700",
                  color: "#fff"
                }}
              >
                {foundQuestionIds.length}
                <span
                  style={{
                    color: "#666",
                    fontSize: "18px",
                    marginLeft: "4px"
                  }}
                >
                  / {reviewZones.length}
                </span>
              </div>

              <div
                style={{
                  fontSize: "12px",
                  color: "#777",
                  marginTop: "2px"
                }}
              >
                zones trouvées
              </div>
            </div>
          </div>

          <div
            aria-label="Avancement"
            aria-valuemax={reviewZones.length}
            aria-valuemin={0}
            aria-valuenow={completedQuestionCount}
            role="progressbar"
            style={{
              background: "linear-gradient(180deg, #0d0d0d, #141414)",
              border: "1px solid #2a2a2a",
              boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.55)",
              borderRadius: "999px",
              height: "10px",
              overflow: "hidden",
              position: "relative"
            }}
          >
            <div
              style={{
                display: "flex",
                height: "100%",
                width: "100%"
              }}
            >
              <div
                data-map-progress-correct
                style={{
                  background: "linear-gradient(90deg, #2563eb, #38bdf8)",
                  boxShadow: correctProgressPercent > 0
                    ? "0 0 14px rgba(56, 189, 248, 0.22)"
                    : "none",
                  height: "100%",
                  transition: "width 0.22s ease",
                  width: `${correctProgressPercent}%`
                }}
              />
              <div
                data-map-progress-wrong
                style={{
                  background: [
                    "repeating-linear-gradient(135deg, rgba(17, 24, 39, 0.34) 0 4px, rgba(17, 24, 39, 0) 4px 8px)",
                    "linear-gradient(90deg, #f59e0b, #f97316)"
                  ].join(", "),
                  boxShadow: wrongProgressPercent > 0
                    ? "0 0 14px rgba(245, 158, 11, 0.24)"
                    : "none",
                  height: "100%",
                  transition: "width 0.22s ease",
                  width: `${wrongProgressPercent}%`
                }}
              />
            </div>
          </div>

          <div style={{ color: "#777", display: "flex", fontSize: "12px", justifyContent: "space-between", marginTop: "8px" }}>
            <span>{remainingZones.length} restantes</span>
            <span>{showRecap ? "Résultat" : "En cours"}</span>
          </div>
        </div>

        {/* MAP */}
        <div
          style={{
            borderBottom: "1px solid #262626",
            display: fillAvailableHeight ? "flex" : undefined,
            flex: fillAvailableHeight ? "1 1 auto" : undefined,
            flexDirection: fillAvailableHeight ? "column" : undefined,
            minHeight: fillAvailableHeight ? 0 : undefined,
            padding: fillAvailableHeight ? "12px 16px" : "18px"
          }}
        >
          <div
            onMouseDownCapture={handleActiveMapMouseDown}
            style={{
              ...activeMapPanelStyle,
              ...(fillAvailableHeight
                ? {
                    flex: "1 1 auto",
                    height: "auto",
                    minHeight: "260px"
                  }
                : {})
            }}
          >
            <SvgMap
              svgPath={resolveMediaUrl(group.media)}
              mapManifest={group.map || group.data?.map}
              found={foundCodes}
              missed={activeMissedCodes}
              dueItems={dueCodes}
              flashCodes={flashCodes}
              clickableCodes={activeMapClickableCodes}
              focusCode={activeMapFocusCode}
              focusVersion={focusVersion}
              selected={selectedCode || undefined}
              zoneLabels={foundZoneLabels}
              zoomDirection={activeMapZoom.direction}
              zoomVersion={activeMapZoom.version}
              onSelect={handleActiveMapSelect}
              onGeometryLoaded={handleMapGeometryLoaded}
            />
            {showAutoZoomToggle && (
              <button
                type="button"
                aria-label={autoZoomEnabled
                  ? "Désactiver le zoom automatique"
                  : "Activer le zoom automatique"}
                aria-pressed={autoZoomEnabled}
                onClick={toggleAutoZoom}
                onMouseDown={(event) => event.preventDefault()}
                style={{
                  ...autoZoomToggleStyle,
                  ...(autoZoomEnabled ? autoZoomToggleOnStyle : autoZoomToggleOffStyle)
                }}
              >
                Zoom auto
              </button>
            )}
            {showClickRating && clickRatingItem && (
              <div style={inlineRatingOverlayStyle}>
                <div data-map-click-rating style={mapInlineRatingPanelStyle}>
                  <div style={typedRatingCopyStyle}>
                    <span style={typedRatingKickerStyle}>Qualité</span>
                    <span style={typedRatingAnswerStyle}>{clickRatingItem.label || "Zone"}</span>
                  </div>
                  <div style={typedRatingControlsStyle}>
                    {clickRatingOptions.map(option => {
                      const interval = clickRatingItemRelearning
                        ? clickRatingItem.relearning_interval
                        : clickRatingItem.projected_intervals?.[option.value];

                      return (
                        <button
                          key={option.value}
                          type="button"
                          data-map-click-quality={option.value}
                          disabled={clickRatingFeedback.rated}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => rateClickAnswer(option.value)}
                          style={{
                            ...typedRatingButtonStyle,
                            animation: clickRatingFeedback.ratedQuality === option.value
                              ? qualityPickAnimation(option.value)
                              : undefined
                          }}
                        >
                          <span aria-hidden="true" style={choiceKeyBadgeStyle}>
                            {option.value}
                          </span>
                          <span>{option.title}</span>
                          {Number(interval) > 0 && (
                            <span style={typedRatingIntervalStyle}>≈ {interval} j</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* INPUT */}
        <div
          style={{
            flexShrink: 0,
            padding: fillAvailableHeight ? "12px 16px 14px" : "20px 24px"
          }}
        >
          {showPromptPanel && (
            <div style={promptPanelStyle}>
              {!fillAvailableHeight && (
                <div style={promptKickerStyle}>
                  {mode === MAP_MODE_CLICK_PROMPT
                    ? "Zone demandée"
                    : mode === MAP_MODE_MULTIPLE_CHOICE
                      ? "Zone surlignée"
                      : "Nom attendu"}
                </div>
              )}
              <div style={promptValueStyle}>
                {mode === MAP_MODE_CLICK_PROMPT ? promptLabel : "Zone surlignée"}
              </div>
            </div>
          )}

          {showTextInput && (
            <div data-map-typed-input-area style={typedInputAreaStyle}>
              <input
                autoFocus
                className={wrongInputShakeId ? "review-input-shake" : undefined}
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                readOnly={showTypedRating}
                onKeyDown={(e) => {
                  if (showTypedRating) {
                    const quality = eventDigit(e, { min: 1, max: 3 });

                    if (quality !== null) {
                      e.preventDefault();
                      rateTypedAnswer(quality);
                      inputRef.current?.focus({ preventScroll: true });
                    } else if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      rateTypedAnswer(typedRatingDefaultQuality);
                      inputRef.current?.focus({ preventScroll: true });
                    }
                    return;
                  }

                  if (e.key === "Tab" && mode === MAP_MODE_TYPE_PROMPT) {
                    e.preventDefault();
                    selectNextPrompt(e.shiftKey ? -1 : 1);
                    inputRef.current?.focus({ preventScroll: true });
                    return;
                  }

                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    const matched = handleSubmit();
                    if (matched === false) {
                      setWrongInputShakeId(Date.now());
                    }
                    if (matched === false || matched === "duplicate") {
                      e.currentTarget.select();
                    }
                  }
                }}
                placeholder={mode === MAP_MODE_TYPE_PROMPT ? "Nom de la zone..." : "Tape une zone..."}
                style={{
                  ...inputStyle,
                  border: feedbackTone === "incorrect"
                    ? "1px solid rgba(248, 113, 113, 0.9)"
                    : feedbackTone === "correct"
                      ? "1px solid rgba(134, 239, 172, 0.85)"
                      : feedbackTone === "duplicate"
                        ? "1px solid rgba(250, 204, 21, 0.85)"
                        : inputStyle.border,
                  boxShadow: feedbackTone === "incorrect"
                    ? "0 0 0 4px rgba(248, 113, 113, 0.1)"
                    : feedbackTone === "correct"
                      ? "0 0 0 4px rgba(134, 239, 172, 0.1)"
                      : feedbackTone === "duplicate"
                        ? "0 0 0 4px rgba(250, 204, 21, 0.1)"
                        : "none",
                  minHeight: "54px",
                  transition: "border 0.18s ease, box-shadow 0.18s ease"
                }}
              />
              {showTypedRating && typedRatingItem && (
                <div style={typedInputRatingOverlayStyle}>
                  <div data-map-typed-rating style={mapTypedInputRatingPanelStyle}>
                    <div style={typedInputRatingCopyStyle}>
                      <span style={typedRatingKickerStyle}>Qualité</span>
                      <span style={typedRatingAnswerStyle}>{typedRatingItem.label || "Zone"}</span>
                    </div>
                    <div style={typedInputRatingControlsStyle}>
                      {typedRatingOptions.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          data-map-typed-quality={option.value}
                          disabled={typedRatingFeedback.rated}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            rateTypedAnswer(option.value);
                            inputRef.current?.focus({ preventScroll: true });
                          }}
                          style={{
                            ...typedInputRatingButtonStyle,
                            animation: typedRatingFeedback.ratedQuality === option.value
                              ? qualityPickAnimation(option.value)
                              : undefined
                          }}
                        >
                          <span aria-hidden="true" style={choiceKeyBadgeStyle}>
                            {option.value}
                          </span>
                          <span>{option.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === MAP_MODE_MULTIPLE_CHOICE && !showRecap && (
            // Answering keeps the same four slots: the decoys drop out, the quality
            // buttons take slots 1, 2, and 3, and the correct zone slides to slot 4.
            // Nothing grows, so the map above never resizes.
            <div
              ref={choiceGridRef}
              data-map-choice-grid
              style={{
                ...choiceGridStyle,
                ...(centerReveal
                  ? {
                    gridTemplateColumns: `repeat(${revealedChoices.length}, minmax(160px, 260px))`,
                    justifyContent: "center"
                  }
                  : null)
              }}
            >
              {revealedChoices.map((option, index) => (
                <div
                  key={option.question_id}
                  data-flip-key={`${choiceScope}:${option.question_id}`}
                  style={{
                    ...choiceSlotStyle,
                    ...(choiceFeedback?.isCorrect
                      ? { order: correctChoiceRevealOrder }
                      : null)
                  }}
                >
                  {(() => {
                    const feedbackLabel = choiceFeedbackLabel(option, choiceFeedback);
                    const optionLabel = option.label || "Zone";

                    return (
                  <button
                    type="button"
                    aria-label={`Choix ${index + 1} : ${optionLabel}${
                      feedbackLabel ? `, ${feedbackLabel}` : ""
                    }`}
                    aria-pressed={option.question_id === choiceFeedback?.selectedQuestionId}
                    data-map-choice-feedback={choiceFeedbackState(option, choiceFeedback)}
                    disabled={Boolean(choiceFeedback)}
                    onClick={() => handleChoiceSelect(option.question_id)}
                    style={{
                      ...getChoiceButtonStyle(option, choiceFeedback),
                      flex: 1,
                      width: "100%"
                    }}
                  >
                    <span style={{ alignItems: "center", display: "flex", gap: "8px", minWidth: 0 }}>
                      {!choiceFeedback && index < 9 && (
                        <span aria-hidden="true" data-map-choice-key style={choiceKeyBadgeStyle}>
                          {index + 1}
                        </span>
                      )}
                      <span>{optionLabel}</span>
                    </span>
                    {feedbackLabel && (
                      <span style={choiceFeedbackLabelStyle}>
                        {feedbackLabel}
                      </span>
                    )}
                  </button>
                    );
                  })()}
                </div>
              ))}

              {showChoiceRating && (choiceFeedback.isCorrect
                ? (() => {
                  const correctChoice = revealedChoices.find(
                    choice => choice.question_id === correctChoiceId
                  );
                  const correctChoiceRelearning = Boolean(
                    correctChoice && isRelearningGroupItem(group, correctChoice)
                  );
                  const ratingOptions = correctChoiceRelearning
                    ? acquisOnlyOptions
                    : choiceQualityOptions;

                  return ratingOptions.map(option => {
                    // A relearning retry never re-grades FSRS: whichever grade is
                    // picked, the zone lands on the same already-frozen interval.
                    const interval = correctChoiceRelearning
                      ? correctChoice?.relearning_interval
                      : correctChoice?.projected_intervals?.[option.value];

                    return (
                      <button
                        key={option.value}
                        type="button"
                        data-map-choice-quality={option.value}
                        disabled={choiceFeedback.rated}
                        onClick={() => rateChoice(option.value)}
                        style={{
                          ...choiceQualityButtonStyle(),
                          order: option.value,
                          animation: choiceFeedback.ratedQuality === option.value
                            ? qualityPickAnimation(option.value)
                            : undefined
                        }}
                      >
                        <span aria-hidden="true" style={choiceKeyBadgeStyle}>{option.value}</span>
                        <span>{option.icon} {option.title}</span>
                        {Number(interval) > 0 && (
                          <span style={{ opacity: 0.7 }}>≈ {interval} j</span>
                        )}
                      </button>
                    );
                  });
                })()
                : (
                  <button
                    type="button"
                    data-map-choice-continue
                    disabled={choiceFeedback.rated}
                    onClick={() => rateChoice()}
                    style={choiceContinueButtonStyle}
                  >
                    <span aria-hidden="true" style={choiceKeyBadgeStyle}>Entrée</span>
                    Continuer →
                  </button>
                ))}
            </div>
          )}

          {/* FOOTER */}
          {!showRecap && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "18px",
                marginTop: "24px",
                flexWrap: "wrap"
              }}
            >
              <div
                style={{
	                  color: feedbackTone === "incorrect"
	                    ? "#fca5a5"
	                    : feedbackTone === "correct"
	                      ? "#86efac"
	                      : feedbackTone === "duplicate"
	                        ? "#facc15"
	                        : "#666",
                  fontSize: "13px",
                  transition: "color 0.18s ease"
                }}
              >
                {feedbackCopy}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                  marginLeft: "auto"
                }}
              >
                {(mode === MAP_MODE_TYPE_ALL || mode === MAP_MODE_MULTIPLE_CHOICE) && (
                  <button
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleZoomRemaining}
                    disabled={remainingZones.length === 0}
                    style={{
                      ...buttonStyle,
                      cursor: remainingZones.length === 0 ? "not-allowed" : "pointer",
                      opacity: remainingZones.length === 0 ? 0.55 : 1
                    }}
                  >
                    {mode === MAP_MODE_TYPE_ALL ? "Zone suivante" : "Recentrer"}
                  </button>
                )}

                {canSkipPrompt && (
                  <button
                    type="button"
                    onClick={skipCurrentPrompt}
                    disabled={remainingZones.length === 0}
                    style={{
                      ...buttonStyle,
                      cursor: remainingZones.length === 0 ? "not-allowed" : "pointer",
                      opacity: remainingZones.length === 0 ? 0.55 : 1
                    }}
                  >
                    Passer
                  </button>
                )}

                <button
                  type="button"
                  aria-label="Abandonner la carte"
                  disabled={!canFinishReview}
                  onClick={finishMap}
                  style={{
                    ...abandonButtonStyle,
                    cursor: canFinishReview ? "pointer" : "not-allowed",
                    opacity: canFinishReview ? 1 : 0.55
                  }}
                >
                  Abandonner
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RECAP */}
      {showRecap && (
        <div style={overlayStyle}>

          <div className="app-scrollbar" style={recapCardStyle}>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "22px"
              }}
            >
              <div>
                <div style={typeBadgeStyle}>
                  🗺 MAP RESULT
                </div>

                <div
                  style={{
                    marginTop: "12px",
                    fontSize: "26px",
                    fontWeight: "700"
                  }}
                >
                  Résultat
                </div>

                <div style={recapKeyboardHintStyle}>
                  ↑/↓ pour naviguer
                  {showQualityControls ? " · 0-3 pour noter" : ""}
                </div>
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={sendResult}
                style={{
                  ...successButton,
                  cursor: submitting ? "default" : successButton.cursor,
                  opacity: submitting ? 0.72 : 1
                }}
              >
                {submitting
                  ? "Enregistrement..."
                  : showQualityControls ? "Valider" : "Continuer"}
              </button>
            </div>

            {submitError && (
              <div role="alert" style={recapErrorStyle}>
                {submitError}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: recapUnansweredCount > 0
                  ? "repeat(4, minmax(0, 1fr))"
                  : "repeat(3, minmax(0, 1fr))",
                gap: "10px",
                marginBottom: "18px"
              }}
            >
              <div style={recapStatStyle}>
                <div style={recapStatValueStyle}>{recapSuccessRate}%</div>
                <div style={recapStatLabelStyle}>réussite</div>
              </div>

              <div style={recapStatStyle}>
                <div style={recapStatValueStyle}>
                  {recapSuccessCount}
                  <span style={recapStatMutedStyle}> / {reviewZones.length}</span>
                </div>
                <div style={recapStatLabelStyle}>trouvées</div>
              </div>

              <div style={recapStatStyle}>
                <div style={recapStatValueStyle}>{recapMissCount}</div>
                <div style={recapStatLabelStyle}>à revoir</div>
              </div>

              {recapUnansweredCount > 0 && (
                <div style={recapStatStyle}>
                  <div style={recapStatValueStyle}>{recapUnansweredCount}</div>
                  <div style={recapStatLabelStyle}>non répondu</div>
                </div>
              )}
            </div>

            <div className="map-recap-content">
              <div style={recapMapPanelStyle}>
                <SvgMap
                  svgPath={resolveMediaUrl(group.media)}
                  mapManifest={group.map || group.data?.map}
                  found={foundCodes}
                  missed={missedCodes}
                  dueItems={[]}
                  selected={focusedCode}
                  focusCode={recapFocusCode}
                  focusVersion={recapFocusVersion}
                  zoneLabels={recapZoneLabels}
                  zoomDirection={recapMapZoom.direction}
                  zoomVersion={recapMapZoom.version}
                  onSelect={selectRecapCode}
                />
                <button
                  type="button"
                  data-map-recap-auto-zoom={recapAutoZoomEnabled ? "on" : "off"}
                  aria-label={recapAutoZoomEnabled
                    ? "Désactiver le zoom automatique"
                    : "Activer le zoom automatique"}
                  aria-pressed={recapAutoZoomEnabled}
                  onClick={toggleRecapAutoZoom}
                  onMouseDown={(event) => event.preventDefault()}
                  style={{
                    ...autoZoomToggleStyle,
                    ...(recapAutoZoomEnabled
                      ? autoZoomToggleOnStyle
                      : autoZoomToggleOffStyle)
                  }}
                >
                  Zoom auto
                </button>
              </div>

              <div style={recapTableStyle}>
                <div
                  className="map-recap-table-header"
                  style={{
                    ...recapTableHeaderStyle,
                    gridTemplateColumns: recapGridColumns
                  }}
                >
                  {visibleRecapHeaderColumns.map(({ key, label }) => {
                    const isActive = recapSort.key === key;
                    const nextDirection = isActive && recapSort.direction === "asc"
                      ? "desc"
                      : "asc";

                    return (
                      <button
                        key={key}
                        type="button"
                        aria-label={`${label} : trier ${
                          nextDirection === "asc" ? "croissant" : "décroissant"
                        }`}
                        aria-pressed={isActive}
                        onClick={() => toggleRecapSort(key)}
                        style={{
                          ...recapHeaderButtonStyle,
                          ...(isActive ? recapHeaderButtonActiveStyle : {})
                        }}
                      >
                        <span style={recapHeaderLabelStyle}>{label}</span>
                        <span
                          aria-hidden="true"
                          style={{
                            ...recapHeaderSortIndicatorStyle,
                            opacity: isActive ? 1 : 0
                          }}
                        >
                          {recapSort.direction === "asc" ? "↑" : "↓"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  ref={recapTableBodyRef}
                  className="app-scrollbar"
                  style={recapTableBodyStyle}
                >
                  {showQualityControls && foundQuestionIds.length > 0 && (
                    <div className="map-recap-bulk-row" style={recapBulkQualityStyle}>
                      <div style={recapBulkQualityTextStyle}>
                        <div style={recapBulkQualityTitleStyle}>
                          Zones trouvées
                        </div>
                        <div style={recapBulkQualityMetaStyle}>
                          {foundQuestionIds.length} qualité{foundQuestionIds.length > 1 ? "s" : ""}
                        </div>
                      </div>

                      <div style={recapBulkQualityControlsStyle}>
                        {bulkQualityOptions.map(({ value: qVal, icon, title }) => {
                          const disabled = !allFoundRelearning && qVal === 0;
                          const selected = !disabled && foundBulkQuality === qVal;
                          const activeStyle = qualityButtonStyles[qVal];
                          const buttonTitle = disabled
                            ? "Faux indisponible pour les zones trouvées"
                            : `Appliquer aux zones trouvées : ${title}`;

                          return (
                            <button
                              key={qVal}
                              type="button"
                              aria-label={buttonTitle}
                              aria-pressed={selected}
                              disabled={disabled}
                              onClick={() => {
                                setFoundZoneQualities(qVal);
                                flashRecapQuality("bulk", qVal);
                              }}
                              style={{
                                ...recapQualityButtonStyle,
                                cursor: disabled ? "not-allowed" : "pointer",
                                border: selected
                                  ? activeStyle.border
                                  : disabled
                                    ? "1px solid #2d2d2d"
                                    : "1px solid #333",
                                background: selected
                                  ? activeStyle.background
                                  : disabled
                                    ? "#181818"
                                    : "#222",
                                color: selected
                                  ? activeStyle.color
                                  : disabled
                                    ? "#555"
                                    : "#999",
                                opacity: disabled ? 0.65 : 1,
                                animation: isRecapFlashing("bulk", qVal)
                                  ? qualityPickAnimation(qVal)
                                  : undefined
                              }}
                            >
                              {icon}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {recapRows.map((row, index) => {
                    const { item, historyStats, isFound, isUnanswered, canBeUnanswered } = row;
                    const showSection =
                      showRecapSections &&
                      (index === 0 || recapRows[index - 1].isFound !== isFound);
                    const isFocused = focusedCode === item.code;
                    const rowRelearning = isRelearningGroupItem(group, item);
                    const selectedQuality = qualityByQuestionId[item.question_id]
                      ?? (isFound ? (rowRelearning ? GOT_IT_QUALITY : 2) : 0);
                    const recapStatusLabel = isUnanswered
                      ? "Non répondu"
                      : isFound ? "Trouvée" : "À revoir";
                    // A relearning zone never re-grades FSRS: Encore and Acquis
                    // lead to the same already-frozen interval, so it stays fixed
                    // no matter which one is selected.
                    const projectedInterval = isUnanswered
                      ? null
                      : rowRelearning
                        ? (item.relearning_interval ?? 0)
                        : (
                          item.projected_intervals?.[selectedQuality] ??
                          item.progress?.interval ??
                          0
                        );
                    // A relearning zone collapses to the binary Encore/Acquis
                    // choice; the grade is never re-applied to FSRS.
                    const rowQualityOptions = rowRelearning
                      ? relearningQualityOptions
                      : canBeUnanswered
                        ? [unansweredQualityOption, ...qualityOptions]
                        : qualityOptions;

                    return (
                      <Fragment key={item.question_id}>
                        {showSection && (
                          <div
                            style={{
                              ...recapSectionStyle,
                              ...(isFound
                                ? recapSectionFoundStyle
                                : recapSectionMissedStyle)
                            }}
                          >
                            {isFound ? "Trouvées" : "À revoir"}
                          </div>
                        )}

                        <div
                          className="map-recap-row"
                          data-map-recap-row={
                            isUnanswered ? "unanswered" : isFound ? "found" : "missed"
                          }
                          ref={setRecapRowRef(item.code)}
                          role="button"
                          tabIndex={0}
                          onClick={() => selectRecapZone(item.code)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) {
                              return;
                            }

                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              selectRecapZone(item.code);
                            }
                          }}
                          style={{
                            ...recapRowStyle,
                            gridTemplateColumns: recapGridColumns,
                            ...(isUnanswered
                              ? recapRowUnansweredStyle
                              : isFound ? recapRowFoundStyle : recapRowMissedStyle),
                            ...(isFocused ? recapRowFocusedStyle : {}),
                            borderLeft: isFound
                              ? "3px solid #38bdf8"
                              : isUnanswered
                                ? "3px solid #737373"
                                : "3px solid #f59e0b"
                          }}
                        >
                          <div style={recapAnswerCellStyle}>
                            <span
                              data-map-recap-status={
                                isUnanswered ? "unanswered" : isFound ? "found" : "missed"
                              }
                              style={{
                                ...recapStatusChipStyle,
                                ...(isUnanswered
                                  ? recapStatusChipUnansweredStyle
                                  : isFound
                                    ? recapStatusChipFoundStyle
                                    : recapStatusChipMissedStyle)
                              }}
                            >
                              {recapStatusLabel}
                            </span>
                            <span style={recapAnswerTextStyle}>
                              {item.label}
                            </span>
                          </div>

                          {showQualityControls && (
                          <div style={recapMetricCellStyle}>
                            {historyStats.reviews > 0 ? (
                              <>
                                <span style={zoneHistoryRateStyle}>
                                  {historyStats.successRate}%
                                </span>
                                <span style={zoneHistoryMetaStyle}>
                                  {historyStats.reviews} revue{historyStats.reviews > 1 ? "s" : ""}
                                </span>
                              </>
                            ) : (
                              <span style={zoneHistoryMetaStyle}>Nouveau</span>
                            )}
                          </div>
                          )}

                          {showQualityControls && (
                          <div style={recapIntervalCellStyle}>
                            {isUnanswered ? "—" : (
                              <>
                                {projectedInterval}
                                <span style={recapIntervalUnitStyle}> j</span>
                              </>
                            )}
                          </div>
                          )}

                          {showQualityControls && (
                          <div style={recapQualityCellStyle}>
                            {rowQualityOptions.map(({ value: qVal, icon, title }) => {
                              const selected = qualityByQuestionId[item.question_id] === qVal;
                              const activeStyle = qualityButtonStyles[qVal] ||
                                qualityButtonStyles[MAP_RECAP_UNANSWERED];

                              return (
                                <button
                                  key={qVal}
                                  type="button"
                                  aria-label={`${item.label || "Zone"} : ${title}`}
                                  aria-pressed={selected}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setQuality(item.question_id, qVal);
                                    flashRecapQuality(item.question_id, qVal);
                                  }}
                                  style={{
                                    ...recapQualityButtonStyle,
                                    cursor: "pointer",
                                    border: selected
                                      ? activeStyle.border
                                      : "1px solid #333",
                                    background: selected
                                      ? activeStyle.background
                                      : "#222",
                                    color: selected
                                      ? activeStyle.color
                                      : "#999",
                                    animation: isRecapFlashing(item.question_id, qVal)
                                      ? qualityPickAnimation(qVal)
                                      : undefined
                                  }}
                                >
                                  {icon}
                                </button>
                              );
                            })}
                          </div>
                          )}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>

        </div>
      )}
    </>
  );
}

const activeMapPanelStyle = {
  background: "#111",
  borderRadius: "14px",
  overflow: "hidden",
  border: "1px solid #262626",
  height: "clamp(300px, 55vh, 480px)",
  position: "relative"
};

const autoZoomToggleStyle = {
  alignItems: "center",
  borderRadius: "999px",
  boxShadow: "0 10px 24px rgba(0, 0, 0, 0.34)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "12px",
  fontWeight: "800",
  height: "34px",
  justifyContent: "center",
  lineHeight: "14px",
  minWidth: "92px",
  padding: "0 12px",
  position: "absolute",
  right: "10px",
  top: "10px",
  zIndex: 7
};

const autoZoomToggleOnStyle = {
  background: "rgba(14, 60, 46, 0.92)",
  border: "1px solid rgba(126, 226, 168, 0.64)",
  color: "#d7f5df"
};

const autoZoomToggleOffStyle = {
  background: "rgba(24, 24, 24, 0.92)",
  border: "1px solid rgba(148, 163, 184, 0.42)",
  color: "#cbd5e1"
};

const promptPanelStyle = {
  background: "#121212",
  border: "1px solid #2a2a2a",
  borderRadius: "12px",
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  marginBottom: "14px",
  padding: "14px 16px"
};

const promptKickerStyle = {
  color: "#777",
  fontSize: "11px",
  fontWeight: "800",
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};

const promptValueStyle = {
  color: "#f3f3f3",
  fontSize: "20px",
  fontWeight: "800",
  lineHeight: 1.15
};

const choiceGridStyle = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))"
};


// Small keycap hint shown on each choice so the number shortcut is discoverable.
const choiceKeyBadgeStyle = {
  alignItems: "center",
  background: "#0d0d0d",
  border: "1px solid #363636",
  borderRadius: "5px",
  color: "#8a8a8a",
  display: "inline-flex",
  flex: "0 0 auto",
  fontSize: "10px",
  fontWeight: 800,
  height: "18px",
  justifyContent: "center",
  lineHeight: 1,
  minWidth: "18px",
  padding: "0 5px"
};

function isEditableTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

function mapZoomDirectionFromKey(event) {
  if (
    event.key === "+" ||
    event.code === "NumpadAdd"
  ) {
    return 1;
  }

  if (
    event.key === "-" ||
    event.key === "−" ||
    event.code === "Minus" ||
    event.code === "NumpadSubtract"
  ) {
    return -1;
  }

  return 0;
}

const choiceButtonStyle = {
  ...buttonStyle,
  alignItems: "center",
  background: "#181818",
  display: "flex",
  gap: "10px",
  justifyContent: "space-between",
  minHeight: "54px",
  textAlign: "left"
};

// Fills the two slots freed by the decoys after a wrong pick.
const choiceContinueButtonStyle = {
  ...choiceButtonStyle,
  animation: "fadeIn 0.26s ease 0.3s both",
  color: "#c9c9c9",
  gap: "8px",
  gridColumn: "span 2",
  justifyContent: "center"
};

const choiceFeedbackLabelStyle = {
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: "999px",
  flex: "0 0 auto",
  fontSize: "11px",
  fontWeight: 900,
  padding: "3px 8px",
  textTransform: "uppercase"
};

const typedRatingPanelStyle = {
  alignItems: "center",
  background: "#121212",
  border: "1px solid #2a2a2a",
  borderRadius: "12px",
  display: "flex",
  flexWrap: "wrap",
  gap: "10px 14px",
  justifyContent: "space-between",
  marginTop: "10px",
  padding: "10px 12px"
};

const typedInputAreaStyle = {
  minHeight: "54px",
  position: "relative"
};

const typedInputRatingOverlayStyle = {
  inset: 0,
  pointerEvents: "none",
  position: "absolute",
  zIndex: 4
};

const inlineRatingOverlayStyle = {
  bottom: "10px",
  boxSizing: "border-box",
  left: "10px",
  pointerEvents: "none",
  position: "absolute",
  right: "10px",
  zIndex: 8
};

const mapInlineRatingPanelStyle = {
  ...typedRatingPanelStyle,
  animation: `fadeIn 0.26s ease ${choiceRevealDelay} both`,
  background: "rgba(18, 18, 18, 0.94)",
  boxShadow: "0 14px 32px rgba(0, 0, 0, 0.38)",
  marginTop: 0,
  pointerEvents: "auto"
};

const mapTypedInputRatingPanelStyle = {
  ...typedRatingPanelStyle,
  animation: `fadeIn 0.26s ease ${choiceRevealDelay} both`,
  background: "rgba(18, 18, 18, 0.98)",
  boxShadow: "0 10px 24px rgba(0, 0, 0, 0.32)",
  boxSizing: "border-box",
  gap: "8px 10px",
  height: "100%",
  marginTop: 0,
  padding: "7px 9px",
  pointerEvents: "auto"
};

const typedRatingCopyStyle = {
  alignItems: "center",
  display: "flex",
  flex: "1 1 180px",
  gap: "8px",
  minWidth: 0
};

const typedInputRatingCopyStyle = {
  ...typedRatingCopyStyle,
  flex: "1 1 140px"
};

const typedRatingKickerStyle = {
  color: "#777",
  fontSize: "11px",
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};

const typedRatingAnswerStyle = {
  color: "#dbeafe",
  fontSize: "13px",
  fontWeight: 800,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const typedRatingControlsStyle = {
  display: "flex",
  flex: "0 0 auto",
  flexWrap: "wrap",
  gap: "8px",
  justifyContent: "flex-end"
};

const typedInputRatingControlsStyle = {
  ...typedRatingControlsStyle,
  flexWrap: "nowrap"
};

const typedRatingButtonStyle = {
  ...buttonStyle,
  alignItems: "center",
  background: "#181818",
  display: "inline-flex",
  gap: "8px",
  minHeight: "38px",
  padding: "8px 11px"
};

const typedInputRatingButtonStyle = {
  ...typedRatingButtonStyle,
  minHeight: "34px",
  padding: "6px 9px",
  whiteSpace: "nowrap"
};

const typedRatingIntervalStyle = {
  color: "#8a8a8a",
  fontSize: "12px",
  fontWeight: 700
};

const overlayStyle = {
  position: "fixed",
  inset: "var(--shell-top, 0px) 0 0 0",
  background: "rgba(0,0,0,0.75)",
  backdropFilter: "blur(6px)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "20px",
  zIndex: 1000
};

const recapCardStyle = {
  width: "100%",
  maxWidth: "1460px",
  maxHeight: "100%",
  overflow: "auto",
  scrollbarGutter: "stable",
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  borderRadius: "18px",
  padding: "24px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)"
};

const recapKeyboardHintStyle = {
  color: "#666",
  fontSize: "12px",
  fontWeight: "600",
  marginTop: "6px"
};

const recapErrorStyle = {
  background: "rgba(127, 29, 29, 0.26)",
  border: "1px solid rgba(248, 113, 113, 0.45)",
  borderRadius: "10px",
  color: "#fecaca",
  fontSize: "13px",
  fontWeight: "700",
  marginBottom: "16px",
  padding: "10px 12px"
};

const recapStatStyle = {
  background: "#181818",
  border: "1px solid #262626",
  borderRadius: "12px",
  padding: "12px 14px",
  minWidth: 0
};

const recapStatValueStyle = {
  color: "#f3f3f3",
  fontSize: "22px",
  fontWeight: "700",
  lineHeight: "26px"
};

const recapStatMutedStyle = {
  color: "#666",
  fontSize: "14px",
  marginLeft: "3px"
};

const recapStatLabelStyle = {
  color: "#777",
  fontSize: "12px",
  marginTop: "3px"
};

const recapMapPanelStyle = {
  background: "#111",
  borderRadius: "14px",
  overflow: "hidden",
  border: "1px solid #262626",
  minHeight: "clamp(430px, 64vh, 780px)",
  position: "relative"
};

const recapTableStyle = {
  minWidth: 0,
  border: "1px solid #262626",
  borderRadius: "14px",
  overflow: "hidden",
  background: "#111"
};

const recapTableGridColumns = "minmax(150px, 1.35fr) 94px 86px 194px";
const recapTableGap = "10px";
const recapTablePadding = "10px 14px";
const recapStatusStripeBorder = "3px solid transparent";

const recapTableHeaderStyle = {
  display: "grid",
  gridTemplateColumns: recapTableGridColumns,
  gap: recapTableGap,
  alignItems: "center",
  padding: recapTablePadding,
  background: "#151515",
  borderBottom: "1px solid #262626",
  borderLeft: recapStatusStripeBorder,
  boxSizing: "border-box",
  color: "#777",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "left"
};

const recapHeaderButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: "5px",
  minWidth: 0,
  width: "100%",
  padding: 0,
  background: "transparent",
  border: 0,
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  fontWeight: "inherit",
  letterSpacing: "inherit",
  lineHeight: "16px",
  textAlign: "left",
  textTransform: "inherit"
};

const recapHeaderButtonActiveStyle = {
  color: "#e5e5e5"
};

const recapHeaderLabelStyle = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const recapHeaderSortIndicatorStyle = {
  flex: "0 0 10px",
  width: "10px",
  color: "#e5e5e5",
  fontSize: "12px",
  lineHeight: "12px",
  textAlign: "center"
};

const recapTableBodyStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "1px",
  maxHeight: "clamp(430px, 64vh, 780px)",
  overflow: "auto",
  scrollbarGutter: "stable",
  background: "#242424"
};

const recapSectionStyle = {
  padding: "10px 14px 8px",
  background: "#111",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "left"
};

const recapSectionFoundStyle = {
  color: "#7dd3fc"
};

const recapSectionMissedStyle = {
  color: "#fbbf24"
};

const recapBulkQualityStyle = {
  display: "grid",
  gridTemplateColumns: recapTableGridColumns,
  alignItems: "center",
  gap: recapTableGap,
  padding: recapTablePadding,
  background: "#111",
  borderLeft: recapStatusStripeBorder,
  boxSizing: "border-box"
};

const recapBulkQualityTextStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  gridColumn: "1 / -2",
  minWidth: 0
};

const recapBulkQualityTitleStyle = {
  color: "#e5e5e5",
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};

const recapBulkQualityMetaStyle = {
  color: "#777",
  fontSize: "11px",
  lineHeight: "15px"
};

const recapBulkQualityControlsStyle = {
  display: "flex",
  gap: "6px",
  flex: "0 0 auto"
};

const recapRowStyle = {
  display: "grid",
  gridTemplateColumns: recapTableGridColumns,
  gap: recapTableGap,
  alignItems: "center",
  width: "100%",
  minHeight: "58px",
  padding: recapTablePadding,
  background: "#181818",
  border: "0",
  borderLeft: recapStatusStripeBorder,
  borderRadius: 0,
  color: "#e5e5e5",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  boxSizing: "border-box",
  transition: "background 0.14s ease, box-shadow 0.14s ease"
};

const recapRowFoundStyle = {
  background: "linear-gradient(90deg, rgba(37, 99, 235, 0.14), #181818 46%)"
};

const recapRowMissedStyle = {
  background: [
    "repeating-linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0 5px, rgba(245, 158, 11, 0) 5px 10px)",
    "linear-gradient(90deg, rgba(245, 158, 11, 0.18), #181818 48%)"
  ].join(", ")
};

const recapRowUnansweredStyle = {
  background: "linear-gradient(90deg, rgba(115, 115, 115, 0.18), #181818 46%)"
};

const recapRowFocusedStyle = {
  boxShadow: "inset 0 0 0 1px rgba(243, 156, 18, 0.78)"
};

const recapAnswerCellStyle = {
  alignItems: "center",
  display: "flex",
  gap: "8px",
  minWidth: 0,
  color: "#f3f3f3"
};

const recapStatusChipStyle = {
  alignItems: "center",
  borderRadius: "999px",
  display: "inline-flex",
  flex: "0 0 auto",
  fontSize: "10px",
  fontWeight: "800",
  height: "22px",
  letterSpacing: "0.04em",
  lineHeight: "22px",
  padding: "0 8px",
  textTransform: "uppercase"
};

const recapStatusChipFoundStyle = {
  background: "rgba(37, 99, 235, 0.24)",
  border: "1px solid rgba(56, 189, 248, 0.62)",
  color: "#bae6fd"
};

const recapStatusChipMissedStyle = {
  background: [
    "repeating-linear-gradient(135deg, rgba(17, 24, 39, 0.3) 0 3px, rgba(17, 24, 39, 0) 3px 6px)",
    "rgba(245, 158, 11, 0.22)"
  ].join(", "),
  border: "1px solid rgba(251, 191, 36, 0.7)",
  color: "#fde68a"
};

const recapStatusChipUnansweredStyle = {
  background: "rgba(82, 82, 82, 0.24)",
  border: "1px solid rgba(163, 163, 163, 0.58)",
  color: "#d4d4d4"
};

const recapAnswerTextStyle = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: "650",
  color: "#f3f3f3"
};

const recapMetricCellStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  minWidth: 0,
  color: "#777",
  fontSize: "12px",
  lineHeight: "16px"
};

const recapIntervalCellStyle = {
  color: "#e5e5e5",
  fontSize: "18px",
  fontWeight: "700",
  whiteSpace: "nowrap"
};

const recapIntervalUnitStyle = {
  color: "#777",
  fontSize: "12px",
  fontWeight: "600"
};

const recapQualityCellStyle = {
  display: "flex",
  gap: "6px",
  justifyContent: "flex-start"
};

const recapQualityButtonStyle = {
  width: "32px",
  height: "34px",
  padding: 0,
  borderRadius: "9px",
  fontWeight: "600",
  lineHeight: "34px"
};

const zoneHistoryRateStyle = {
  color: "#e5e5e5",
  fontSize: "17px",
  fontWeight: "700",
  lineHeight: "20px"
};

const zoneHistoryMetaStyle = {
  color: "#777",
  fontSize: "11px",
  whiteSpace: "nowrap"
};

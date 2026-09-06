import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import RichText from "../../../shared/RichText";
import {
  normalizeTextMode,
  TEXT_MODE_MATCH
} from "../textModes";
import {
  GOT_IT_QUALITY,
  isRelearningGroupItem,
  partitionRelearningQualities,
  relearningQualityOptions
} from "../relearningGrades";
import { matchesAnswerValue } from "../answerPolicy";
import { eventDigit } from "../keyboardShortcuts";
import { clearGroupDraft, loadGroupDraft, saveGroupDraft } from "../groupAnswerDraft";
import { qualityPickAnimation } from "../../../shared/answerFeedback";
import { useQualityPickFlash, useQualityPickHold } from "../../../shared/useQualityPickHold";

const qualityOptions = [
  { value: 0, icon: "❌", title: "Faux" },
  { value: 1, icon: "😐", title: "Dur" },
  { value: 2, icon: "🙂", title: "Bon" },
  { value: 3, icon: "✅", title: "Facile" }
];

const qualityButtonColors = {
  0: { background: "#3a2420", border: "1px solid #6b2b31", color: "#ff8c94" },
  1: { background: "#3a3420", border: "1px solid #6f6434", color: "#f3d36a" },
  2: { background: "#20303a", border: "1px solid #345b7a", color: "#8fc7ff" },
  3: { background: "#203a2a", border: "1px solid #2c5c3e", color: "#7ee2a8" }
};

// Encore stays red like a fail; Acquis is green.
const relearningButtonColors = {
  0: { background: "#3a2420", border: "1px solid #6b2b31", color: "#ff8c94" },
  1: { background: "#203a2a", border: "1px solid #2c5c3e", color: "#7ee2a8" }
};

const typedQualityOptions = qualityOptions.filter(option => option.value > 0);

const acquisOnlyOptions = relearningQualityOptions.filter(
  option => option.value === GOT_IT_QUALITY
);

// One colour per matched pair, so crossing connector lines stay tellable apart.
const pairPalette = [
  "#f87171",
  "#60a5fa",
  "#4ade80",
  "#fbbf24",
  "#c084fc",
  "#22d3ee",
  "#fb923c",
  "#f472b6",
  "#a3e635",
  "#94a3b8"
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

const abandonButtonStyle = {
  ...buttonStyle,
  background: "#3a2424",
  border: "1px solid #7f3535",
  color: "#fecaca"
};

const keyCapStyle = {
  alignItems: "center",
  background: "#0d0d0d",
  border: "1px solid #363636",
  borderRadius: "5px",
  color: "#8a8a8a",
  display: "inline-flex",
  flex: "0 0 auto",
  fontSize: "10px",
  fontWeight: 800,
  height: "16px",
  justifyContent: "center",
  lineHeight: 1,
  minWidth: "16px",
  padding: "0 4px"
};

const textTypedRatingStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "7px 9px",
  justifyContent: "space-between"
};

const textTypedRatingLabelStyle = {
  color: "#777",
  fontSize: "11px",
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};

const textTypedRatingControlsStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  justifyContent: "flex-end"
};

const textTypedRatingButtonStyle = {
  alignItems: "center",
  background: "#181818",
  border: "1px solid #333",
  borderRadius: "8px",
  color: "#c9c9c9",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "12px",
  fontWeight: 800,
  gap: "6px",
  minHeight: "30px",
  padding: "6px 8px"
};

function itemAccepts(item, guess) {
  return matchesAnswerValue(item, guess);
}

function shuffled(list) {
  const copy = [...list];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

export default function TextGroupReview({
  group,
  reviewItems,
  contextItems = reviewItems,
  mode: requestedMode,
  onAnsweringComplete,
  onComplete,
  submitAnswer,
  graduateAnswer,
  showQualityControls = true,
  fillAvailableHeight = false
}) {
  const items = useMemo(() => reviewItems || [], [reviewItems]);
  // Identifies this exact group instance (the group plus its current item
  // set) so a draft never leaks across an unrelated group, or from a full
  // group into a same-group retry batch that only carries the failed items.
  const groupKey = useMemo(() => {
    const identity = group?.group_id ?? group?.question_id ?? group?.id ?? group?.name;
    return identity != null ? `text:${identity}` : null;
  }, [group]);
  const itemIds = useMemo(() => items.map(item => item.question_id), [items]);
  const [draft] = useState(() => loadGroupDraft(groupKey, itemIds));

  // A restored draft keeps the mode it was started under: the saved answers
  // only make sense in that mode, so resuming takes priority over whatever
  // mode this fetch happened to roll for the group.
  const mode = normalizeTextMode(draft?.mode ?? requestedMode);
  const isMatch = mode === TEXT_MODE_MATCH;
  const isSelfGradedTypeAll = showQualityControls && !isMatch;

  const [phase, setPhase] = useState(() => draft?.phase === "recap" ? "recap" : "answer");
  const [selfGradeIndex, setSelfGradeIndex] = useState(() => draft?.selfGradeIndex ?? 0);
  const [selfGradeAnswerVisible, setSelfGradeAnswerVisible] = useState(() => Boolean(draft?.selfGradeAnswerVisible));
  // type_all
  const [inputs, setInputs] = useState({});
  const [foundIds, setFoundIds] = useState(() => new Set(draft?.foundIds || []));
  const [duplicateNoticeByQuestionId, setDuplicateNoticeByQuestionId] = useState({});
  const [wrongShakeByQuestionId, setWrongShakeByQuestionId] = useState({});
  // match
  const [selectedPromptId, setSelectedPromptId] = useState(null);
  const [matchedIds, setMatchedIds] = useState(() => new Set(draft?.matchedIds || []));
  const [failedIds, setFailedIds] = useState(() => new Set(draft?.failedIds || []));
  const [wrongFlash, setWrongFlash] = useState(null);
  const [hoveredPairId, setHoveredPairId] = useState(null);
  // What the learner actually typed/picked per item, for M0 0.1 (storing the
  // given answer).
  const [answersByQuestionId, setAnswersByQuestionId] = useState(() => draft?.answersByQuestionId || {});
  // recap
  const [qualities, setQualities] = useState(() => draft?.qualities || {});
  const [pendingQualityQuestionId, setPendingQualityQuestionId] = useState(() => draft?.pendingQualityQuestionId ?? null);
  const { pendingQuality: pendingHoldQuality, hold: holdQuality } = useQualityPickHold();
  const { flashQuality: flashRecapQuality, isFlashing: isRecapFlashing } = useQualityPickFlash();
  const [submitting, setSubmitting] = useState(false);
  const [selectedRecapIndex, setSelectedRecapIndex] = useState(() => draft?.selectedRecapIndex ?? 0);

  // Autosave: only once there is a real attempt to protect (an untouched
  // group stays freely re-rollable), and cleared again once nothing is left.
  useEffect(() => {
    const hasProgress =
      Object.keys(answersByQuestionId).length > 0 ||
      foundIds.size > 0 ||
      matchedIds.size > 0 ||
      failedIds.size > 0 ||
      Object.keys(qualities).length > 0;

    if (!hasProgress) {
      clearGroupDraft(groupKey);
      return;
    }

    saveGroupDraft(groupKey, itemIds, {
      mode,
      phase,
      foundIds: [...foundIds],
      matchedIds: [...matchedIds],
      failedIds: [...failedIds],
      answersByQuestionId,
      qualities,
      pendingQualityQuestionId,
      selfGradeIndex,
      selfGradeAnswerVisible,
      selectedRecapIndex
    });
  }, [
    groupKey,
    itemIds,
    mode,
    phase,
    foundIds,
    matchedIds,
    failedIds,
    answersByQuestionId,
    qualities,
    pendingQualityQuestionId,
    selfGradeIndex,
    selfGradeAnswerVisible,
    selectedRecapIndex
  ]);

  const answerOrder = useMemo(() => shuffled(items), [items]);
  const inputRefs = useRef({});
  const recapRowRefs = useRef({});
  const matchGridRef = useRef(null);
  const promptRefs = useRef({});
  const answerRefs = useRef({});
  const [matchLinks, setMatchLinks] = useState([]);

  const pairColors = useMemo(() => {
    const colors = {};

    items.forEach((item, index) => {
      colors[item.question_id] = pairPalette[index % pairPalette.length];
    });

    return colors;
  }, [items]);

  const selfGradeAllResolved = items.length > 0 && items.every(
    item => qualities[item.question_id] !== undefined
  );
  const allResolved = isMatch
    ? matchedIds.size >= items.length
    : isSelfGradedTypeAll
      ? selfGradeAllResolved
    : foundIds.size >= items.length;
  // Same M0 trust rule as the map and media groups: a generic completion
  // button must not be able to fail every item at once before the learner has
  // touched anything. Any recorded attempt counts, right or wrong --
  // answersByQuestionId is written both on a typed guess and on a first match
  // pick, so a wrong-but-real attempt still unlocks Abandonner.
  const canFinishAnswering = isSelfGradedTypeAll
    ? selfGradeAllResolved
    : items.length > 0 && (
      Object.keys(answersByQuestionId).length > 0 ||
      foundIds.size > 0 ||
      matchedIds.size > 0
    ) && !(showQualityControls && pendingQualityQuestionId !== null);

  const defaultPassQuality = useCallback((item) => {
    return isRelearningGroupItem(group, item)
      ? GOT_IT_QUALITY
      : 2;
  }, [group]);

  function finishAnswering() {
    if (showQualityControls && !isMatch && !isSelfGradedTypeAll) {
      const unratedFound = items.find(item =>
        foundIds.has(item.question_id) &&
        qualities[item.question_id] === undefined
      );

      if (unratedFound) {
        setPendingQualityQuestionId(unratedFound.question_id);
        return;
      }
    }

    const nextQualities = {};

    items.forEach(item => {
      const resolvedOk = isMatch
        ? matchedIds.has(item.question_id) && !failedIds.has(item.question_id)
        : isSelfGradedTypeAll
          ? qualities[item.question_id] !== undefined
        : foundIds.has(item.question_id);
      const passQuality = qualities[item.question_id] ?? defaultPassQuality(item);

      nextQualities[item.question_id] = isSelfGradedTypeAll
        ? Number(qualities[item.question_id] ?? 0)
        : resolvedOk ? passQuality : 0;
    });

    setQualities(nextQualities);
    onAnsweringComplete?.(
      Object.entries(nextQualities)
        .filter(([, quality]) => quality === 0)
        .map(([questionId]) => Number(questionId))
    );

    if (showQualityControls) {
      setSelectedRecapIndex(0);
      setPhase("recap");
    } else {
      submitResult(nextQualities);
    }
  }

  async function submitResult(finalQualities) {
    if (submitting) return;

    setSubmitting(true);

    const failed = Object.entries(finalQualities)
      .filter(([, quality]) => Number(quality) === 0)
      .map(([questionId]) => Number(questionId));
    // Relearning items never re-grade: send only the ordinary grades and
    // graduate the "Acquis" ones. "Encore" stays in `failed` and re-queues.
    const { graded, graduateIds } = partitionRelearningQualities(
      group,
      finalQualities
    );
    const shouldSendAnswerEvidence = !isSelfGradedTypeAll;
    const answers = shouldSendAnswerEvidence
      ? Object.fromEntries(
        Object.entries(answersByQuestionId).filter(([questionId]) => questionId in graded)
      )
      : undefined;
    const candidateSource = isMatch ? answerOrder : contextItems;
    const candidateIds = candidateSource
      .map(item => item.question_id)
      .filter(id => id != null);
    const candidates = shouldSendAnswerEvidence
      ? Object.fromEntries(
        Object.keys(graded).map(questionId => [questionId, candidateIds])
      )
      : undefined;

    try {
      await Promise.all([
        Object.keys(graded).length > 0
          ? submitAnswer?.(graded, mode, contextItems.length, answers, candidates)
          : null,
        graduateIds.length > 0 ? graduateAnswer?.(graduateIds) : null
      ].filter(Boolean));
    } catch (error) {
      console.error(error);
    } finally {
      clearGroupDraft(groupKey);
      onComplete?.(failed);
    }
  }

  // ---- type_all ----
  const handleInputChange = useCallback((questionId, value) => {
    setInputs(prev => ({ ...prev, [questionId]: value }));
    setDuplicateNoticeByQuestionId(prev => {
      if (!prev[questionId]) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }, []);

  const checkTypedAnswer = useCallback((item) => {
    if (foundIds.has(item.question_id)) return true;

    const typed = inputs[item.question_id];

    if (typed) {
      setAnswersByQuestionId(prev => ({ ...prev, [item.question_id]: typed }));
    }

    if (itemAccepts(item, typed)) {
      setFoundIds(prev => new Set(prev).add(item.question_id));
      if (showQualityControls) {
        setPendingQualityQuestionId(item.question_id);
      } else {
        setQualities(prev => ({
          ...prev,
          [item.question_id]: defaultPassQuality(item)
        }));
      }
      setWrongShakeByQuestionId(prev => {
        if (!prev[item.question_id]) return prev;
        const next = { ...prev };
        delete next[item.question_id];
        return next;
      });
      setDuplicateNoticeByQuestionId(prev => {
        if (!prev[item.question_id]) return prev;
        const next = { ...prev };
        delete next[item.question_id];
        return next;
      });
      return showQualityControls ? "needs_quality" : true;
    }

    const duplicate = typed && items.some(candidate =>
      candidate.question_id !== item.question_id &&
      foundIds.has(candidate.question_id) &&
      itemAccepts(candidate, typed)
    );

    if (duplicate) {
      setWrongShakeByQuestionId(prev => {
        if (!prev[item.question_id]) return prev;
        const next = { ...prev };
        delete next[item.question_id];
        return next;
      });
      setDuplicateNoticeByQuestionId(prev => ({
        ...prev,
        [item.question_id]: true
      }));
      return "duplicate";
    }

    if (typed) {
      setWrongShakeByQuestionId(prev => ({
        ...prev,
        [item.question_id]: Date.now()
      }));
    }

    return false;
  }, [defaultPassQuality, foundIds, inputs, items, showQualityControls]);

  const handleInputKeyDown = useCallback((event, item, index) => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    const matched = checkTypedAnswer(item);

    if ((matched === false || matched === "duplicate") && inputs[item.question_id]) {
      event.currentTarget.select();
      return;
    }

    if (matched === "needs_quality") {
      return;
    }

    const next = items[index + 1];
    if (next) {
      inputRefs.current[next.question_id]?.focus();
    }
  }, [checkTypedAnswer, inputs, items]);

  // ---- match ----
  const handlePromptClick = useCallback((item) => {
    if (matchedIds.has(item.question_id)) return;

    setSelectedPromptId(prev =>
      prev === item.question_id ? null : item.question_id
    );
  }, [matchedIds]);

  const handleAnswerClick = useCallback((answerItem) => {
    if (matchedIds.has(answerItem.question_id)) return;
    if (selectedPromptId == null) return;

    const promptItem = items.find(item => item.question_id === selectedPromptId);
    if (!promptItem) return;

    const correct = matchesAnswerValue(promptItem, answerItem.answer);

    // Keep the first pick: match lets the learner retry until correct, and it
    // is the initial (possibly wrong) choice that carries the confusion signal.
    setAnswersByQuestionId(prev => (
      promptItem.question_id in prev
        ? prev
        : { ...prev, [promptItem.question_id]: answerItem.question_id }
    ));

    if (correct) {
      setMatchedIds(prev => new Set(prev).add(promptItem.question_id));
      setSelectedPromptId(null);
    } else {
      setFailedIds(prev => new Set(prev).add(promptItem.question_id));
      setWrongFlash({ prompt: promptItem.question_id, answer: answerItem.question_id });
      window.setTimeout(() => setWrongFlash(null), 450);
    }
  }, [items, matchedIds, selectedPromptId]);

  // Trace a curve from each matched prompt to its answer. Offsets are relative
  // to the positioned grid, so the overlay scrolls with the columns.
  const measureMatchLinks = useCallback(() => {
    if (!matchGridRef.current) return;

    const links = [];

    items.forEach(item => {
      if (!matchedIds.has(item.question_id)) return;

      const prompt = promptRefs.current[item.question_id];
      const answer = answerRefs.current[item.question_id];
      if (!prompt || !answer) return;

      const startX = prompt.offsetLeft + prompt.offsetWidth;
      const startY = prompt.offsetTop + prompt.offsetHeight / 2;
      const endX = answer.offsetLeft;
      const endY = answer.offsetTop + answer.offsetHeight / 2;
      const bend = (startX + endX) / 2;

      links.push({
        color: pairColors[item.question_id],
        d: `M ${startX} ${startY} C ${bend} ${startY}, ${bend} ${endY}, ${endX} ${endY}`,
        endX,
        endY,
        id: item.question_id,
        startX,
        startY
      });
    });

    setMatchLinks(links);
  }, [items, matchedIds, pairColors]);

  useLayoutEffect(() => {
    if (!isMatch || phase !== "answer") return undefined;

    measureMatchLinks();

    const observer = new ResizeObserver(measureMatchLinks);
    if (matchGridRef.current) observer.observe(matchGridRef.current);

    return () => observer.disconnect();
  }, [isMatch, measureMatchLinks, phase]);

  useEffect(() => {
    if (
      items.length > 0 &&
      allResolved &&
      phase === "answer" &&
      pendingQualityQuestionId === null
    ) {
      finishAnswering();
    }
    // finishAnswering reads current state each render; the guard makes it fire once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResolved, items.length, pendingQualityQuestionId, phase]);

  useEffect(() => {
    if (Object.keys(wrongShakeByQuestionId).length === 0) return undefined;

    const timeout = window.setTimeout(() => {
      setWrongShakeByQuestionId({});
    }, 420);

    return () => window.clearTimeout(timeout);
  }, [wrongShakeByQuestionId]);

  const setItemQuality = useCallback((questionId, quality) => {
    setQualities(prev => ({ ...prev, [questionId]: quality }));
  }, []);

  const revealSelfGradeAnswer = useCallback(() => {
    setSelfGradeAnswerVisible(true);
  }, []);

  const activeSelfGradeItem = items[Math.min(
    selfGradeIndex,
    Math.max(0, items.length - 1)
  )] || null;

  const rateSelfGradeQuality = useCallback((quality = 2) => {
    if (!activeSelfGradeItem) return;

    const nextQuality = Number(quality);
    const allowedQualities = isRelearningGroupItem(group, activeSelfGradeItem)
      ? [0, GOT_IT_QUALITY]
      : [0, 1, 2, 3];

    if (!allowedQualities.includes(nextQuality)) return;

    setQualities(prev => ({
      ...prev,
      [activeSelfGradeItem.question_id]: nextQuality
    }));

    if (selfGradeIndex >= items.length - 1) return;

    const nextIndex = selfGradeIndex + 1;
    const nextItem = items[nextIndex];

    setSelfGradeIndex(nextIndex);
    setSelfGradeAnswerVisible(false);

    if (nextItem) {
      window.requestAnimationFrame(() => {
        inputRefs.current[nextItem.question_id]?.focus();
      });
    }
  }, [activeSelfGradeItem, group, items, selfGradeIndex]);

  useEffect(() => {
    if (phase !== "answer" || !isSelfGradedTypeAll) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (!selfGradeAnswerVisible) {
        if (event.key === "Enter") {
          event.preventDefault();
          revealSelfGradeAnswer();
        }
        return;
      }

      const quality = eventDigit(event, { min: 0, max: 3 });

      if (quality !== null) {
        event.preventDefault();
        holdQuality(quality, rateSelfGradeQuality);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        holdQuality(
          activeSelfGradeItem ? defaultPassQuality(activeSelfGradeItem) : 2,
          rateSelfGradeQuality
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeSelfGradeItem,
    defaultPassQuality,
    holdQuality,
    isSelfGradedTypeAll,
    phase,
    rateSelfGradeQuality,
    revealSelfGradeAnswer,
    selfGradeAnswerVisible
  ]);

  const ratePendingTypedQuality = useCallback((quality = 2) => {
    if (pendingQualityQuestionId === null) return;

    const item = items.find(candidate =>
      candidate.question_id === pendingQualityQuestionId
    );
    if (!item) return;

    const nextQuality = Number(quality);
    const allowedQualities = isRelearningGroupItem(group, item)
      ? [GOT_IT_QUALITY]
      : [1, 2, 3];

    if (!allowedQualities.includes(nextQuality)) return;

    setQualities(prev => ({
      ...prev,
      [pendingQualityQuestionId]: nextQuality
    }));
    setPendingQualityQuestionId(null);

    const currentIndex = items.findIndex(candidate =>
      candidate.question_id === pendingQualityQuestionId
    );
    const nextItem = items
      .slice(currentIndex + 1)
      .find(candidate => !foundIds.has(candidate.question_id));

    if (nextItem) {
      window.requestAnimationFrame(() => {
        inputRefs.current[nextItem.question_id]?.focus();
      });
    }
  }, [foundIds, group, items, pendingQualityQuestionId]);

  useEffect(() => {
    if (phase !== "answer" || pendingQualityQuestionId === null) {
      return undefined;
    }

    const pendingItem = items.find(item =>
      item.question_id === pendingQualityQuestionId
    );

    function handleKeyDown(event) {
      const quality = eventDigit(event, { min: 1, max: 3 });

      if (quality !== null) {
        event.preventDefault();
        holdQuality(quality, ratePendingTypedQuality);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        holdQuality(
          pendingItem ? defaultPassQuality(pendingItem) : 2,
          ratePendingTypedQuality
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    defaultPassQuality,
    holdQuality,
    items,
    pendingQualityQuestionId,
    phase,
    ratePendingTypedQuality
  ]);

  // Keyboard: up/down to move through the rows, 0-3 to grade the selected one.
  useEffect(() => {
    if (phase !== "recap") return undefined;

    function handleKeyDown(event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelectedRecapIndex(prev =>
          Math.min(items.length - 1, Math.max(0, prev + delta))
        );
        return;
      }

      // Accept the character (0-3) or the physical key, so the shortcut works
      // on AZERTY layouts where the top-row digits need Shift.
      const quality = eventDigit(event, { min: 0, max: 3 });

      if (quality !== null) {
        const item = items[selectedRecapIndex];
        if (!item) return;

        event.preventDefault();
        setItemQuality(item.question_id, quality);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, items, selectedRecapIndex, setItemQuality]);

  // Keep the selected row visible as the selection moves.
  useEffect(() => {
    if (phase !== "recap") return;
    recapRowRefs.current[selectedRecapIndex]?.scrollIntoView({ block: "nearest" });
  }, [phase, selectedRecapIndex]);

  const containerStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    height: fillAvailableHeight ? "100%" : "auto",
    margin: "0 auto",
    maxWidth: "760px",
    width: "100%"
  };

  const headerLabel = isMatch
    ? "TEXTE · Associer"
    : "TEXTE · Tout taper";

  if (phase === "recap") {
    return (
      <div style={{ ...containerStyle, maxWidth: "1180px" }}>
        <div style={{ alignItems: "center", color: "#8fc7ff", display: "flex", fontSize: "12px", fontWeight: 800, gap: "10px", justifyContent: "space-between", letterSpacing: 1 }}>
          <span>RÉSULTAT</span>
          <span style={{ color: "#666", fontSize: "11px", fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>
            ↑/↓ pour naviguer · 0-3 pour noter
          </span>
        </div>
        <div
          className="app-scrollbar"
          style={{ display: "grid", gap: "8px", overflowY: "auto", paddingRight: "4px" }}
        >
          {items.map((item, index) => {
            const quality = qualities[item.question_id] ?? 0;
            const isSelected = index === selectedRecapIndex;
            const relearning = isRelearningGroupItem(group, item);
            const rowQualityOptions = relearning
              ? relearningQualityOptions
              : qualityOptions;
            const rowButtonColors = relearning
              ? relearningButtonColors
              : qualityButtonColors;
            // A relearning retry never re-grades FSRS: Encore and Acquis lead to
            // the same already-frozen interval, so both show that one value
            // rather than a per-grade estimate that would imply a difference.
            const projectedInterval = relearning
              ? (item.relearning_interval ?? 0)
              : (item.projected_intervals?.[quality] ?? item.progress?.interval ?? 0);

            return (
              <div
                key={item.question_id}
                ref={(element) => { recapRowRefs.current[index] = element; }}
                data-text-recap-row
                data-selected={isSelected ? "true" : undefined}
                onClick={() => setSelectedRecapIndex(index)}
                style={{
                  alignItems: "center",
                  background: isSelected ? "#1c1c1c" : "#161616",
                  border: "1px solid #2a2a2a",
                  borderLeft: `3px solid ${quality > 0 ? "#38bdf8" : "#f59e0b"}`,
                  borderRadius: "10px",
                  boxShadow: isSelected ? "0 0 0 2px rgba(143, 199, 255, 0.55)" : "none",
                  cursor: "pointer",
                  display: "grid",
                  gap: "10px",
                  gridTemplateColumns: "minmax(0, 1fr) auto auto",
                  padding: "10px 12px"
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#eee", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <RichText>{item.question}</RichText>
                  </div>
                  <div style={{ color: "#8fc7ff", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <RichText>{item.answer}</RichText>
                  </div>
                </div>
                <div style={{ color: "#8a8a8a", fontSize: "12px", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>
                  {projectedInterval > 0 ? `${projectedInterval} j` : "—"}
                </div>
                <div style={{ display: "flex", gap: "5px" }}>
                  {rowQualityOptions.map(option => {
                    const active = quality === option.value;
                    const colors = rowButtonColors[option.value];

                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        data-text-recap-quality={option.value}
                        onClick={() => {
                          setSelectedRecapIndex(index);
                          setItemQuality(item.question_id, option.value);
                          flashRecapQuality(item.question_id, option.value);
                        }}
                        style={{
                          background: active ? colors.background : "#222",
                          border: active ? colors.border : "1px solid #333",
                          borderRadius: "8px",
                          color: active ? colors.color : "#999",
                          cursor: "pointer",
                          fontSize: "15px",
                          padding: "6px 9px",
                          animation: isRecapFlashing(item.question_id, option.value)
                            ? qualityPickAnimation(option.value)
                            : undefined
                        }}
                      >
                        {option.icon}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => submitResult(qualities)}
            style={{
              ...buttonStyle,
              background: "#1e3a5f",
              border: "1px solid #345b7a",
              color: "#dbeafe",
              opacity: submitting ? 0.6 : 1
            }}
          >
            Valider
          </button>
        </div>
      </div>
    );
  }

  if (isMatch) {
    const activePrompts = items;
    const activeAnswers = answerOrder;
    // The hovered pair's line goes last so it paints over the ones it crosses.
    const orderedLinks = hoveredPairId == null
      ? matchLinks
      : [...matchLinks].sort((a, b) =>
        Number(a.id === hoveredPairId) - Number(b.id === hoveredPairId)
      );

    // Hovering one half of a matched pair lights up both halves and its line.
    const pairHoverProps = (item, matched) => (matched
      ? {
        onBlur: () => setHoveredPairId(null),
        onFocus: () => setHoveredPairId(item.question_id),
        onMouseEnter: () => setHoveredPairId(item.question_id),
        onMouseLeave: () => setHoveredPairId(null)
      }
      : {});

    const pairEmphasis = (item, matched, pairColor) => {
      if (!matched) return { boxShadow: "none", opacity: 1 };

      const active = hoveredPairId === item.question_id;

      return {
        boxShadow: active ? `0 0 0 2px ${pairColor}59` : "none",
        opacity: active ? 1 : hoveredPairId == null ? 0.85 : 0.3
      };
    };

    return (
      <div style={{ ...containerStyle, maxWidth: "900px" }}>
        <div style={{ color: "#8fc7ff", fontSize: "12px", fontWeight: 800, letterSpacing: 1 }}>
          {headerLabel}
        </div>
        <div
          className="app-scrollbar"
          style={{ overflowY: "auto", paddingRight: "4px" }}
        >
          <div
            ref={matchGridRef}
            style={{
              columnGap: "92px",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              isolation: "isolate",
              position: "relative"
            }}
          >
            <svg
              aria-hidden="true"
              style={{
                height: "100%",
                inset: 0,
                overflow: "visible",
                pointerEvents: "none",
                position: "absolute",
                width: "100%",
                zIndex: -1
              }}
            >
              {orderedLinks.map(link => {
                const active = hoveredPairId === link.id;

                return (
                  <g
                    key={link.id}
                    opacity={active ? 1 : hoveredPairId == null ? 0.9 : 0.15}
                    style={{ transition: "opacity 60ms ease" }}
                  >
                    <path
                      d={link.d}
                      fill="none"
                      stroke={link.color}
                      strokeLinecap="round"
                      strokeWidth={active ? 3 : 2}
                    />
                    <circle cx={link.startX} cy={link.startY} fill={link.color} r={active ? 4.5 : 3.5} />
                    <circle cx={link.endX} cy={link.endY} fill={link.color} r={active ? 4.5 : 3.5} />
                  </g>
                );
              })}
            </svg>
            <div style={{ display: "grid", gap: "8px", alignContent: "start" }}>
              {activePrompts.map(item => {
                const matched = matchedIds.has(item.question_id);
                const selected = selectedPromptId === item.question_id;
                const flashing = wrongFlash?.prompt === item.question_id;
                const pairColor = pairColors[item.question_id];

                return (
                  <button
                    key={item.question_id}
                    ref={(element) => { promptRefs.current[item.question_id] = element; }}
                    type="button"
                    data-text-match-prompt
                    aria-disabled={matched || undefined}
                    onClick={() => handlePromptClick(item)}
                    {...pairHoverProps(item, matched)}
                    style={{
                      ...buttonStyle,
                      ...pairEmphasis(item, matched, pairColor),
                      background: matched ? "#17253d" : selected ? "#2a2410" : "#1a1a1a",
                      border: flashing
                        ? "1px solid #f59e0b"
                        : matched
                          ? `1px solid ${pairColor}`
                          : selected
                            ? "1px solid #d6a91c"
                            : "1px solid #2c2c2c",
                      color: matched ? pairColor : "#eee",
                      cursor: matched ? "default" : "pointer",
                      textAlign: "left",
                      transition: "opacity 60ms ease, box-shadow 60ms ease"
                    }}
                  >
                    <RichText>{item.question}</RichText>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gap: "8px", alignContent: "start" }}>
              {activeAnswers.map(item => {
                const matched = matchedIds.has(item.question_id);
                const flashing = wrongFlash?.answer === item.question_id;
                const pairColor = pairColors[item.question_id];

                return (
                  <button
                    key={item.question_id}
                    ref={(element) => { answerRefs.current[item.question_id] = element; }}
                    type="button"
                    data-text-match-answer
                    aria-disabled={matched || undefined}
                    onClick={() => handleAnswerClick(item)}
                    {...pairHoverProps(item, matched)}
                    style={{
                      ...buttonStyle,
                      ...pairEmphasis(item, matched, pairColor),
                      background: matched ? "#17253d" : "#1a1a1a",
                      border: flashing
                        ? "1px solid #f59e0b"
                        : matched
                          ? `1px solid ${pairColor}`
                          : "1px solid #2c2c2c",
                      color: matched ? pairColor : "#eee",
                      cursor: matched ? "default" : "pointer",
                      textAlign: "left",
                      transition: "opacity 60ms ease, box-shadow 60ms ease"
                    }}
                  >
                    <RichText>{item.answer}</RichText>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ color: "#777", fontSize: "13px" }}>
          Clique un élément à gauche puis sa réponse à droite.
        </div>
      </div>
    );
  }

  if (isSelfGradedTypeAll) {
    const item = activeSelfGradeItem;
    const relearning = item ? isRelearningGroupItem(group, item) : false;
    const selfGradeOptions = relearning ? relearningQualityOptions : qualityOptions;
    const selfGradeButtonColors = relearning
      ? relearningButtonColors
      : qualityButtonColors;
    const progressLabel = items.length > 0
      ? `${Math.min(selfGradeIndex + 1, items.length)} / ${items.length}`
      : "0 / 0";

    return (
      <div data-text-self-grade style={containerStyle}>
        <div style={{ alignItems: "center", color: "#8fc7ff", display: "flex", fontSize: "12px", fontWeight: 800, gap: "10px", justifyContent: "space-between", letterSpacing: 1 }}>
          <span>TEXTE · Rappel</span>
          <span style={{ color: "#777", fontSize: "11px", letterSpacing: 0 }}>{progressLabel}</span>
        </div>
        {item && (
          <div
            data-text-self-grade-card
            style={{
              background: "#161616",
              border: "1px solid #2a2a2a",
              borderRadius: "10px",
              display: "grid",
              gap: "18px",
              padding: "18px"
            }}
          >
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={textTypedRatingLabelStyle}>Question</div>
              <div style={{ color: "#f3f3f3", fontSize: "24px", fontWeight: 800, lineHeight: 1.35 }}>
                <RichText>{item.question}</RichText>
              </div>
            </div>

            {!selfGradeAnswerVisible ? (
              <div style={{ display: "grid", gap: "10px" }}>
                <input
                  ref={(element) => { inputRefs.current[item.question_id] = element; }}
                  aria-label="Réponse facultative"
                  value={inputs[item.question_id] || ""}
                  onChange={(event) => handleInputChange(item.question_id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    revealSelfGradeAnswer();
                  }}
                  placeholder="Réponse facultative…"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={revealSelfGradeAnswer}
                  style={{ ...buttonStyle, justifySelf: "start" }}
                >
                  Voir la réponse
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "14px" }}>
                <div style={{ borderTop: "1px solid #2a2a2a", display: "grid", gap: "8px", paddingTop: "16px" }}>
                  <div style={textTypedRatingLabelStyle}>Réponse</div>
                  <div style={{ color: "#7ee2a8", fontSize: "20px", fontWeight: 800, lineHeight: 1.4 }}>
                    <RichText>{item.answer}</RichText>
                  </div>
                </div>
                <div data-text-self-grade-rating style={textTypedRatingStyle}>
                  <span style={textTypedRatingLabelStyle}>Qualité</span>
                  <div style={textTypedRatingControlsStyle}>
                    {selfGradeOptions.map(option => {
                      const colors = selfGradeButtonColors[option.value];

                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={qualities[item.question_id] === option.value}
                          data-text-self-grade-quality={option.value}
                          disabled={pendingHoldQuality !== null}
                          onClick={() => holdQuality(option.value, rateSelfGradeQuality)}
                          style={{
                            ...textTypedRatingButtonStyle,
                            background: colors.background,
                            border: colors.border,
                            color: colors.color,
                            animation: pendingHoldQuality === option.value
                              ? qualityPickAnimation(option.value)
                              : undefined
                          }}
                        >
                          <span aria-hidden="true" style={keyCapStyle}>
                            {option.value}
                          </span>
                          <span>{option.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Training type_all keeps checked typing; scheduled type_all uses self-grading.
  return (
    <div style={containerStyle}>
      <div style={{ color: "#8fc7ff", fontSize: "12px", fontWeight: 800, letterSpacing: 1 }}>
        {headerLabel}
      </div>
      <div
        className="app-scrollbar"
        style={{ display: "grid", gap: "8px", overflowY: "auto", paddingRight: "4px" }}
      >
        {items.map((item, index) => {
          const found = foundIds.has(item.question_id);
          const pendingQuality = pendingQualityQuestionId === item.question_id;
          const relearning = isRelearningGroupItem(group, item);
          const inlineQualityOptions = relearning
            ? acquisOnlyOptions
            : typedQualityOptions;

          return (
            <div
              key={item.question_id}
              data-text-type-row
              style={{
                alignItems: "center",
                background: found ? "#15202b" : "#161616",
                border: found ? "1px solid #345b7a" : "1px solid #2a2a2a",
                borderRadius: "10px",
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                padding: "9px 12px"
              }}
            >
              <div
                style={{
                  color: "#eee",
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                <RichText>{item.question}</RichText>
              </div>
              {found ? (
                <div style={{ display: "grid", gap: "8px", minWidth: 0 }}>
                  <div style={{ color: "#7ee2a8", fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <RichText>{item.answer}</RichText>
                  </div>
                  {pendingQuality && (
                    <div data-text-typed-rating style={textTypedRatingStyle}>
                      <span style={textTypedRatingLabelStyle}>Qualité</span>
                      <div style={textTypedRatingControlsStyle}>
                        {inlineQualityOptions.map(option => (
                          <button
                            key={option.value}
                            type="button"
                            data-text-typed-quality={option.value}
                            disabled={pendingHoldQuality !== null}
                            onClick={() => holdQuality(option.value, ratePendingTypedQuality)}
                            style={{
                              ...textTypedRatingButtonStyle,
                              animation: pendingHoldQuality === option.value
                                ? qualityPickAnimation(option.value)
                                : undefined
                            }}
                          >
                            <span aria-hidden="true" style={keyCapStyle}>
                              {option.value}
                            </span>
                            <span>{option.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "grid", gap: "5px" }}>
                  <input
                    className={wrongShakeByQuestionId[item.question_id] ? "review-input-shake" : undefined}
                    ref={(element) => { inputRefs.current[item.question_id] = element; }}
                    value={inputs[item.question_id] || ""}
                    onChange={(event) => handleInputChange(item.question_id, event.target.value)}
                    onKeyDown={(event) => handleInputKeyDown(event, item, index)}
                    onBlur={() => checkTypedAnswer(item)}
                    placeholder="Réponse…"
                    style={inputStyle}
                  />
                  {duplicateNoticeByQuestionId[item.question_id] && (
                    <div style={{ color: "#facc15", fontSize: "12px", fontWeight: 700 }}>
                      Déjà répondu.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <button
          type="button"
          aria-label="Abandonner le groupe"
          disabled={!canFinishAnswering}
          onClick={finishAnswering}
          style={{
            ...abandonButtonStyle,
            cursor: canFinishAnswering ? "pointer" : "not-allowed",
            opacity: canFinishAnswering ? 1 : 0.55
          }}
        >
          Abandonner
        </button>
      </div>
    </div>
  );
}

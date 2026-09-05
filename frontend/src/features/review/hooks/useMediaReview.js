import { useEffect, useMemo, useRef, useState } from "react";
import { sendMediaAnswer } from "../../../api/review";
import { mediaPoolFrom, pickReviewMedia } from "../../../shared/media";
import { isRelearningGroupItem, partitionRelearningQualities } from "../relearningGrades";
import {
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT,
  normalizeImageMode,
  normalizeImageModeForItemCount
} from "../imageModes";
import {
  matchesAnswerValue,
  normalizeAnswerText
} from "../answerPolicy";
import { buildChoiceOptions } from "../distractorSelection";
import { reviewModeFallback } from "../reviewModeCompatibility";
import { qualityPickHoldMs } from "../../../shared/answerFeedback";

export const IMAGE_RECAP_UNANSWERED = "unanswered";


export function normalizeImageAnswer(value = "") {
  return normalizeAnswerText(value);
}


export function matchesImageAnswer(item, value) {
  return matchesAnswerValue(item, value);
}


export function defaultImageSuccessQuality() {
  return 2;
}


function shuffled(items) {
  const copy = [...(items || [])];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}


function idsFor(items) {
  return items.map(item => item.question_id);
}


// Choose one image per item for this presentation, keyed by question so an item
// that appears both as a due card and as context shows the same picture.
function buildDisplayMedia(...itemLists) {
  const chosen = {};

  for (const items of itemLists) {
    for (const item of items || []) {
      const questionId = item?.question_id;

      if (questionId == null || questionId in chosen) continue;

      chosen[questionId] = pickReviewMedia(questionId, mediaPoolFrom(item));
    }
  }

  return chosen;
}


function resolveItemsMedia(items, displayMedia) {
  if (!Array.isArray(items)) return items;

  return items.map(item => {
    if (item == null) return item;

    const media = displayMedia[item.question_id];

    return media && media !== item.media ? { ...item, media } : item;
  });
}


function questionIdSet(ids) {
  return new Set(ids || []);
}


function recapQualityForItem(
  item,
  qualityByQuestionId,
  foundQuestionIdSet,
  resolvedQuestionIdSet,
  allowPartialSubmit
) {
  const selectedQuality = qualityByQuestionId[item.question_id];

  if (selectedQuality !== undefined) return selectedQuality;
  if (foundQuestionIdSet.has(item.question_id)) return defaultImageSuccessQuality();
  if (allowPartialSubmit && !resolvedQuestionIdSet.has(item.question_id)) {
    return IMAGE_RECAP_UNANSWERED;
  }

  return 0;
}


function buildRecapQualities(
  items,
  qualityByQuestionId,
  foundQuestionIds,
  resolvedQuestionIds,
  allowPartialSubmit
) {
  const foundSet = questionIdSet(foundQuestionIds);
  const resolvedSet = questionIdSet(resolvedQuestionIds);
  const complete = {};

  items.forEach(item => {
    complete[item.question_id] = recapQualityForItem(
      item,
      qualityByQuestionId,
      foundSet,
      resolvedSet,
      allowPartialSubmit
    );
  });

  return complete;
}


function submittedQualitiesFromRecap(qualityByQuestionId) {
  return Object.fromEntries(
    Object.entries(qualityByQuestionId).filter(([, quality]) =>
      quality !== IMAGE_RECAP_UNANSWERED
    )
  );
}


function uniqueItemsByQuestionId(...itemGroups) {
  const lookup = new Map();

  itemGroups.forEach(items => {
    (items || []).forEach(item => {
      if (item?.question_id !== undefined && item?.question_id !== null) {
        lookup.set(item.question_id, item);
      }
    });
  });

  return lookup;
}


function choiceOptionsRecordKey(target, choiceOptions) {
  if (!target || !choiceOptions?.length) return null;

  const optionIds = choiceOptions
    .map(item => item.question_id)
    .filter(id => id !== undefined && id !== null)
    .sort((a, b) => a - b)
    .join("|");

  return `${target.question_id}:${optionIds}`;
}


function recordDistractorUsage(usageState, target, choiceOptions) {
  const recordKey = choiceOptionsRecordKey(target, choiceOptions);

  if (!recordKey || usageState.recordedChoiceKeys.has(recordKey)) {
    return;
  }

  usageState.recordedChoiceKeys.add(recordKey);

  choiceOptions.forEach(item => {
    if (!item || item.question_id === target.question_id) return;

    usageState.counts.set(
      item.question_id,
      (usageState.counts.get(item.question_id) || 0) + 1
    );
  });
}


function isPromptMode(mode) {
  return mode !== IMAGE_MODE_TYPE_ALL;
}


function isChoiceMode(mode) {
  return (
    mode === IMAGE_MODE_MULTIPLE_CHOICE_LABEL ||
    mode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
  );
}


function shouldUseGridPromptOrder(mode) {
  return mode === IMAGE_MODE_MULTIPLE_CHOICE_LABEL;
}


function shouldHighlightPromptImage(mode) {
  return (
    mode === IMAGE_MODE_TYPE_PROMPT ||
    mode === IMAGE_MODE_MULTIPLE_CHOICE_LABEL
  );
}


function nextUnresolvedItem(items, startQuestionId, direction, resolvedQuestionIds) {
  if (!items.length) return null;

  const step = direction < 0 ? -1 : 1;
  const startIndex = items.findIndex(item => item.question_id === startQuestionId);
  const anchorIndex = startIndex >= 0
    ? startIndex
    : step > 0
      ? -1
      : 0;

  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (
      anchorIndex + (offset * step) + items.length
    ) % items.length;
    const item = items[index];

    if (!resolvedQuestionIds.has(item.question_id)) {
      return item;
    }
  }

  return null;
}

function getHistoryStats(item) {
  const history = item.progress?.history || [];

  if (history.length > 0) {
    const successes = history.filter(entry => entry.quality > 0).length;

    return {
      reviews: history.length,
      successRate: Math.round((successes / history.length) * 100)
    };
  }

  const reps = item.progress?.reps || 0;
  const lapses = item.progress?.lapses || 0;

  if (reps > 0) {
    const successes = Math.max(0, reps - lapses);

    return {
      reviews: reps,
      successRate: Math.round((successes / reps) * 100)
    };
  }

  return {
    reviews: 0,
    successRate: null
  };
}


function getDifficultyScore(item, historyStats) {
  const explicitDifficulty = Number(item.progress?.difficulty);

  if (Number.isFinite(explicitDifficulty)) {
    return explicitDifficulty;
  }

  if (historyStats.successRate !== null) {
    return 10 - (historyStats.successRate / 10);
  }

  return 5;
}


function imageAnswerLabel(item) {
  return item?.label || item?.answer || "Image";
}


function getSelectedQuality(item, isFound, qualityByQuestionId) {
  return qualityByQuestionId[item.question_id] ?? (isFound ? 2 : 0);
}


function getProjectedInterval(item, selectedQuality, isRelearning = false) {
  if (selectedQuality === IMAGE_RECAP_UNANSWERED) return null;

  // A relearning retry never re-grades FSRS: Encore and Acquis lead to the
  // same already-frozen interval, so it stays fixed no matter which is picked.
  const value = isRelearning
    ? item.relearning_interval ?? 0
    : item.projected_intervals?.[selectedQuality] ??
      item.progress?.interval ??
      0;
  const interval = Number(value);

  return Number.isFinite(interval) ? interval : 0;
}


function qualitySortValue(quality) {
  return quality === IMAGE_RECAP_UNANSWERED ? -1 : Number(quality);
}


function compareDefaultRecapRows(a, b) {
  if (b.difficultyScore !== a.difficultyScore) {
    return b.difficultyScore - a.difficultyScore;
  }

  return imageAnswerLabel(a.item).localeCompare(imageAnswerLabel(b.item));
}


function compareActiveRecapSort(a, b, recapSort, qualityByQuestionId) {
  if (recapSort.key === "answer") {
    return imageAnswerLabel(a.item).localeCompare(imageAnswerLabel(b.item));
  }

  if (recapSort.key === "success") {
    const aRate = a.historyStats.successRate === null
      ? -1
      : a.historyStats.successRate;
    const bRate = b.historyStats.successRate === null
      ? -1
      : b.historyStats.successRate;

    return aRate - bRate;
  }

  if (recapSort.key === "interval") {
    const aQuality = getSelectedQuality(a.item, a.isFound, qualityByQuestionId);
    const bQuality = getSelectedQuality(b.item, b.isFound, qualityByQuestionId);

    return (
      (getProjectedInterval(a.item, aQuality) ?? -1) -
      (getProjectedInterval(b.item, bQuality) ?? -1)
    );
  }

  if (recapSort.key === "quality") {
    return (
      qualitySortValue(getSelectedQuality(a.item, a.isFound, qualityByQuestionId)) -
      qualitySortValue(getSelectedQuality(b.item, b.isFound, qualityByQuestionId))
    );
  }

  return 0;
}


const initialRecapSort = {
  key: null,
  direction: "asc"
};


export function useMediaReview(
  reviewItemsInput,
  onComplete,
  submitAnswer = sendMediaAnswer,
  options = {}
) {
  const reviewItemCount = Array.isArray(reviewItemsInput)
    ? reviewItemsInput.length
    : 0;
  const relearningGroup = options.group;
  const servedRetryMode = (
    relearningGroup?._reviewRetryOfIndex !== undefined ||
    (reviewItemsInput || []).some(item =>
      isRelearningGroupItem(relearningGroup, item)
    )
  );
  const contextItemsInput = options.contextItems?.length
    ? options.contextItems
    : reviewItemsInput;
  const mode = servedRetryMode
    ? reviewModeFallback("media", normalizeImageMode(options.mode), {
      items: reviewItemsInput || [],
      itemCount: reviewItemCount,
      activeContextCount: reviewItemCount,
      choiceContextCount: contextItemsInput?.length || 0,
      contextItems: contextItemsInput || []
    })
    : normalizeImageModeForItemCount(options.mode, reviewItemCount);
  const allowPartialSubmit = Boolean(options.allowPartialSubmit);
  const onAnsweringComplete = options.onAnsweringComplete;
  // Review grades each choice inline (reveal + quality), then auto-submits the
  // group when the last item is rated. Training keeps the legacy flash + recap.
  const inlineChoiceRating = Boolean(options.inlineChoiceRating) && isChoiceMode(mode);
  const inlineTypedRating = Boolean(options.inlineTypedRating) && (
    mode === IMAGE_MODE_TYPE_ALL ||
    mode === IMAGE_MODE_TYPE_PROMPT
  );
  const graduateAnswer = options.graduateAnswer;
  const reviewKey = useMemo(
    () => `${mode}:${idsFor(reviewItemsInput).join("|")}`,
    [mode, reviewItemsInput]
  );
  // Resolve the picture each pooled item shows for this presentation once per
  // review, so the prompt, choice grid, recap, and preview stay in sync. Keyed
  // on reviewKey: a relearning retry remounts with a new key and re-picks.
  const displayMediaByQuestionId = useMemo(
    () => buildDisplayMedia(reviewItemsInput, contextItemsInput),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewKey]
  );
  const reviewItems = useMemo(
    () => resolveItemsMedia(reviewItemsInput, displayMediaByQuestionId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewKey, displayMediaByQuestionId]
  );
  const contextItems = useMemo(
    () => resolveItemsMedia(contextItemsInput, displayMediaByQuestionId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewKey, displayMediaByQuestionId]
  );
  const distractorUsage = useMemo(() => ({
    reviewKey,
    counts: new Map(),
    recordedChoiceKeys: new Set()
  }), [reviewKey]);
  const sessionItems = useMemo(
    () => (
      mode === IMAGE_MODE_TYPE_PROMPT
        ? [...reviewItems]
        : shuffled(reviewItems)
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewKey]
  );
  const promptQueue = useMemo(
    () => {
      if (!isPromptMode(mode)) return sessionItems;
      if (mode === IMAGE_MODE_TYPE_PROMPT) return sessionItems;

      return shouldUseGridPromptOrder(mode)
        ? sessionItems
        : shuffled(reviewItems);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, reviewKey, sessionItems]
  );
  const [input, setInput] = useState("");
  const [foundQuestionIds, setFoundQuestionIds] = useState([]);
  const [resolvedQuestionIds, setResolvedQuestionIds] = useState([]);
  const [lockedMissedQuestionIds, setLockedMissedQuestionIds] = useState([]);
  const [revealedQuestionIds, setRevealedQuestionIds] = useState([]);
  const [qualityByQuestionId, setQualityByQuestionId] = useState({});
  // What the learner actually typed/picked per item, for M0 0.1 (storing the
  // given answer). Keyed like qualityByQuestionId.
  const [answerByQuestionId, setAnswerByQuestionId] = useState({});
  const [hasAttemptedAnswer, setHasAttemptedAnswer] = useState(false);
  const [candidateIdsByQuestionId, setCandidateIdsByQuestionId] = useState({});
  const [feedbackTone, setFeedbackTone] = useState(null);
  const [interactionFeedback, setInteractionFeedback] = useState(null);
  const [typedRatingFeedback, setTypedRatingFeedback] = useState(null);
  const [resultMode, setResultMode] = useState(false);
  const [activePromptQuestionId, setActivePromptQuestionId] = useState(null);
  const [recapSort, setRecapSort] = useState(initialRecapSort);
  const submittingRef = useRef(false);
  const choiceRateTimeoutRef = useRef(null);
  const typedRateTimeoutRef = useRef(null);

  useEffect(() => {
    window.clearTimeout(choiceRateTimeoutRef.current);
    window.clearTimeout(typedRateTimeoutRef.current);
    setInput("");
    setFoundQuestionIds([]);
    setResolvedQuestionIds([]);
    setLockedMissedQuestionIds([]);
    setRevealedQuestionIds([]);
    setQualityByQuestionId({});
    setAnswerByQuestionId({});
    setHasAttemptedAnswer(false);
    setCandidateIdsByQuestionId({});
    setFeedbackTone(null);
    setInteractionFeedback(null);
    setTypedRatingFeedback(null);
    setResultMode(false);
    setActivePromptQuestionId(null);
    setRecapSort(initialRecapSort);
  }, [reviewKey]);

  useEffect(() => () => {
    window.clearTimeout(choiceRateTimeoutRef.current);
    window.clearTimeout(typedRateTimeoutRef.current);
  }, []);

  const foundQuestionIdSet = useMemo(
    () => questionIdSet(foundQuestionIds),
    [foundQuestionIds]
  );
  const resolvedQuestionIdSet = useMemo(
    () => questionIdSet(resolvedQuestionIds),
    [resolvedQuestionIds]
  );
  const resolvedQuestionIdsRecentFirst = useMemo(
    () => [...resolvedQuestionIds].reverse(),
    [resolvedQuestionIds]
  );
  const lockedMissedQuestionIdSet = useMemo(
    () => questionIdSet(lockedMissedQuestionIds),
    [lockedMissedQuestionIds]
  );
  const revealedQuestionIdSet = useMemo(
    () => questionIdSet(revealedQuestionIds),
    [revealedQuestionIds]
  );
  const itemByQuestionId = useMemo(
    () => uniqueItemsByQuestionId(sessionItems, contextItems, reviewItems),
    [contextItems, reviewItems, sessionItems]
  );
  const currentPromptItem = useMemo(
    () => {
      if (!isPromptMode(mode)) return null;

      if (activePromptQuestionId !== null) {
        const activeItem = promptQueue.find(item =>
          item.question_id === activePromptQuestionId &&
          !resolvedQuestionIdSet.has(item.question_id)
        );

        if (activeItem) return activeItem;
      }

      return promptQueue.find(item =>
        !resolvedQuestionIdSet.has(item.question_id)
      ) || null;
    },
    [activePromptQuestionId, mode, promptQueue, resolvedQuestionIdSet]
  );
  const activeItem = useMemo(() => {
    if (shouldHighlightPromptImage(mode)) {
      return currentPromptItem;
    }

    return null;
  }, [
    currentPromptItem,
    mode
  ]);
  const choiceOptions = useMemo(
    () => buildChoiceOptions(
      currentPromptItem,
      contextItems,
      distractorUsage.counts,
      resolvedQuestionIdSet
    ),
    // Cooldown counts and the answered-question exclusion set live in mutable
    // per-review state; they should affect the next prompt sample, not resample
    // the current prompt when they update mid-prompt. The memo already recomputes
    // when currentPromptItem advances, at which point resolvedQuestionIdSet
    // reflects the just-answered question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextItems, currentPromptItem]
  );
  useEffect(() => {
    if (
      mode !== IMAGE_MODE_MULTIPLE_CHOICE_LABEL &&
      mode !== IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
    ) {
      return;
    }

    recordDistractorUsage(
      distractorUsage,
      currentPromptItem,
      choiceOptions
    );
  }, [choiceOptions, currentPromptItem, distractorUsage, mode]);
  const activeInteractionFeedback = (
    !resultMode &&
    (
      mode === IMAGE_MODE_MULTIPLE_CHOICE_LABEL ||
      mode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
    )
  )
    ? interactionFeedback
    : null;
  const visibleChoiceOptions = activeInteractionFeedback?.options || choiceOptions;
  const visualPromptItem = activeInteractionFeedback?.correctQuestionId
    ? itemByQuestionId.get(activeInteractionFeedback.correctQuestionId) || currentPromptItem
    : currentPromptItem;
  const completedQuestionIdSet = isPromptMode(mode)
    ? resolvedQuestionIdSet
    : foundQuestionIdSet;
  const completedCount = completedQuestionIdSet.size;
  const canGiveUpPrompt = mode === IMAGE_MODE_TYPE_PROMPT;
  const canFinishReview = sessionItems.length > 0 && (
    allowPartialSubmit || canGiveUpPrompt || hasAttemptedAnswer || completedCount > 0
  ) && !typedRatingFeedback;
  const answeredCount = foundQuestionIds.length;
  const wrongAnsweredCount = resultMode
    ? lockedMissedQuestionIds.length
    : Math.max(0, completedCount - answeredCount);
  const progressPercent = sessionItems.length
    ? (completedCount / sessionItems.length) * 100
    : 0;

  useEffect(() => {
    // In inline-rating mode the reveal stays until the user rates/continues, so
    // it must not auto-clear. Training keeps the timed flash.
    if (!interactionFeedback || inlineChoiceRating) return undefined;

    const timeout = window.setTimeout(() => {
      setInteractionFeedback(current =>
        current?.id === interactionFeedback.id ? null : current
      );
    }, 1300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [interactionFeedback, inlineChoiceRating]);

  function selectItem(questionId) {
    if (typedRatingFeedback) return false;
    if (mode !== IMAGE_MODE_TYPE_PROMPT || resultMode) return false;
    if (resolvedQuestionIdSet.has(questionId)) return false;

    const target = promptQueue.find(item => item.question_id === questionId);

    if (!target) return false;

    if (currentPromptItem?.question_id !== questionId) {
      setInput("");
      setFeedbackTone(null);
    }

    setActivePromptQuestionId(questionId);
    return true;
  }

  function selectNextItem(direction = 1) {
    if (typedRatingFeedback) return false;
    if (!isPromptMode(mode) || resultMode || !currentPromptItem) {
      return false;
    }

    const target = nextUnresolvedItem(
      promptQueue,
      currentPromptItem.question_id,
      direction,
      resolvedQuestionIdSet
    );

    if (!target) return false;

    if (target.question_id !== currentPromptItem.question_id) {
      setInput("");
      setFeedbackTone(null);
    }

    setActivePromptQuestionId(target.question_id);
    return true;
  }

  function advanceTypePromptAfterResolved(item) {
    if (!isPromptMode(mode) || !item) return;

    const nextResolvedQuestionIds = questionIdSet([
      ...resolvedQuestionIds,
      item.question_id
    ]);
    const nextItem = nextUnresolvedItem(
      promptQueue,
      item.question_id,
      1,
      nextResolvedQuestionIds
    );

    setActivePromptQuestionId(nextItem?.question_id || null);
  }

  function enterResultMode(nextFoundIds, nextQualities, nextResolvedIds = resolvedQuestionIds) {
    const recapQualities = buildRecapQualities(
      sessionItems,
      nextQualities,
      nextFoundIds,
      nextResolvedIds,
      allowPartialSubmit
    );
    const missedIds = sessionItems
      .filter(item => recapQualities[item.question_id] === 0)
      .map(item => item.question_id);

    setLockedMissedQuestionIds(missedIds);
    setRevealedQuestionIds([]);
    setQualityByQuestionId(recapQualities);
    setInput("");
    setFeedbackTone(null);
    setInteractionFeedback(null);
    setTypedRatingFeedback(null);
    setResultMode(true);
    setActivePromptQuestionId(null);
    onAnsweringComplete?.(missedIds);
  }

  function rememberFound(item) {
    if (!item) return foundQuestionIds;

    const nextFoundIds = foundQuestionIds.includes(item.question_id)
      ? foundQuestionIds
      : [...foundQuestionIds, item.question_id];

    setFoundQuestionIds(nextFoundIds);
    setQualityByQuestionId(prev => ({
      ...prev,
      [item.question_id]: prev[item.question_id] ?? defaultImageSuccessQuality()
    }));

    return nextFoundIds;
  }

  function rememberRevealed(item) {
    if (!item) return;

    setRevealedQuestionIds(prev =>
      prev.includes(item.question_id) ? prev : [...prev, item.question_id]
    );
  }

  function rememberResolved(item) {
    if (!item || !isPromptMode(mode)) return;

    setResolvedQuestionIds(prev =>
      prev.includes(item.question_id) ? prev : [...prev, item.question_id]
    );
  }

  function recordAnswer(item, guess) {
    if (guess !== undefined && guess !== null && String(guess).trim()) {
      setHasAttemptedAnswer(true);
    }

    if (!item || guess === undefined || guess === null) return;

    setAnswerByQuestionId(prev => ({ ...prev, [item.question_id]: guess }));
  }

  function markFound(item, guess) {
    if (!item) return;

    recordAnswer(item, guess);

    const nextFoundIds = rememberFound(item);

    rememberResolved(item);
    setInput("");
    setFeedbackTone("correct");

    if (inlineTypedRating) {
      setTypedRatingFeedback({
        id: Date.now(),
        item,
        questionId: item.question_id
      });
      return;
    }

    advanceTypePromptAfterResolved(item);

    if (
      mode === IMAGE_MODE_TYPE_ALL &&
      nextFoundIds.length >= sessionItems.length
    ) {
      enterResultMode(nextFoundIds, {
        ...qualityByQuestionId,
        [item.question_id]: defaultImageSuccessQuality()
      }, resolvedQuestionIds);
    }
  }

  function markMissed(item, guess) {
    if (!item) return;

    recordAnswer(item, guess);
    rememberRevealed(item);
    rememberResolved(item);
    setInput("");
    setFeedbackTone("incorrect");
    advanceTypePromptAfterResolved(item);
  }

  async function submitQualities(qualityMap) {
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      const qualities = submittedQualitiesFromRecap(qualityMap);
      // Relearning items never re-grade: send only the ordinary grades and
      // graduate the "Acquis" ones. "Encore" (0) stays in failedQuestionIds.
      const { graded, graduateIds } = partitionRelearningQualities(
        relearningGroup,
        qualities
      );
      const answers = Object.fromEntries(
        Object.entries(answerByQuestionId).filter(([questionId]) => questionId in graded)
      );
      const fallbackCandidateIds = contextItems
        .map(item => item.question_id)
        .filter(id => id != null);
      const candidates = Object.fromEntries(
        Object.keys(graded).map(questionId => [
          questionId,
          candidateIdsByQuestionId[questionId] || fallbackCandidateIds
        ])
      );

      await Promise.all([
        Object.keys(graded).length > 0
          ? submitAnswer(graded, mode, contextItems.length, answers, candidates)
          : null,
        graduateIds.length > 0 ? graduateAnswer?.(graduateIds) : null
      ].filter(Boolean));

      const failedQuestionIds = Object.entries(qualities)
        .filter(([, quality]) => quality === 0)
        .map(([questionId]) => Number(questionId));

      setInput("");
      setFoundQuestionIds([]);
      setResolvedQuestionIds([]);
      setLockedMissedQuestionIds([]);
      setRevealedQuestionIds([]);
      setQualityByQuestionId({});
      setAnswerByQuestionId({});
      setHasAttemptedAnswer(false);
      setCandidateIdsByQuestionId({});
      setFeedbackTone(null);
      setInteractionFeedback(null);
      setResultMode(false);
      setActivePromptQuestionId(null);
      setRecapSort(initialRecapSort);

      onComplete(failedQuestionIds);
    } finally {
      submittingRef.current = false;
    }
  }

  useEffect(() => {
    if (resultMode || sessionItems.length === 0) return;
    if (interactionFeedback) return;
    if (typedRatingFeedback) return;

    const allComplete = sessionItems.every(item =>
      completedQuestionIdSet.has(item.question_id)
    );

    if (!allComplete) return;

    // Choice modes still end on the recap: buildRecapQualities keeps whatever
    // quality was graded inline, so the recap opens pre-filled and any grade
    // can still be corrected before submitting.
    enterResultMode(foundQuestionIds, qualityByQuestionId, resolvedQuestionIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    completedQuestionIdSet,
    foundQuestionIds,
    interactionFeedback,
    mode,
    qualityByQuestionId,
    allowPartialSubmit,
    resultMode,
    sessionItems,
    typedRatingFeedback
  ]);

  function handleSubmit() {
    if (typedRatingFeedback) return null;
    if (resultMode) return null;

    if (mode === IMAGE_MODE_TYPE_PROMPT) {
      if (currentPromptItem && matchesImageAnswer(currentPromptItem, input)) {
        markFound(currentPromptItem, input);
        return true;
      } else if (input.trim()) {
        recordAnswer(currentPromptItem, input);
        setFeedbackTone("incorrect");
        return false;
      }

      return null;
    }

    if (mode !== IMAGE_MODE_TYPE_ALL) return null;

    const match = sessionItems.find(item => matchesImageAnswer(item, input));

    if (match && !foundQuestionIdSet.has(match.question_id)) {
      markFound(match, input);
      return true;
    } else if (match) {
      setFeedbackTone("duplicate");
      return "duplicate";
    } else if (input.trim()) {
      recordAnswer(null, input);
      setFeedbackTone("incorrect");
      return false;
    }

    return null;
  }

  function handleImageSelect(questionId) {
    if (
      resultMode ||
      mode !== IMAGE_MODE_MULTIPLE_CHOICE_IMAGE ||
      !currentPromptItem ||
      interactionFeedback
    ) {
      return;
    }

    const isCorrect = currentPromptItem.question_id === questionId;

    setInteractionFeedback({
      id: Date.now(),
      correctQuestionId: currentPromptItem.question_id,
      isCorrect,
      options: choiceOptions,
      selectedQuestionId: questionId
    });
    setCandidateIdsByQuestionId(prev => ({
      ...prev,
      [currentPromptItem.question_id]: choiceOptions
        .map(option => option.question_id)
        .filter(id => id != null)
    }));

    // The pick is an image, so the option's question id is the answer.
    if (isCorrect) {
      markFound(currentPromptItem, questionId);
    } else {
      markMissed(currentPromptItem, questionId);
    }
  }

  function handleChoiceSelect(questionId) {
    if (
      resultMode ||
      mode !== IMAGE_MODE_MULTIPLE_CHOICE_LABEL ||
      !currentPromptItem ||
      interactionFeedback
    ) {
      return;
    }

    const isCorrect = currentPromptItem.question_id === questionId;
    setInteractionFeedback({
      id: Date.now(),
      correctQuestionId: currentPromptItem.question_id,
      isCorrect,
      options: choiceOptions,
      selectedQuestionId: questionId
    });
    setCandidateIdsByQuestionId(prev => ({
      ...prev,
      [currentPromptItem.question_id]: choiceOptions
        .map(option => option.question_id)
        .filter(id => id != null)
    }));

    if (isCorrect) {
      markFound(currentPromptItem, questionId);
    } else {
      markMissed(currentPromptItem, questionId);
    }
  }

  function skipCurrentPrompt() {
    if (typedRatingFeedback) return;
    if (mode !== IMAGE_MODE_TYPE_PROMPT || !currentPromptItem) return;

    selectNextItem(1);
  }

  function finishReview() {
    if (!canFinishReview || typedRatingFeedback) return false;

    enterResultMode(foundQuestionIds, qualityByQuestionId, resolvedQuestionIds);
    return true;
  }

  function setQuality(questionId, quality) {
    if (quality === IMAGE_RECAP_UNANSWERED) {
      setQualityByQuestionId(prev => ({
        ...prev,
        [questionId]: IMAGE_RECAP_UNANSWERED
      }));
      return;
    }

    const nextQuality = Number(quality);

    if (![0, 1, 2, 3].includes(nextQuality)) {
      return;
    }

    setQualityByQuestionId(prev => ({
      ...prev,
      [questionId]: nextQuality
    }));
  }

  function setFoundImageQualities(quality) {
    const nextQuality = Number(quality);

    if (![1, 2, 3].includes(nextQuality)) {
      return;
    }

    setQualityByQuestionId(prev => {
      if (foundQuestionIdSet.size === 0) return prev;

      const next = { ...prev };
      foundQuestionIdSet.forEach(id => {
        next[id] = nextQuality;
      });

      return next;
    });
  }

  function toggleRecapSort(key) {
    setRecapSort(prev => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  }

  async function sendResult() {
    await submitQualities(qualityByQuestionId);
  }

  // Inline rating: grade the just-revealed choice (correct picks only) and clear
  // the reveal so the next prompt surfaces. A wrong pick stays quality 0.
  function rateChoice(quality) {
    if (!interactionFeedback || !inlineChoiceRating) return;
    if (interactionFeedback.rated) return;

    const { id, correctQuestionId } = interactionFeedback;

    // Mark the pick rated (drives the button's animation + disables its
    // siblings) without touching the fields the tile's own reveal animation
    // and useFlip key depend on, then hold the actual grade+advance until
    // that animation has had time to finish.
    setInteractionFeedback(current =>
      current?.id === id ? { ...current, rated: true, ratedQuality: quality } : current
    );

    choiceRateTimeoutRef.current = window.setTimeout(() => {
      if (quality !== undefined && quality !== null) {
        setQuality(correctQuestionId, quality);
      }

      setInteractionFeedback(current => (current?.id === id ? null : current));
    }, qualityPickHoldMs(quality ?? 0));
  }

  function rateTypedAnswer(quality = defaultImageSuccessQuality()) {
    if (!typedRatingFeedback || !inlineTypedRating) return;
    if (typedRatingFeedback.rated) return;

    const nextQuality = Number(quality);

    if (![1, 2, 3].includes(nextQuality)) return;

    const { id, questionId, item } = typedRatingFeedback;

    setTypedRatingFeedback(current =>
      current?.id === id ? { ...current, rated: true, ratedQuality: nextQuality } : current
    );

    typedRateTimeoutRef.current = window.setTimeout(() => {
      setQuality(questionId, nextQuality);
      setTypedRatingFeedback(current => (current?.id === id ? null : current));
      advanceTypePromptAfterResolved(item);
    }, qualityPickHoldMs(nextQuality));
  }

  const displayItems = useMemo(() => {
    if (mode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE && !resultMode) {
      return visibleChoiceOptions;
    }

    if (mode === IMAGE_MODE_MULTIPLE_CHOICE_LABEL && !resultMode) {
      return visualPromptItem ? [visualPromptItem] : [];
    }

    return sessionItems;
  }, [
    mode,
    resultMode,
    sessionItems,
    visibleChoiceOptions,
    visualPromptItem
  ]);
  const activeQuestionIdForGrid = (
    typedRatingFeedback?.questionId ||
    activeInteractionFeedback?.correctQuestionId ||
    activeItem?.question_id ||
    null
  );
  const gridItems = useMemo(() => (
    displayItems.map(item => {
      const showsChoiceImages = mode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE && !resultMode;
      const isFound = (
        !showsChoiceImages &&
        foundQuestionIdSet.has(item.question_id)
      );
      const isLockedMissed = lockedMissedQuestionIdSet.has(item.question_id);
      const isSessionMissed = (
        !showsChoiceImages &&
        resolvedQuestionIdSet.has(item.question_id) &&
        !isFound
      );
      const feedbackState = activeInteractionFeedback
        ? item.question_id === activeInteractionFeedback.selectedQuestionId &&
          item.question_id !== activeInteractionFeedback.correctQuestionId
          ? "wrong"
          : item.question_id === activeInteractionFeedback.correctQuestionId
            ? activeInteractionFeedback.isCorrect ? "correct" : "missed"
            : ""
        : "";
      const isPersistentlyRevealed = revealedQuestionIdSet.has(item.question_id);
      const isMissed = (
        isLockedMissed ||
        isSessionMissed ||
        feedbackState === "missed"
      );
      const isRevealed = (
        isFound ||
        isLockedMissed ||
        (!showsChoiceImages && isPersistentlyRevealed) ||
        feedbackState === "correct" ||
        feedbackState === "wrong" ||
        feedbackState === "missed"
      );

      return {
        item,
        isActive: (
          !resultMode &&
          activeQuestionIdForGrid === item.question_id
        ),
        feedbackState,
        isFound,
        isMissed,
        isLockedMissed,
        isRevealed,
        quality: isFound
          ? qualityByQuestionId[item.question_id] ?? defaultImageSuccessQuality()
          : isLockedMissed
            ? 0
            : null
      };
    })
  ), [
    activeInteractionFeedback,
    activeQuestionIdForGrid,
    displayItems,
    foundQuestionIdSet,
    lockedMissedQuestionIdSet,
    mode,
    qualityByQuestionId,
    revealedQuestionIdSet,
    resolvedQuestionIdSet,
    resultMode
  ]);
  const foundBulkQuality = useMemo(() => {
    if (foundQuestionIds.length === 0) return null;

    const firstQuality = qualityByQuestionId[foundQuestionIds[0]] ??
      defaultImageSuccessQuality();

    return foundQuestionIds.every(
      questionId => (
        qualityByQuestionId[questionId] ?? defaultImageSuccessQuality()
      ) === firstQuality
    )
      ? firstQuality
      : null;
  }, [foundQuestionIds, qualityByQuestionId]);
  const recapSubmittedQualities = Object.values(qualityByQuestionId)
    .filter(quality => quality !== IMAGE_RECAP_UNANSWERED);
  const recapSuccessCount = recapSubmittedQualities
    .filter(quality => Number(quality) > 0)
    .length;
  const recapMissCount = recapSubmittedQualities
    .filter(quality => Number(quality) === 0)
    .length;
  const recapUnansweredCount = Object.values(qualityByQuestionId)
    .filter(quality => quality === IMAGE_RECAP_UNANSWERED)
    .length;
  const recapPlayedCount = recapSuccessCount + recapMissCount;
  const recapSuccessRate = recapPlayedCount
    ? Math.round((recapSuccessCount / recapPlayedCount) * 100)
    : 0;
  const recapRows = useMemo(() => (
    sessionItems
      .map(item => {
        const historyStats = getHistoryStats(item);
        const isFound = foundQuestionIdSet.has(item.question_id);
        const canBeUnanswered = (
          allowPartialSubmit &&
          !isFound &&
          !resolvedQuestionIdSet.has(item.question_id)
        );
        const selectedQuality = getSelectedQuality(
          item,
          isFound,
          qualityByQuestionId
        );

        return {
          item,
          historyStats,
          isFound,
          canBeUnanswered,
          difficultyScore: getDifficultyScore(item, historyStats),
          isUnanswered: selectedQuality === IMAGE_RECAP_UNANSWERED,
          selectedQuality,
          projectedInterval: getProjectedInterval(
            item,
            selectedQuality,
            isRelearningGroupItem(relearningGroup, item)
          )
        };
      })
      .sort((a, b) => {
        if (a.isFound !== b.isFound) {
          return a.isFound ? -1 : 1;
        }

        if (!recapSort.key) {
          return compareDefaultRecapRows(a, b);
        }

        const sortResult = compareActiveRecapSort(
          a,
          b,
          recapSort,
          qualityByQuestionId
        );

        if (sortResult !== 0) {
          return recapSort.direction === "asc" ? sortResult : -sortResult;
        }

        return compareDefaultRecapRows(a, b);
      })
  ), [
    allowPartialSubmit,
    foundQuestionIdSet,
    qualityByQuestionId,
    recapSort,
    relearningGroup,
    resolvedQuestionIdSet,
    sessionItems
  ]);

  return {
    activeItem,
    activeQuestionId: activeQuestionIdForGrid,
    answeredCount,
    canFinishReview,
    choiceOptions: visibleChoiceOptions,
    currentPromptItem,
    feedbackTone,
    finishReview,
    foundQuestionIds,
    foundBulkQuality,
    gridItems,
    handleChoiceSelect,
    handleImageSelect,
    handleSubmit,
    input,
    interactionFeedback: activeInteractionFeedback,
    lockedMissedQuestionIds,
    mode,
    progressPercent,
    promptLabel: visualPromptItem?.label || visualPromptItem?.answer || "",
    qualityByQuestionId,
    rateChoice,
    rateTypedAnswer,
    recapMissCount,
    recapRows,
    recapSort,
    recapSuccessCount,
    recapSuccessRate,
    recapUnansweredCount,
    remainingCount: Math.max(0, sessionItems.length - completedCount),
    resolvedQuestionIds,
    resolvedQuestionIdsRecentFirst,
    resultMode,
    revealedQuestionIds,
    selectItem,
    selectNextItem,
    sendResult,
    setFoundImageQualities,
    setInput,
    setQuality,
    skipCurrentPrompt,
    typedRatingFeedback,
    toggleRecapSort,
    wrongAnsweredCount
  };
}

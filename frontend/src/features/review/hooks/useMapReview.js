import { useEffect, useMemo, useRef, useState } from "react";
import { sendMapAnswer } from "../../../api/review";
import { partitionRelearningQualities } from "../relearningGrades";
import {
  MAP_MODE_CLICK_PROMPT,
  MAP_MODE_MULTIPLE_CHOICE,
  MAP_MODE_TYPE_ALL,
  MAP_MODE_TYPE_PROMPT,
  normalizeMapMode
} from "../mapModes";
import { matchesAnswerValue } from "../answerPolicy";
import { buildChoiceOptions as buildConfusableChoiceOptions } from "../distractorSelection";
import { qualityPickHoldMs } from "../../../shared/answerFeedback";

export const MAP_RECAP_UNANSWERED = "unanswered";


function getHistoryStats(item) {
  // Prefer detailed history when present; fall back to reps/lapses for older
  // progress records.
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
  // Recap sorting uses explicit scheduler difficulty when available, otherwise
  // estimates from success rate.
  const explicitDifficulty = Number(item.progress?.difficulty);

  if (Number.isFinite(explicitDifficulty)) {
    return explicitDifficulty;
  }

  if (historyStats.successRate !== null) {
    return 10 - (historyStats.successRate / 10);
  }

  return 5;
}


function getNextRemainingZone(reviewZones, completedQuestionIdSet, currentCode, direction = 1) {
  if (reviewZones.length === 0) return null;

  const step = direction < 0 ? -1 : 1;
  const currentIndex = reviewZones.findIndex(item => item.code === currentCode);
  const startIndex = currentIndex >= 0 ? currentIndex : step > 0 ? -1 : 0;

  for (let offset = 1; offset <= reviewZones.length; offset += 1) {
    const index = (startIndex + (offset * step) + reviewZones.length) % reviewZones.length;
    const item = reviewZones[index];

    if (item && !completedQuestionIdSet.has(item.question_id)) {
      return item;
    }
  }

  return null;
}


const initialRecapSort = {
  key: null,
  direction: "asc"
};
function getSelectedQuality(item, isFound, qualityByQuestionId) {
  return qualityByQuestionId[item.question_id] ?? (isFound ? 2 : 0);
}


function getProjectedInterval(item, selectedQuality) {
  if (selectedQuality === MAP_RECAP_UNANSWERED) return null;

  const value =
    item.projected_intervals?.[selectedQuality] ??
    item.progress?.interval ??
    0;
  const interval = Number(value);

  return Number.isFinite(interval) ? interval : 0;
}


function qualityMapSortValue(quality) {
  return quality === MAP_RECAP_UNANSWERED ? -1 : Number(quality);
}


function nextUnresolvedMapItem(items, startQuestionId, direction, resolvedSet) {
  if (!items.length) return null;

  const step = direction < 0 ? -1 : 1;
  const startIndex = items.findIndex(item => item.question_id === startQuestionId);
  const anchorIndex = startIndex >= 0 ? startIndex : step > 0 ? -1 : 0;

  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (anchorIndex + (offset * step) + items.length) % items.length;
    const item = items[index];

    if (!resolvedSet.has(item.question_id)) {
      return item;
    }
  }

  return null;
}


function buildMapRecapQualities(
  reviewZones,
  foundQuestionIdSet,
  resolvedQuestionIdSet,
  allowPartialSubmit
) {
  const qualities = {};

  reviewZones.forEach(item => {
    const qid = item.question_id;

    if (foundQuestionIdSet.has(qid)) {
      qualities[qid] = 2;
    } else if (allowPartialSubmit && !resolvedQuestionIdSet.has(qid)) {
      qualities[qid] = MAP_RECAP_UNANSWERED;
    } else {
      qualities[qid] = 0;
    }
  });

  return qualities;
}


function submittedMapQualities(qualityByQuestionId) {
  return Object.fromEntries(
    Object.entries(qualityByQuestionId).filter(([, q]) => q !== MAP_RECAP_UNANSWERED)
  );
}


function failedMapQuestionIds(qualityByQuestionId) {
  return Object.entries(submittedMapQualities(qualityByQuestionId))
    .filter(([, quality]) => quality === 0)
    .map(([questionId]) => Number(questionId));
}


function compareDefaultRecapRows(a, b) {
  if (b.difficultyScore !== a.difficultyScore) {
    return b.difficultyScore - a.difficultyScore;
  }

  return String(a.item.label || "").localeCompare(String(b.item.label || ""));
}


function compareActiveRecapSort(a, b, recapSort, qualityByQuestionId) {
  if (recapSort.key === "answer") {
    return String(a.item.label || "").localeCompare(String(b.item.label || ""));
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
      qualityMapSortValue(getSelectedQuality(a.item, a.isFound, qualityByQuestionId)) -
      qualityMapSortValue(getSelectedQuality(b.item, b.isFound, qualityByQuestionId))
    );
  }

  return 0;
}


function itemMatchesInput(item, input) {
  return matchesAnswerValue(item, input);
}


function shuffle(items) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}


function resetDistractorUsageForReviewKey(ref, reviewKey) {
  if (ref.current.reviewKey !== reviewKey) {
    ref.current = {
      reviewKey,
      counts: new Map(),
      recordedChoiceKeys: new Set()
    };
  }

  return ref.current;
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


function itemKey(items) {
  return (items || []).map(item => item.question_id).join("|");
}


export function useMapReview(
  reviewZones,
  onComplete,
  submitAnswer = sendMapAnswer,
  options = {}
) {
  // This hook turns a runtime map group into an interactive recall session:
  // matching typed answers, prompt resolution, recap quality editing, and
  // per-zone grade submission.
  const mode = normalizeMapMode(options.mode);
  const allowPartialSubmit = Boolean(options.allowPartialSubmit);
  const onAnsweringComplete = options.onAnsweringComplete;
  // Review grades each QCM pick inline (reveal + quality) then auto-submits the
  // group when the last zone is rated. Training keeps the legacy flash + recap.
  const inlineChoiceRating = Boolean(options.inlineChoiceRating) && mode === MAP_MODE_MULTIPLE_CHOICE;
  const inlineClickRating = Boolean(options.inlineClickRating) && mode === MAP_MODE_CLICK_PROMPT;
  const inlineTypedRating = Boolean(options.inlineTypedRating) && (
    mode === MAP_MODE_TYPE_ALL ||
    mode === MAP_MODE_TYPE_PROMPT
  );
  const contextItems = options.contextItems?.length
    ? options.contextItems
    : reviewZones;
  const mapGeometry = options.mapGeometry;
  const relearningGroup = options.group;
  const graduateAnswer = options.graduateAnswer;
  const isPromptMode = mode !== MAP_MODE_TYPE_ALL;
  const [input, setInput] = useState("");
  const [foundQuestionIds, setFoundQuestionIds] = useState([]);
  const [resolvedQuestionIds, setResolvedQuestionIds] = useState([]);
  const [showRecap, setShowRecap] = useState(false);
  const [qualityByQuestionId, setQualityByQuestionId] = useState({});
  // What the learner actually typed/clicked/picked per zone, for M0 0.1
  // (storing the given answer). Keyed like qualityByQuestionId.
  const [answerByQuestionId, setAnswerByQuestionId] = useState({});
  const [hasAttemptedAnswer, setHasAttemptedAnswer] = useState(false);
  const [candidateIdsByQuestionId, setCandidateIdsByQuestionId] = useState({});
  const [focusedCode, setFocusedCode] = useState(null);
  const [remainingFocusCode, setRemainingFocusCode] = useState(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [incorrectFlashId, setIncorrectFlashId] = useState(0);
  const [correctFlashId, setCorrectFlashId] = useState(0);
  const [duplicateFlashId, setDuplicateFlashId] = useState(0);
  const [choiceFeedback, setChoiceFeedback] = useState(null);
  const [clickRatingFeedback, setClickRatingFeedback] = useState(null);
  const [typedRatingFeedback, setTypedRatingFeedback] = useState(null);
  // Once a click/typed pick is graded, the real feedback clears immediately
  // so the next zone/prompt becomes interactive right away. These hold a
  // fading echo of what was just picked purely so the rating panel can keep
  // animating the choice without blocking anything.
  const [clickRatingEcho, setClickRatingEcho] = useState(null);
  const [typedRatingEcho, setTypedRatingEcho] = useState(null);
  const [zoneFeedback, setZoneFeedback] = useState(null);
  const [recapSort, setRecapSort] = useState(initialRecapSort);
  const [activePromptQuestionId, setActivePromptQuestionId] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const choiceRateTimeoutRef = useRef(null);
  const clickEchoTimeoutRef = useRef(null);
  const typedEchoTimeoutRef = useRef(null);
  const reviewKey = `${mode}:${itemKey(reviewZones)}`;
  const distractorUsageRef = useRef({
    reviewKey: null,
    counts: new Map(),
    recordedChoiceKeys: new Set()
  });
  // distractorUsageRef holds per-review distractor cooldown counts that must
  // survive re-renders without triggering them, and be read during render to
  // seed choiceOptions below. The reviewKey-based reset is mirrored in the
  // effect below; reading the ref here is intentional.
  const distractorUsage = resetDistractorUsageForReviewKey(distractorUsageRef, reviewKey);

  useEffect(() => {
    window.clearTimeout(choiceRateTimeoutRef.current);
    window.clearTimeout(clickEchoTimeoutRef.current);
    window.clearTimeout(typedEchoTimeoutRef.current);
    setInput("");
    setFoundQuestionIds([]);
    setResolvedQuestionIds([]);
    setShowRecap(false);
    setQualityByQuestionId({});
    setAnswerByQuestionId({});
    setHasAttemptedAnswer(false);
    setCandidateIdsByQuestionId({});
    setFocusedCode(null);
    setRemainingFocusCode(null);
    setFocusVersion(0);
    setIncorrectFlashId(0);
    setCorrectFlashId(0);
    setDuplicateFlashId(0);
    setChoiceFeedback(null);
    setClickRatingFeedback(null);
    setTypedRatingFeedback(null);
    setClickRatingEcho(null);
    setTypedRatingEcho(null);
    setZoneFeedback(null);
    setRecapSort(initialRecapSort);
    setActivePromptQuestionId(null);
    setSubmitError("");
    setSubmitting(false);
    submittingRef.current = false;
    distractorUsageRef.current = {
      reviewKey,
      counts: new Map(),
      recordedChoiceKeys: new Set()
    };
  }, [reviewKey]);

  useEffect(() => () => {
    window.clearTimeout(choiceRateTimeoutRef.current);
    window.clearTimeout(clickEchoTimeoutRef.current);
    window.clearTimeout(typedEchoTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!incorrectFlashId && !correctFlashId && !duplicateFlashId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIncorrectFlashId(0);
      setCorrectFlashId(0);
      setDuplicateFlashId(0);
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [incorrectFlashId, correctFlashId, duplicateFlashId]);

  useEffect(() => {
    // Inline rating keeps the reveal on screen until the user rates/continues.
    if (!choiceFeedback || inlineChoiceRating) return undefined;

    const timeout = window.setTimeout(() => {
      setChoiceFeedback(current =>
        current?.id === choiceFeedback.id ? null : current
      );
    }, 1300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [choiceFeedback, inlineChoiceRating]);

  useEffect(() => {
    if (!zoneFeedback) return undefined;

    const timeout = window.setTimeout(() => {
      setZoneFeedback(current =>
        current?.id === zoneFeedback.id ? null : current
      );
    }, 800);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [zoneFeedback]);

  const promptQueue = useMemo(
    () => {
      // Lock the random order to the current mode/session key.
      const currentReviewKey = reviewKey;

      return currentReviewKey && isPromptMode ? shuffle(reviewZones) : reviewZones;
    },
    [isPromptMode, reviewKey, reviewZones]
  );

  const foundQuestionIdSet = useMemo(
    () => new Set(foundQuestionIds),
    [foundQuestionIds]
  );

  const resolvedQuestionIdSet = useMemo(
    () => new Set(resolvedQuestionIds),
    [resolvedQuestionIds]
  );

  const completedQuestionIdSet = isPromptMode
    ? resolvedQuestionIdSet
    : foundQuestionIdSet;

  const currentPromptItem = useMemo(
    () => {
      if (!isPromptMode) return null;

      if (activePromptQuestionId !== null) {
        const activeItem = promptQueue.find(item =>
          item.question_id === activePromptQuestionId &&
          !resolvedQuestionIdSet.has(item.question_id)
        );

        if (activeItem) return activeItem;
      }

      return promptQueue.find(item => !resolvedQuestionIdSet.has(item.question_id)) || null;
    },
    [activePromptQuestionId, isPromptMode, promptQueue, resolvedQuestionIdSet]
  );

  const choiceOptions = useMemo(
    () => buildConfusableChoiceOptions(
      currentPromptItem,
      contextItems,
      distractorUsage.counts,
      resolvedQuestionIdSet,
      { geometry: mapGeometry }
    ),
    // Cooldown counts and the answered-question exclusion set live in mutable
    // per-review state; they should affect the next prompt sample, not resample
    // the current prompt when they update mid-prompt. The memo already recomputes
    // when currentPromptItem advances, at which point resolvedQuestionIdSet
    // reflects the just-answered question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextItems, currentPromptItem, mapGeometry]
  );

  useEffect(() => {
    if (mode !== MAP_MODE_MULTIPLE_CHOICE) return;

    recordDistractorUsage(
      distractorUsageRef.current,
      currentPromptItem,
      choiceOptions
    );
  }, [choiceOptions, currentPromptItem, mode]);

  const foundCodes = useMemo(
    () =>
      reviewZones
        .filter(item => foundQuestionIdSet.has(item.question_id))
        .map(item => item.code),
    [foundQuestionIdSet, reviewZones]
  );

  const missedCodes = useMemo(
    () =>
      reviewZones
        .filter(item => !foundQuestionIdSet.has(item.question_id))
        .map(item => item.code),
    [foundQuestionIdSet, reviewZones]
  );

  const activeMissedCodes = useMemo(
    () =>
      reviewZones
        .filter(item =>
          resolvedQuestionIdSet.has(item.question_id) &&
          !foundQuestionIdSet.has(item.question_id)
        )
        .map(item => item.code),
    [foundQuestionIdSet, resolvedQuestionIdSet, reviewZones]
  );

  const remainingZones = useMemo(
    () =>
      reviewZones.filter(item => !completedQuestionIdSet.has(item.question_id)),
    [completedQuestionIdSet, reviewZones]
  );

  const contextByCode = useMemo(() => {
    const lookup = new Map();

    contextItems.forEach(item => {
      if (item?.code && !lookup.has(item.code)) {
        lookup.set(item.code, item);
      }
    });

    return lookup;
  }, [contextItems]);

  const dueCodes = useMemo(() => {
    if (mode === MAP_MODE_TYPE_PROMPT || mode === MAP_MODE_MULTIPLE_CHOICE) {
      return currentPromptItem?.code ? [currentPromptItem.code] : [];
    }

    if (mode === MAP_MODE_CLICK_PROMPT) {
      // Keep the whole review context clickable even when only a subset of
      // zones is prompted (e.g. failed-retry passes), so the pick never
      // degenerates to a handful of highlighted zones.
      return contextItems
        .filter(item => item?.code && !resolvedQuestionIdSet.has(item.question_id))
        .map(item => item.code);
    }

    return remainingZones.map(item => item.code);
  }, [contextItems, currentPromptItem, mode, remainingZones, resolvedQuestionIdSet]);

  async function submitQualities(qualityMap) {
    // Send one quality per atomic map question, then tell the parent review
    // session which zones should be re-queued. Unanswered items are omitted.
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");

    try {
      const qualities = submittedMapQualities(qualityMap);
      // Relearning zones never re-grade: send only the ordinary grades and
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

      setShowRecap(false);
      setFoundQuestionIds([]);
      setResolvedQuestionIds([]);
      setQualityByQuestionId({});
      setAnswerByQuestionId({});
      setHasAttemptedAnswer(false);
      setCandidateIdsByQuestionId({});
      setFocusedCode(null);
      setRemainingFocusCode(null);
      setFocusVersion(0);
      setChoiceFeedback(null);
      setClickRatingFeedback(null);
      setTypedRatingFeedback(null);

      onComplete(failedQuestionIds);
      return true;
    } catch (error) {
      console.error(error);
      setSubmitError(error?.message || "Enregistrement impossible.");
      return false;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (showRecap || reviewZones.length === 0) return;
    if (mode === MAP_MODE_MULTIPLE_CHOICE && choiceFeedback) return;
    if (clickRatingFeedback) return;
    if (typedRatingFeedback) return;

    const allZonesComplete = reviewZones.every(item =>
      completedQuestionIdSet.has(item.question_id)
    );

    if (!allZonesComplete) return;

    // buildMapRecapQualities rebuilds every grade from found/missed, which would
    // discard the qualities graded inline. Overlay them so the recap opens
    // pre-filled and any grade can still be corrected before submitting.
    const nextQualities = {
      ...buildMapRecapQualities(
        reviewZones, foundQuestionIdSet, resolvedQuestionIdSet, allowPartialSubmit
      ),
      ...qualityByQuestionId
    };

    setQualityByQuestionId(nextQualities);
    setShowRecap(true);
    onAnsweringComplete?.(failedMapQuestionIds(nextQualities));
  }, [
    allowPartialSubmit,
    completedQuestionIdSet,
    choiceFeedback,
    clickRatingFeedback,
    foundQuestionIdSet,
    mode,
    onAnsweringComplete,
    qualityByQuestionId,
    resolvedQuestionIdSet,
    reviewZones,
    showRecap,
    typedRatingFeedback
  ]);

  function rememberFound(item) {
    if (!item) return;

    setFoundQuestionIds(prev =>
      prev.includes(item.question_id) ? prev : [...prev, item.question_id]
    );
  }

  function rememberResolved(item) {
    if (!item || !isPromptMode) return;

    setResolvedQuestionIds(prev =>
      prev.includes(item.question_id) ? prev : [...prev, item.question_id]
    );
  }

  function advanceAfterResolved(item) {
    if (!isPromptMode || !item) return;

    const nextResolvedSet = new Set([...resolvedQuestionIds, item.question_id]);
    const nextItem = nextUnresolvedMapItem(
      promptQueue,
      item.question_id,
      1,
      nextResolvedSet
    );

    setActivePromptQuestionId(nextItem?.question_id || null);
  }

  function selectNextPrompt(direction = 1) {
    if (clickRatingFeedback) return;
    if (typedRatingFeedback) return;
    if (!isPromptMode || !currentPromptItem) return;

    const target = nextUnresolvedMapItem(
      promptQueue,
      currentPromptItem.question_id,
      direction,
      resolvedQuestionIdSet
    );

    if (!target || target.question_id === currentPromptItem.question_id) return;

    setInput("");
    setActivePromptQuestionId(target.question_id);
  }

  function recordAnswer(item, guess) {
    if (guess !== undefined && guess !== null && String(guess).trim()) {
      setHasAttemptedAnswer(true);
    }

    if (!item || guess === undefined || guess === null) return;

    setAnswerByQuestionId(prev => ({ ...prev, [item.question_id]: guess }));
  }

  function markFound(item, guess) {
    // Do not count a zone twice if the user types an alias after finding it.
    if (!item || foundQuestionIdSet.has(item.question_id)) return;

    recordAnswer(item, guess);
    rememberFound(item);
    rememberResolved(item);
    setCorrectFlashId(Date.now());
    setIncorrectFlashId(0);
    setDuplicateFlashId(0);
    setInput("");

    if (inlineTypedRating) {
      setTypedRatingFeedback({
        id: Date.now(),
        item,
        questionId: item.question_id
      });
      return;
    }

    if (inlineClickRating) {
      setClickRatingFeedback({
        id: Date.now(),
        item,
        questionId: item.question_id
      });
      return;
    }

    advanceAfterResolved(item);
  }

  function markMissed(item, guess) {
    if (!item) return;

    recordAnswer(item, guess);
    rememberResolved(item);
    setIncorrectFlashId(Date.now());
    setCorrectFlashId(0);
    setDuplicateFlashId(0);
    setInput("");
    advanceAfterResolved(item);
  }

  function handleSubmit() {
    if (clickRatingFeedback) return null;
    if (typedRatingFeedback) return null;

    if (mode === MAP_MODE_TYPE_PROMPT) {
      if (currentPromptItem && itemMatchesInput(currentPromptItem, input)) {
        markFound(currentPromptItem, input);
        return true;
      } else if (input.trim()) {
        recordAnswer(currentPromptItem, input);
        setIncorrectFlashId(Date.now());
        setCorrectFlashId(0);
        return false;
      }

      return null;
    }

    if (mode !== MAP_MODE_TYPE_ALL) return null;

    const match = reviewZones.find(item => itemMatchesInput(item, input));

    if (match && !foundQuestionIdSet.has(match.question_id)) {
      markFound(match, input);
      return true;
    } else if (match) {
      setDuplicateFlashId(Date.now());
      setCorrectFlashId(0);
      setIncorrectFlashId(0);
      return "duplicate";
    } else if (input.trim()) {
      recordAnswer(null, input);
      setIncorrectFlashId(Date.now());
      setCorrectFlashId(0);
      setDuplicateFlashId(0);
      return false;
    }

    setInput("");
    return null;
  }

  function handleZoneSelect(code) {
    if (mode !== MAP_MODE_CLICK_PROMPT || !currentPromptItem || clickRatingFeedback) {
      return;
    }

    if (currentPromptItem.code === code) {
      markFound(currentPromptItem, currentPromptItem.question_id);
      return;
    }

    // Any other zone in the clickable pool — including context-only distractors
    // that are not themselves being prompted — counts as a wrong answer for the
    // current prompt.
    const clickedItem = contextByCode.get(code);

    if (!clickedItem || resolvedQuestionIdSet.has(clickedItem.question_id)) {
      return;
    }

    setZoneFeedback({
      id: Date.now(),
      flashCodes: [code]
    });
    markMissed(currentPromptItem, clickedItem.question_id);
  }

  function handleChoiceSelect(questionId) {
    if (
      mode !== MAP_MODE_MULTIPLE_CHOICE ||
      !currentPromptItem ||
      choiceFeedback
    ) {
      return;
    }

    const isCorrect = currentPromptItem.question_id === questionId;
    setCandidateIdsByQuestionId(prev => ({
      ...prev,
      [currentPromptItem.question_id]: choiceOptions
        .map(option => option.question_id)
        .filter(id => id != null)
    }));

    setChoiceFeedback({
      id: Date.now(),
      correctCode: currentPromptItem.code,
      correctQuestionId: currentPromptItem.question_id,
      isCorrect,
      options: choiceOptions,
      selectedQuestionId: questionId
    });

    if (isCorrect) {
      markFound(currentPromptItem, questionId);
    } else {
      markMissed(currentPromptItem, questionId);
    }
  }

  function skipCurrentPrompt() {
    if (clickRatingFeedback) return;
    if (typedRatingFeedback) return;
    selectNextPrompt(1);
  }

  function focusNextRemainingZone(direction = 1) {
    if (currentPromptItem) {
      setRemainingFocusCode(currentPromptItem.code);
      setFocusVersion(version => version + 1);
      return;
    }

    const nextCode = getNextRemainingZone(
      reviewZones,
      completedQuestionIdSet,
      remainingFocusCode,
      direction
    )?.code;

    if (!nextCode) return;

    setRemainingFocusCode(nextCode);
    setFocusVersion(version => version + 1);
  }

  function finishMap() {
    if (clickRatingFeedback || typedRatingFeedback || !(reviewZones.length > 0 && (
      allowPartialSubmit ||
      mode === MAP_MODE_TYPE_PROMPT ||
      hasAttemptedAnswer ||
      completedQuestionIdSet.size > 0
    ))) {
      return false;
    }

    const nextQualities = buildMapRecapQualities(
      reviewZones, foundQuestionIdSet, resolvedQuestionIdSet, allowPartialSubmit
    );

    setQualityByQuestionId(nextQualities);
    setShowRecap(true);
    onAnsweringComplete?.(failedMapQuestionIds(nextQualities));
    return true;
  }

  async function sendResult() {
    await submitQualities(qualityByQuestionId);
  }

  // Inline rating: grade the just-revealed pick (correct picks only) and clear
  // the reveal so the next prompt surfaces. A wrong pick stays quality 0.
  function rateChoice(quality) {
    if (!choiceFeedback || !inlineChoiceRating) return;
    if (choiceFeedback.rated) return;

    const { id, correctQuestionId } = choiceFeedback;

    // Mark the pick rated (drives the button's animation + disables its
    // siblings) without touching the fields the tile's own reveal animation
    // and useFlip key depend on, then hold the actual grade+advance until
    // that animation has had time to finish.
    setChoiceFeedback(current =>
      current?.id === id ? { ...current, rated: true, ratedQuality: quality } : current
    );

    choiceRateTimeoutRef.current = window.setTimeout(() => {
      if (quality !== undefined && quality !== null) {
        setQuality(correctQuestionId, quality);
      }

      setChoiceFeedback(current => (current?.id === id ? null : current));
    }, qualityPickHoldMs(quality ?? 0));
  }

  function rateClickAnswer(quality = 2) {
    if (!clickRatingFeedback || !inlineClickRating) return;

    const nextQuality = Number(quality);

    if (![1, 2, 3].includes(nextQuality)) return;

    const { id, questionId, item } = clickRatingFeedback;

    // Commit and advance immediately so the map zooms to the next zone and
    // starts accepting its answer right away. The panel keeps echoing this
    // pick — purely a fading animation, no longer blocking anything — until
    // it's had time to finish.
    setQuality(questionId, nextQuality);
    setClickRatingFeedback(null);
    advanceAfterResolved(item);

    setClickRatingEcho({ id, item, questionId, ratedQuality: nextQuality });
    window.clearTimeout(clickEchoTimeoutRef.current);
    clickEchoTimeoutRef.current = window.setTimeout(() => {
      setClickRatingEcho(current => (current?.id === id ? null : current));
    }, qualityPickHoldMs(nextQuality));
  }

  function rateTypedAnswer(quality = 2) {
    if (!typedRatingFeedback || !inlineTypedRating) return;

    const nextQuality = Number(quality);

    if (![1, 2, 3].includes(nextQuality)) return;

    const { id, questionId, item } = typedRatingFeedback;

    setQuality(questionId, nextQuality);
    setTypedRatingFeedback(null);
    advanceAfterResolved(item);

    setTypedRatingEcho({ id, item, questionId, ratedQuality: nextQuality });
    window.clearTimeout(typedEchoTimeoutRef.current);
    typedEchoTimeoutRef.current = window.setTimeout(() => {
      setTypedRatingEcho(current => (current?.id === id ? null : current));
    }, qualityPickHoldMs(nextQuality));
  }

  function setQuality(id, quality) {
    if (quality === MAP_RECAP_UNANSWERED) {
      setQualityByQuestionId(prev => ({ ...prev, [id]: MAP_RECAP_UNANSWERED }));
      return;
    }

    setQualityByQuestionId(prev => ({
      ...prev,
      [id]: quality
    }));
  }

  function setFoundZoneQualities(quality) {
    setQualityByQuestionId(prev => {
      if (foundQuestionIdSet.size === 0) return prev;

      const next = { ...prev };
      foundQuestionIdSet.forEach(id => {
        next[id] = quality;
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

  const completedCount = isPromptMode
    ? resolvedQuestionIds.length
    : foundQuestionIds.length;
  const canGiveUpPrompt = mode === MAP_MODE_TYPE_PROMPT;
  const canFinishReview = reviewZones.length > 0 && (
    allowPartialSubmit || canGiveUpPrompt || hasAttemptedAnswer || completedCount > 0
  ) && !clickRatingFeedback && !typedRatingFeedback;
  const progressPercent = reviewZones.length
    ? (completedCount / reviewZones.length) * 100
    : 0;
  const isIncorrectFlash = incorrectFlashId > 0;
  const isCorrectFlash = correctFlashId > 0;
  const isDuplicateFlash = duplicateFlashId > 0;
  const feedbackTone = isDuplicateFlash
    ? "duplicate"
    : isIncorrectFlash
      ? "incorrect"
      : isCorrectFlash
        ? "correct"
        : null;
  const recapSubmittedQualities = Object.values(qualityByQuestionId)
    .filter(q => q !== MAP_RECAP_UNANSWERED);
  const recapSuccessCount = recapSubmittedQualities
    .filter(q => Number(q) > 0).length;
  const recapMissCount = recapSubmittedQualities
    .filter(q => Number(q) === 0).length;
  const recapUnansweredCount = Object.values(qualityByQuestionId)
    .filter(q => q === MAP_RECAP_UNANSWERED).length;
  const recapPlayedCount = recapSuccessCount + recapMissCount;
  const recapSuccessRate = recapPlayedCount
    ? Math.round((recapSuccessCount / recapPlayedCount) * 100)
    : 0;
  const recapRows = useMemo(() => {
    // Recap always keeps found zones above missed zones. Header sorting only
    // changes the order inside each section.
    return reviewZones
      .map(item => {
        const historyStats = getHistoryStats(item);
        const isFound = foundQuestionIdSet.has(item.question_id);
        const canBeUnanswered = (
          allowPartialSubmit &&
          !isFound &&
          !resolvedQuestionIdSet.has(item.question_id)
        );
        const selectedQuality = getSelectedQuality(item, isFound, qualityByQuestionId);

        return {
          item,
          historyStats,
          isFound,
          canBeUnanswered,
          isUnanswered: selectedQuality === MAP_RECAP_UNANSWERED,
          difficultyScore: getDifficultyScore(item, historyStats)
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
      });
  }, [
    allowPartialSubmit,
    foundQuestionIdSet,
    qualityByQuestionId,
    recapSort,
    resolvedQuestionIdSet,
    reviewZones
  ]);
  const hasCorrectRecapRows = recapRows.some(row => row.isFound);
  const hasWrongRecapRows = recapRows.some(row => !row.isFound);
  const activeChoiceFeedback = mode === MAP_MODE_MULTIPLE_CHOICE
    ? choiceFeedback
    : null;
  const visibleChoiceOptions = activeChoiceFeedback
    ? activeChoiceFeedback.options
    : choiceOptions;
  const visibleDueCodes = activeChoiceFeedback?.correctCode
    ? [activeChoiceFeedback.correctCode]
    : typedRatingFeedback?.item?.code && mode === MAP_MODE_TYPE_PROMPT
      ? [typedRatingFeedback.item.code]
    : dueCodes;
  const targetHighlightCode = (
    mode === MAP_MODE_CLICK_PROMPT
      ? clickRatingFeedback?.item?.code || null
      : (
        mode === MAP_MODE_TYPE_PROMPT ||
        mode === MAP_MODE_MULTIPLE_CHOICE
      )
        ? activeChoiceFeedback?.correctCode ||
          typedRatingFeedback?.item?.code ||
          currentPromptItem?.code ||
          null
        : null
  );
  const promptDisplayItem = clickRatingFeedback?.item || currentPromptItem;
  const selectedCode = activeChoiceFeedback ? null : targetHighlightCode;

  return {
    activeMissedCodes,
    canFinishReview,
    choiceFeedback: activeChoiceFeedback,
    choiceOptions: visibleChoiceOptions,
    clickRatingFeedback,
    clickRatingEcho,
    currentPromptItem,
    dueCodes: visibleDueCodes,
    feedbackTone,
    focusedCode,
    focusNextRemainingZone,
    focusVersion,
    foundQuestionIds,
    foundCodes,
    foundQuestionIdSet,
    flashCodes: zoneFeedback?.flashCodes || [],
    finishMap,
    handleChoiceSelect,
    handleSubmit,
    handleZoneSelect,
    input,
    mode,
    qualityByQuestionId,
    missedCodes,
    progressPercent,
    promptCode: promptDisplayItem?.code || null,
    promptLabel: promptDisplayItem?.label || "",
    rateChoice,
    rateClickAnswer,
    rateTypedAnswer,
    recapMissCount,
    recapRows,
    recapSort,
    recapSuccessCount,
    recapSuccessRate,
    recapUnansweredCount,
    submitError,
    submitting,
    manualFocusCode: remainingFocusCode,
    remainingFocusCode: targetHighlightCode || remainingFocusCode,
    remainingZones,
    selectedCode,
    selectNextPrompt,
    sendResult,
    setFocusedCode,
    setFoundZoneQualities,
    setInput,
    setQuality,
    showRecap,
    showRecapSections: hasCorrectRecapRows && hasWrongRecapRows,
    skipCurrentPrompt,
    typedRatingFeedback,
    typedRatingEcho,
    toggleRecapSort
  };
}

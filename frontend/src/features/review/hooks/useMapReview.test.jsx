import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMapReview } from "./useMapReview";
import { sendMapAnswer } from "../../../api/review";

vi.mock("../../../api/review", () => ({
  sendMapAnswer: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function labels(rows) {
  return rows.map(row => row.item.label);
}

function optionIds(items) {
  return items
    .map(item => item.question_id)
    .sort((a, b) => a - b);
}

function zone({
  questionId,
  code,
  label,
  difficulty = 5,
  interval = 0,
  projectedIntervals = {}
}) {
  return {
    question_id: questionId,
    code,
    label,
    progress: {
      difficulty,
      interval
    },
    projected_intervals: projectedIntervals
  };
}

describe("useMapReview recap sorting", () => {
  it("toggles answer sorting inside found and missed sections", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "b", label: "Beta", difficulty: 9 }),
      zone({ questionId: 2, code: "a", label: "Alpha", difficulty: 3 }),
      zone({ questionId: 3, code: "g", label: "Gamma", difficulty: 8 }),
      zone({ questionId: 4, code: "d", label: "Delta", difficulty: 2 })
    ];
    const { result } = renderHook(() => useMapReview(reviewZones, vi.fn()));

    act(() => {
      result.current.setInput("Beta");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("Alpha");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
      "Delta"
    ]);

    act(() => {
      result.current.toggleRecapSort("answer");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma"
    ]);
    expect(result.current.recapRows.map(row => row.isFound)).toEqual([
      true,
      true,
      false,
      false
    ]);

    act(() => {
      result.current.toggleRecapSort("answer");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
      "Delta"
    ]);
  });

  it("uses current row quality for quality and interval sorting", () => {
    const reviewZones = [
      zone({
        questionId: 1,
        code: "a",
        label: "Alpha",
        difficulty: 8,
        projectedIntervals: { 1: 5, 2: 20, 3: 80 }
      }),
      zone({
        questionId: 2,
        code: "b",
        label: "Beta",
        difficulty: 6,
        projectedIntervals: { 1: 10, 2: 40, 3: 60 }
      }),
      zone({ questionId: 3, code: "g", label: "Gamma", difficulty: 4 })
    ];
    const { result } = renderHook(() => useMapReview(reviewZones, vi.fn()));

    act(() => {
      result.current.setInput("Alpha");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("Beta");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.finishMap();
    });
    act(() => {
      result.current.toggleRecapSort("interval");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Alpha",
      "Beta",
      "Gamma"
    ]);

    act(() => {
      result.current.setQuality(1, 3);
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Beta",
      "Alpha",
      "Gamma"
    ]);

    act(() => {
      result.current.toggleRecapSort("quality");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Beta",
      "Alpha",
      "Gamma"
    ]);

    act(() => {
      result.current.setQuality(1, 1);
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Alpha",
      "Beta",
      "Gamma"
    ]);
  });

  it("uses an injected submit callback instead of the scheduled answer API", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, onComplete, submitAnswer)
    );

    act(() => {
      result.current.setInput("Alpha");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.finishMap();
    });

    await act(async () => {
      await result.current.sendResult();
    });

    // The typed string rides along as the given answer; the zone that was
    // never answered contributes no entry.
    expect(submitAnswer).toHaveBeenCalledWith({
      1: 2,
      2: 0
    }, "type_all", 2, { 1: "Alpha" }, { 1: [1, 2], 2: [1, 2] });
    expect(sendMapAnswer).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith([2]);
  });

  it("asks for inline quality after a correct typed map answer", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const reviewZones = [zone({ questionId: 1, code: "a", label: "Alpha" })];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, onComplete, submitAnswer, {
        inlineTypedRating: true,
        mode: "type_all"
      })
    );

    act(() => {
      result.current.setInput("Alpha");
    });
    act(() => {
      expect(result.current.handleSubmit()).toBe(true);
    });

    expect(result.current.typedRatingFeedback?.questionId).toBe(1);
    expect(result.current.showRecap).toBe(false);
    expect(result.current.canFinishReview).toBe(false);
    expect(result.current.qualityByQuestionId[1]).toBeUndefined();

    vi.useFakeTimers();
    act(() => {
      result.current.rateTypedAnswer(3);
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    vi.useRealTimers();

    expect(result.current.typedRatingFeedback).toBeNull();
    expect(result.current.showRecap).toBe(true);
    expect(result.current.qualityByQuestionId[1]).toBe(3);

    act(() => {
      result.current.setQuality(1, 1);
    });

    await act(async () => {
      await result.current.sendResult();
    });

    expect(submitAnswer).toHaveBeenCalledWith(
      { 1: 1 },
      "type_all",
      1,
      { 1: "Alpha" },
      { 1: [1] }
    );
    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it("asks for inline quality after lowercase department input is submitted", () => {
    const reviewZones = [
      zone({ questionId: 267, code: "39", label: "Jura" }),
      zone({ questionId: 234, code: "23", label: "Creuse" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn().mockResolvedValue({}), {
        inlineTypedRating: true,
        mode: "type_all"
      })
    );

    act(() => {
      result.current.setInput("jura");
    });

    expect(result.current.typedRatingFeedback).toBeNull();

    act(() => {
      expect(result.current.handleSubmit()).toBe(true);
    });

    expect(result.current.input).toBe("");
    expect(result.current.typedRatingFeedback?.questionId).toBe(267);
    expect(result.current.foundQuestionIds).toEqual([267]);
    expect(result.current.qualityByQuestionId[267]).toBeUndefined();
    expect(result.current.showRecap).toBe(false);
  });

  it("asks for inline quality after a correct clicked map answer", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const reviewZones = [zone({ questionId: 1, code: "a", label: "Alpha" })];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, onComplete, submitAnswer, {
        inlineClickRating: true,
        mode: "click_prompt"
      })
    );

    act(() => {
      result.current.handleZoneSelect("a");
    });

    expect(result.current.clickRatingFeedback?.questionId).toBe(1);
    expect(result.current.promptLabel).toBe("Alpha");
    expect(result.current.dueCodes).toEqual([]);
    expect(result.current.selectedCode).toBe("a");
    expect(result.current.showRecap).toBe(false);
    expect(result.current.canFinishReview).toBe(false);
    expect(result.current.qualityByQuestionId[1]).toBeUndefined();

    vi.useFakeTimers();
    act(() => {
      result.current.rateClickAnswer(3);
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    vi.useRealTimers();

    expect(result.current.clickRatingFeedback).toBeNull();
    expect(result.current.showRecap).toBe(true);
    expect(result.current.qualityByQuestionId[1]).toBe(3);

    act(() => {
      result.current.setQuality(1, 1);
    });

    await act(async () => {
      await result.current.sendResult();
    });

    expect(submitAnswer).toHaveBeenCalledWith(
      { 1: 1 },
      "click_prompt",
      1,
      { 1: 1 },
      { 1: [1] }
    );
    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it("refuses to finish before any zone has been attempted", () => {
    const onAnsweringComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), { onAnsweringComplete })
    );

    expect(result.current.canFinishReview).toBe(false);

    act(() => {
      expect(result.current.finishMap()).toBe(false);
    });

    expect(result.current.showRecap).toBe(false);
    expect(result.current.qualityByQuestionId).toEqual({});
    expect(onAnsweringComplete).not.toHaveBeenCalled();
  });

  it("allows finishing after a wrong typed attempt even when no zone was found", () => {
    const onAnsweringComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), { onAnsweringComplete })
    );

    act(() => {
      result.current.setInput("wrong");
    });
    let submitResult;
    act(() => {
      submitResult = result.current.handleSubmit();
    });

    expect(submitResult).toBe(false);
    expect(result.current.input).toBe("wrong");
    expect(result.current.canFinishReview).toBe(true);

    act(() => {
      expect(result.current.finishMap()).toBe(true);
    });

    expect(result.current.showRecap).toBe(true);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.qualityByQuestionId).toEqual({ 1: 0, 2: 0 });
    expect(onAnsweringComplete).toHaveBeenCalledWith([1, 2]);
  });

  it("reports duplicate typed type_all answers without marking them wrong", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn())
    );

    let firstSubmit;
    act(() => {
      result.current.setInput("Alpha");
    });
    act(() => {
      firstSubmit = result.current.handleSubmit();
    });

    expect(firstSubmit).toBe(true);
    expect(result.current.foundQuestionIds).toEqual([1]);

    let duplicateSubmit;
    act(() => {
      result.current.setInput("Alpha");
    });
    act(() => {
      duplicateSubmit = result.current.handleSubmit();
    });

    expect(duplicateSubmit).toBe("duplicate");
    expect(result.current.feedbackTone).toBe("duplicate");
    expect(result.current.foundQuestionIds).toEqual([1]);
    expect(result.current.input).toBe("Alpha");
  });

  it("allows finishing type_prompt after a wrong typed attempt with no found zones", () => {
    const onAnsweringComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "type_prompt",
        onAnsweringComplete
      })
    );

    act(() => {
      result.current.setInput("wrong");
    });
    let submitResult;
    act(() => {
      submitResult = result.current.handleSubmit();
    });

    expect(submitResult).toBe(false);
    expect(result.current.input).toBe("wrong");
    expect(result.current.canFinishReview).toBe(true);

    act(() => {
      expect(result.current.finishMap()).toBe(true);
    });

    expect(result.current.showRecap).toBe(true);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.qualityByQuestionId).toEqual({ 1: 0, 2: 0 });
    expect(onAnsweringComplete).toHaveBeenCalledWith([1, 2]);
  });

  it("allows giving up on type_prompt without typing an answer", () => {
    const onAnsweringComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "type_prompt",
        onAnsweringComplete
      })
    );

    expect(result.current.canFinishReview).toBe(true);

    act(() => {
      expect(result.current.finishMap()).toBe(true);
    });

    expect(result.current.showRecap).toBe(true);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.qualityByQuestionId).toEqual({ 1: 0, 2: 0 });
    expect(onAnsweringComplete).toHaveBeenCalledWith([1, 2]);
  });

  it("allows partial finish when that mode explicitly permits non-answers", () => {
    const onAnsweringComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        allowPartialSubmit: true,
        onAnsweringComplete
      })
    );

    expect(result.current.canFinishReview).toBe(true);

    act(() => {
      expect(result.current.finishMap()).toBe(true);
    });

    expect(result.current.showRecap).toBe(true);
    expect(Object.values(result.current.qualityByQuestionId)).toEqual([
      "unanswered",
      "unanswered"
    ]);
    expect(onAnsweringComplete).toHaveBeenCalledWith([]);
  });

  it("continues tab focus after a correctly answered focused zone", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" }),
      zone({ questionId: 3, code: "c", label: "Gamma" }),
      zone({ questionId: 4, code: "d", label: "Delta" })
    ];
    const { result } = renderHook(() => useMapReview(reviewZones, vi.fn()));

    act(() => {
      result.current.focusNextRemainingZone();
    });
    act(() => {
      result.current.focusNextRemainingZone();
    });

    expect(result.current.remainingFocusCode).toBe("b");
    expect(result.current.manualFocusCode).toBe("b");

    act(() => {
      result.current.setInput("Beta");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.focusNextRemainingZone();
    });

    expect(result.current.foundQuestionIds).toEqual([2]);
    expect(result.current.remainingFocusCode).toBe("c");
    expect(result.current.manualFocusCode).toBe("c");
  });

  it("keeps clicks from answering type_all mode", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" })
    ];
    const { result } = renderHook(() => useMapReview(reviewZones, vi.fn()));

    act(() => {
      result.current.handleZoneSelect("a");
    });

    expect(result.current.foundQuestionIds).toEqual([]);
  });

  it("click_prompt resolves the asked zone by clicking the map", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt"
      })
    );
    const targetCode = result.current.promptCode;

    act(() => {
      result.current.handleZoneSelect(targetCode);
    });

    expect(result.current.foundQuestionIds).toHaveLength(1);
  });

  it("click_prompt wrong clicks flash the clicked zone and miss the target", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

    try {
      const reviewZones = [
        zone({ questionId: 1, code: "a", label: "Alpha" }),
        zone({ questionId: 2, code: "b", label: "Beta" })
      ];
      const { result } = renderHook(() =>
        useMapReview(reviewZones, vi.fn(), vi.fn(), {
          mode: "click_prompt"
        })
      );

      expect(result.current.promptCode).toBe("a");

      act(() => {
        result.current.handleZoneSelect("b");
      });

      expect(result.current.flashCodes).toEqual(["b"]);
      expect(result.current.activeMissedCodes).toEqual(["a"]);
      expect(result.current.foundQuestionIds).toEqual([]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("click_prompt ignores clicks on already found zones", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt"
      })
    );
    const foundTarget = result.current.currentPromptItem;

    act(() => {
      result.current.handleZoneSelect(foundTarget.code);
    });

    const nextTarget = result.current.currentPromptItem;

    act(() => {
      result.current.handleZoneSelect(foundTarget.code);
    });

    expect(result.current.foundQuestionIds).toEqual([foundTarget.question_id]);
    expect(result.current.currentPromptItem.question_id).toBe(nextTarget.question_id);
    expect(result.current.showRecap).toBe(false);
  });

  it("click_prompt ignores clicks on already missed zones", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt"
      })
    );
    const missedTarget = result.current.currentPromptItem;
    const otherZone = reviewZones.find(zone => zone.code !== missedTarget.code);

    // Clicking a wrong zone marks the current target as missed and advances.
    act(() => {
      result.current.handleZoneSelect(otherZone.code);
    });

    expect(result.current.activeMissedCodes).toEqual([missedTarget.code]);
    const nextTarget = result.current.currentPromptItem;

    // Clicking the now-missed zone is ignored.
    act(() => {
      result.current.handleZoneSelect(missedTarget.code);
    });

    expect(result.current.activeMissedCodes).toEqual([missedTarget.code]);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.currentPromptItem.question_id).toBe(nextTarget.question_id);
    expect(result.current.showRecap).toBe(false);
  });

  it("click_prompt ignores clicks outside active review zones", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt"
      })
    );
    const initialPrompt = result.current.currentPromptItem;

    act(() => {
      result.current.handleZoneSelect("grey");
    });

    expect(result.current.activeMissedCodes).toEqual([]);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.currentPromptItem.question_id).toBe(
      initialPrompt.question_id
    );
    expect(result.current.showRecap).toBe(false);
  });

  it("click_prompt keeps the whole context clickable when only a subset is prompted", () => {
    // Failed-retry pass: only 2 of the original 5 zones are re-prompted, but the
    // full context stays clickable/highlighted so the pick never degenerates to
    // a couple of zones.
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const contextItems = [
      ...reviewZones,
      zone({ questionId: 3, code: "c", label: "Gamma" }),
      zone({ questionId: 4, code: "d", label: "Delta" }),
      zone({ questionId: 5, code: "e", label: "Epsilon" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt",
        contextItems
      })
    );

    // The whole context is clickable, not just the 2 prompted zones.
    expect([...result.current.dueCodes].sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e"
    ]);

    const prompt = result.current.currentPromptItem;

    // Clicking a context-only distractor (never prompted) misses the prompt.
    act(() => {
      result.current.handleZoneSelect("d");
    });

    expect(result.current.flashCodes).toEqual(["d"]);
    expect(result.current.activeMissedCodes).toEqual([prompt.code]);
    expect(result.current.foundQuestionIds).toEqual([]);
  });

  it("type_prompt accepts the highlighted zone name and skipping does not complete the session", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "type_prompt"
      })
    );
    const firstLabel = result.current.promptLabel;
    const answeredId = result.current.currentPromptItem.question_id;

    act(() => {
      result.current.setInput(firstLabel);
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.skipCurrentPrompt();
    });

    // Skipping the remaining zone no longer marks it missed, so the session is
    // not complete and only the answered zone counts as found.
    expect(result.current.showRecap).toBe(false);
    expect(result.current.foundQuestionIds).toEqual([answeredId]);
    expect(result.current.activeMissedCodes).toEqual([]);
  });

  it("type_prompt skip advances to the next zone without marking it missed", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "type_prompt"
      })
    );
    const skippedItem = result.current.currentPromptItem;

    act(() => {
      result.current.skipCurrentPrompt();
    });

    expect(result.current.activeMissedCodes).toEqual([]);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.currentPromptItem.question_id).not.toBe(
      skippedItem.question_id
    );
  });

  it("multiple_choice resolves a target from answer buttons", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "multiple_choice",
        contextItems: reviewZones
      })
    );
    const target = result.current.currentPromptItem;

    act(() => {
      result.current.handleChoiceSelect(target.question_id);
    });

    expect(result.current.foundQuestionIds).toEqual([target.question_id]);
  });

  it("inline rating keeps the reveal sticky and carries the grade into the recap", async () => {
    vi.useFakeTimers();
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const reviewZones = [zone({ questionId: 1, code: "a", label: "Alpha" })];
    const contextItems = [
      ...reviewZones,
      zone({ questionId: 2, code: "b", label: "Beta" }),
      zone({ questionId: 3, code: "c", label: "Gamma" }),
      zone({ questionId: 4, code: "d", label: "Delta" })
    ];

    try {
      const { result } = renderHook(() =>
        useMapReview(reviewZones, onComplete, submitAnswer, {
          mode: "multiple_choice",
          contextItems,
          inlineChoiceRating: true
        })
      );
      const target = result.current.currentPromptItem;

      act(() => {
        result.current.handleChoiceSelect(target.question_id);
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.choiceFeedback).toBeTruthy();
      expect(result.current.showRecap).toBe(false);

      act(() => {
        result.current.rateChoice(3);
      });
      act(() => {
        vi.advanceTimersByTime(420);
      });

      // The recap opens pre-filled with the inline grade — it must not be reset
      // to the default 2 by the recap's own quality rebuild.
      expect(result.current.showRecap).toBe(true);
      expect(result.current.qualityByQuestionId[target.question_id]).toBe(3);
      expect(submitAnswer).not.toHaveBeenCalled();

      // The grade can still be corrected on the recap before submitting.
      act(() => {
        result.current.setQuality(target.question_id, 1);
      });

      await act(async () => {
        await result.current.sendResult();
      });

      expect(submitAnswer).toHaveBeenCalledWith(
        { [target.question_id]: 1 },
        "multiple_choice",
        contextItems.length,
        { [target.question_id]: target.question_id },
        expect.any(Object)
      );
      expect(onComplete).toHaveBeenCalledWith([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("inline rating carries a wrong pick into the recap as quality 0", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const reviewZones = [zone({ questionId: 1, code: "a", label: "Alpha" })];
    const contextItems = [
      ...reviewZones,
      zone({ questionId: 2, code: "b", label: "Beta" }),
      zone({ questionId: 3, code: "c", label: "Gamma" }),
      zone({ questionId: 4, code: "d", label: "Delta" })
    ];

    const { result } = renderHook(() =>
      useMapReview(reviewZones, onComplete, submitAnswer, {
        mode: "multiple_choice",
        contextItems,
        inlineChoiceRating: true
      })
    );
    const target = result.current.currentPromptItem;
    const wrong = result.current.choiceOptions.find(
      option => option.question_id !== target.question_id
    );

    act(() => {
      result.current.handleChoiceSelect(wrong.question_id);
    });
    expect(result.current.choiceFeedback?.isCorrect).toBe(false);

    vi.useFakeTimers();
    act(() => {
      result.current.rateChoice();
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    vi.useRealTimers();

    expect(result.current.showRecap).toBe(true);
    expect(result.current.qualityByQuestionId[target.question_id]).toBe(0);

    await act(async () => {
      await result.current.sendResult();
    });

    // The wrong pick is the confusion signal worth recording, so the selected
    // zone id is sent rather than the correct one.
    expect(submitAnswer).toHaveBeenCalledWith(
      { [target.question_id]: 0 },
      "multiple_choice",
      contextItems.length,
      { [target.question_id]: wrong.question_id },
      expect.any(Object)
    );
    expect(onComplete).toHaveBeenCalledWith([target.question_id]);
  });

  it("multiple_choice uses borrowed context and submits only active zones", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha", difficulty: 1 })
    ];
    const contextItems = [
      ...reviewZones,
      zone({ questionId: 2, code: "b", label: "Beta", difficulty: 10 }),
      zone({ questionId: 3, code: "c", label: "Gamma", difficulty: 4 }),
      zone({ questionId: 4, code: "d", label: "Delta", difficulty: 8 }),
      zone({ questionId: 5, code: "e", label: "Epsilon", difficulty: 9 })
    ];
    try {
      const { result } = renderHook(() =>
        useMapReview(reviewZones, onComplete, submitAnswer, {
          mode: "multiple_choice",
          contextItems
        })
      );
      const target = result.current.currentPromptItem;

      expect(result.current.choiceOptions).toHaveLength(4);
      expect(
        result.current.choiceOptions
          .map(item => item.question_id)
          .sort((a, b) => a - b)
      ).toEqual([1, 2, 4, 5]);

      act(() => {
        result.current.handleChoiceSelect(target.question_id);
      });
      act(() => {
        result.current.finishMap();
      });

      await act(async () => {
        await result.current.sendResult();
      });

      expect(submitAnswer).toHaveBeenCalledWith({
        [target.question_id]: 2
      }, "multiple_choice", 5, { [target.question_id]: target.question_id }, expect.any(Object));
      expect(onComplete).toHaveBeenCalledWith([]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("multiple_choice can sample easier distractors from a larger pool", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha", difficulty: 1 })
    ];
    const contextItems = [
      ...reviewZones,
      zone({ questionId: 2, code: "b", label: "Beta", difficulty: 10 }),
      zone({ questionId: 3, code: "c", label: "Gamma", difficulty: 4 }),
      zone({ questionId: 4, code: "d", label: "Delta", difficulty: 8 }),
      zone({ questionId: 5, code: "e", label: "Epsilon", difficulty: 9 })
    ];

    try {
      const { result } = renderHook(() =>
        useMapReview(reviewZones, vi.fn(), vi.fn(), {
          mode: "multiple_choice",
          contextItems
        })
      );

      expect(
        result.current.choiceOptions
          .map(item => item.question_id)
          .sort((a, b) => a - b)
      ).toEqual([1, 3, 4, 5]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("multiple_choice cools used distractors and excludes answered targets", () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha", difficulty: 1 }),
      zone({ questionId: 6, code: "f", label: "Zeta", difficulty: 10 })
    ];
    const contextItems = [
      ...reviewZones,
      zone({ questionId: 2, code: "b", label: "Beta", difficulty: 10 }),
      zone({ questionId: 3, code: "c", label: "Gamma", difficulty: 9.5 }),
      zone({ questionId: 4, code: "d", label: "Delta", difficulty: 9 }),
      zone({ questionId: 5, code: "e", label: "Epsilon", difficulty: 9.9 }),
      zone({ questionId: 7, code: "g", label: "Eta", difficulty: 9.8 }),
      zone({ questionId: 8, code: "h", label: "Theta", difficulty: 9.7 })
    ];

    try {
      const { result } = renderHook(() =>
        useMapReview(reviewZones, vi.fn(), vi.fn(), {
          mode: "multiple_choice",
          contextItems
        })
      );
      const firstPrompt = result.current.currentPromptItem;

      expect(firstPrompt.question_id).toBe(6);
      // Zeta/Theta are deliberately close labels, so the M2.3 ranker promotes
      // Theta over a merely difficult distractor.
      expect(optionIds(result.current.choiceOptions)).toEqual([2, 6, 7, 8]);

      act(() => {
        result.current.handleChoiceSelect(firstPrompt.question_id);
      });
      act(() => {
        vi.advanceTimersByTime(1300);
      });

      const nextIds = optionIds(result.current.choiceOptions);

      expect(result.current.currentPromptItem.question_id).toBe(1);
      expect(nextIds).toEqual([1, 3, 4, 5]);
      expect(new Set(nextIds).size).toBe(nextIds.length);
      // Previously answered target is excluded from distractors.
      expect(nextIds).not.toContain(firstPrompt.question_id);
      // Previously used distractor stays cooled down.
      expect(nextIds).not.toContain(2);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("multiple_choice wrong answers keep target visible as missed feedback", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "multiple_choice",
        contextItems: reviewZones
      })
    );
    const target = result.current.currentPromptItem;
    const wrong = reviewZones.find(item => item.question_id !== target.question_id);

    act(() => {
      result.current.handleChoiceSelect(wrong.question_id);
    });

    expect(result.current.choiceFeedback).toMatchObject({
      correctCode: target.code,
      correctQuestionId: target.question_id,
      isCorrect: false,
      selectedQuestionId: wrong.question_id
    });
    expect(result.current.activeMissedCodes).toEqual([target.code]);
    expect(result.current.dueCodes).toEqual([target.code]);
  });
});

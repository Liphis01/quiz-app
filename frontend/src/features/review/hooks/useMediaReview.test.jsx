import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultImageSuccessQuality,
  matchesImageAnswer,
  normalizeImageAnswer,
  useMediaReview
} from "./useMediaReview";
import { sendMediaAnswer } from "../../../api/review";
import {
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT
} from "../imageModes";
import { ANSWER_POLICY_EXACT } from "../answerPolicy";

vi.mock("../../../api/review", () => ({
  sendMediaAnswer: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function optionIds(items) {
  return items
    .map(item => item.question_id)
    .sort((a, b) => a - b);
}

function imageItem(questionId, answer, aliases = [], difficulty = 5) {
  return {
    question_id: questionId,
    answer,
    label: answer,
    aliases,
    media: `/static/${answer}.png`,
    progress: {
      difficulty
    }
  };
}

function answerActive(result) {
  const active = result.current.activeItem;

  act(() => {
    result.current.setInput(active.answer);
  });
  act(() => {
    result.current.handleSubmit();
  });

  return active;
}

describe("image review helpers", () => {
  it("normalizes case, accents, spaces, and hyphens", () => {
    expect(normalizeImageAnswer(" Côte-d Ivoire ")).toBe("cote d ivoire");
    expect(matchesImageAnswer(
      imageItem(1, "Côte d'Ivoire", ["Ivory-Coast"]),
      "ivory coast"
    )).toBe(true);
  });

  it("honors exact image answer policy", () => {
    expect(matchesImageAnswer({
      ...imageItem(1, "État"),
      answer_policy: ANSWER_POLICY_EXACT
    }, "etat")).toBe(false);
  });

  it("always defaults successful answers to quality 2", () => {
    expect(defaultImageSuccessQuality()).toBe(2);
    expect(defaultImageSuccessQuality(99)).toBe(2);
  });
});

describe("useMediaReview", () => {
  it("keeps one stable shuffled grid order during the review screen", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );
    const initialOrder = result.current.gridItems.map(row => row.item.question_id);

    act(() => {
      result.current.setInput("wrong");
    });

    expect(result.current.gridItems.map(row => row.item.question_id)).toEqual(
      initialOrder
    );
  });

  it("type_all marks typed answers as quality 2 without selecting an image", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );

    expect(result.current.activeItem).toBeNull();
    expect(result.current.activeQuestionId).toBeNull();
    expect(result.current.gridItems.every(row => !row.isActive)).toBe(true);

    act(() => {
      result.current.setInput("wrong");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("Germany");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.foundQuestionIds).toContain(2);
    expect(result.current.qualityByQuestionId[2]).toBe(2);
    expect(result.current.activeItem).toBeNull();
    expect(result.current.activeQuestionId).toBeNull();
    expect(result.current.gridItems.every(row => !row.isActive)).toBe(true);
    expect(result.current.resultMode).toBe(false);
  });

  it("treats a single type_all image as type_prompt with inline quality", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [imageItem(1, "France")];
    const { result } = renderHook(() =>
      useMediaReview(items, onComplete, submitAnswer, {
        inlineTypedRating: true,
        mode: IMAGE_MODE_TYPE_ALL
      })
    );

    expect(result.current.mode).toBe(IMAGE_MODE_TYPE_PROMPT);

    act(() => {
      result.current.setInput("France");
    });
    act(() => {
      expect(result.current.handleSubmit()).toBe(true);
    });

    expect(result.current.typedRatingFeedback?.questionId).toBe(1);
    expect(result.current.resultMode).toBe(false);
    expect(result.current.canFinishReview).toBe(false);

    vi.useFakeTimers();
    act(() => {
      result.current.rateTypedAnswer(3);
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    vi.useRealTimers();

    expect(result.current.typedRatingFeedback).toBeNull();
    expect(result.current.resultMode).toBe(true);
    expect(result.current.qualityByQuestionId[1]).toBe(3);

    act(() => {
      result.current.setQuality(1, 1);
    });

    await act(async () => {
      await result.current.sendResult();
    });

    expect(submitAnswer).toHaveBeenCalledWith(
      { 1: 1 },
      IMAGE_MODE_TYPE_PROMPT,
      1,
      { 1: "France" },
      { 1: [1] }
    );
    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it("falls back single-image type_all relearning retries to type_prompt", () => {
    const items = [{
      ...imageItem(1, "France"),
      progress: { relearning: true }
    }];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        group: { name: "Flags", items },
        inlineTypedRating: true,
        mode: IMAGE_MODE_TYPE_ALL
      })
    );

    expect(result.current.mode).toBe(IMAGE_MODE_TYPE_PROMPT);
    expect(result.current.activeItem?.question_id).toBe(1);
  });

  it("type_all ignores image selection and keeps the shared input", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );
    const target = result.current.gridItems[0];

    act(() => {
      result.current.setInput("draft");
    });
    act(() => {
      result.current.selectItem(target.item.question_id);
    });

    act(() => {
      result.current.selectNextItem();
    });

    expect(result.current.activeItem).toBeNull();
    expect(result.current.activeQuestionId).toBeNull();
    expect(result.current.input).toBe("draft");
    expect(result.current.gridItems.every(row => !row.isActive)).toBe(true);
  });

  it("finishes on the same grid with recap qualities editable", async () => {
    sendMediaAnswer.mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() => useMediaReview(items, onComplete));
    const found = answerActive(result);

    act(() => {
      result.current.finishReview();
    });

    const missedIds = items
      .map(item => item.question_id)
      .filter(id => id !== found.question_id);

    expect(result.current.resultMode).toBe(true);
    expect(result.current.lockedMissedQuestionIds.sort()).toEqual(
      [...missedIds].sort()
    );
    expect(result.current.qualityByQuestionId[found.question_id]).toBe(2);
    missedIds.forEach(id => {
      expect(result.current.qualityByQuestionId[id]).toBe(0);
    });

    act(() => {
      result.current.setQuality(found.question_id, 0);
    });
    expect(result.current.qualityByQuestionId[found.question_id]).toBe(0);

    act(() => {
      result.current.setQuality(found.question_id, 3);
    });
    expect(result.current.qualityByQuestionId[found.question_id]).toBe(3);

    act(() => {
      result.current.setQuality(missedIds[0], 2);
    });
    expect(result.current.qualityByQuestionId[missedIds[0]]).toBe(2);

    await act(async () => {
      await result.current.sendResult();
    });

    expect(sendMediaAnswer).toHaveBeenCalledWith(
      {
        [found.question_id]: 3,
        [missedIds[0]]: 2,
        [missedIds[1]]: 0
      },
      IMAGE_MODE_TYPE_PROMPT,
      3,
      { [found.question_id]: found.answer },
      {
        [found.question_id]: [1, 2, 3],
        [missedIds[0]]: [1, 2, 3],
        [missedIds[1]]: [1, 2, 3]
      }
    );
    expect(onComplete).toHaveBeenCalledWith([missedIds[1]]);
  });

  it("refuses to finish before any image has been attempted", () => {
    const onAnsweringComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_ALL,
        onAnsweringComplete
      })
    );

    expect(result.current.canFinishReview).toBe(false);

    act(() => {
      expect(result.current.finishReview()).toBe(false);
    });

    expect(result.current.resultMode).toBe(false);
    expect(result.current.qualityByQuestionId).toEqual({});
    expect(onAnsweringComplete).not.toHaveBeenCalled();
  });

  it("allows finishing after a wrong typed attempt even when no image was found", () => {
    const onAnsweringComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_ALL,
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
      expect(result.current.finishReview()).toBe(true);
    });

    expect(result.current.resultMode).toBe(true);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.qualityByQuestionId).toEqual({ 1: 0, 2: 0 });
    expect(onAnsweringComplete.mock.calls[0][0].sort((a, b) => a - b))
      .toEqual([1, 2]);
  });

  it("reports duplicate typed type_all answers without marking them wrong", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_ALL
      })
    );

    let firstSubmit;
    act(() => {
      result.current.setInput("France");
    });
    act(() => {
      firstSubmit = result.current.handleSubmit();
    });

    expect(firstSubmit).toBe(true);
    expect(result.current.foundQuestionIds).toEqual([1]);

    let duplicateSubmit;
    act(() => {
      result.current.setInput("France");
    });
    act(() => {
      duplicateSubmit = result.current.handleSubmit();
    });

    expect(duplicateSubmit).toBe("duplicate");
    expect(result.current.feedbackTone).toBe("duplicate");
    expect(result.current.foundQuestionIds).toEqual([1]);
    expect(result.current.input).toBe("France");
  });

  it("allows finishing type_prompt after a wrong typed attempt with no found images", () => {
    const onAnsweringComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_PROMPT,
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
      expect(result.current.finishReview()).toBe(true);
    });

    expect(result.current.resultMode).toBe(true);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.qualityByQuestionId).toEqual({ 1: 0, 2: 0 });
    expect(onAnsweringComplete.mock.calls[0][0].sort((a, b) => a - b))
      .toEqual([1, 2]);
  });

  it("allows giving up on type_prompt without typing an answer", () => {
    const onAnsweringComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_PROMPT,
        onAnsweringComplete
      })
    );

    expect(result.current.canFinishReview).toBe(true);

    act(() => {
      expect(result.current.finishReview()).toBe(true);
    });

    expect(result.current.resultMode).toBe(true);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.qualityByQuestionId).toEqual({ 1: 0, 2: 0 });
    expect(onAnsweringComplete.mock.calls[0][0].sort((a, b) => a - b))
      .toEqual([1, 2]);
  });

  it("allows partial finish when that mode explicitly permits non-answers", () => {
    const onAnsweringComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        allowPartialSubmit: true,
        mode: IMAGE_MODE_TYPE_ALL,
        onAnsweringComplete
      })
    );

    expect(result.current.canFinishReview).toBe(true);

    act(() => {
      expect(result.current.finishReview()).toBe(true);
    });

    expect(result.current.resultMode).toBe(true);
    expect(Object.values(result.current.qualityByQuestionId)).toEqual([
      "unanswered",
      "unanswered"
    ]);
    expect(onAnsweringComplete).toHaveBeenCalledWith([]);
  });

  it("enters result mode automatically when all images are found", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() => useMediaReview(items, vi.fn()));

    answerActive(result);
    answerActive(result);

    expect(result.current.resultMode).toBe(true);
    expect(result.current.lockedMissedQuestionIds).toEqual([]);
    expect(Object.values(result.current.qualityByQuestionId)).toEqual([2, 2]);
  });

  it("uses an injected submit callback instead of the scheduled answer API", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, onComplete, submitAnswer)
    );
    const found = answerActive(result);
    const missed = items.find(item => item.question_id !== found.question_id);

    act(() => {
      result.current.finishReview();
    });

    await act(async () => {
      await result.current.sendResult();
    });

    expect(submitAnswer).toHaveBeenCalledWith(
      {
        [found.question_id]: 2,
        [missed.question_id]: 0
      },
      IMAGE_MODE_TYPE_PROMPT,
      2,
      { [found.question_id]: found.answer },
      {
        [found.question_id]: [1, 2],
        [missed.question_id]: [1, 2]
      }
    );
    expect(sendMediaAnswer).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith([missed.question_id]);
  });

  it("type_all accepts remaining image answers in any order", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );

    act(() => {
      result.current.setInput("Spain");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("France");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.foundQuestionIds).toEqual([3, 1]);
    expect(result.current.activeQuestionId).toBeNull();
  });

  it("type_prompt keeps the review item order for grid and prompts", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const items = [
        imageItem(1, "France"),
        imageItem(2, "Germany"),
        imageItem(3, "Spain"),
        imageItem(4, "Italy")
      ];
      const { result } = renderHook(() =>
        useMediaReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_TYPE_PROMPT
        })
      );

      expect(result.current.gridItems.map(row => row.item.question_id)).toEqual([
        1,
        2,
        3,
        4
      ]);
      expect(result.current.currentPromptItem.question_id).toBe(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("type_prompt manual selection changes the active image without grading", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_PROMPT
      })
    );

    act(() => {
      result.current.setInput("draft");
    });
    act(() => {
      result.current.selectItem(3);
    });

    expect(result.current.currentPromptItem.question_id).toBe(3);
    expect(result.current.input).toBe("");
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.resolvedQuestionIds).toEqual([]);
    expect(result.current.qualityByQuestionId).toEqual({});
  });

  it("type_prompt next selection wraps and skips resolved images", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_PROMPT
      })
    );

    act(() => {
      result.current.selectItem(2);
    });
    act(() => {
      result.current.setInput("Germany");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.resolvedQuestionIds).toEqual([2]);
    expect(result.current.currentPromptItem.question_id).toBe(3);

    act(() => {
      result.current.selectNextItem(-1);
    });

    expect(result.current.currentPromptItem.question_id).toBe(1);

    act(() => {
      result.current.selectNextItem(1);
    });

    expect(result.current.currentPromptItem.question_id).toBe(3);

    act(() => {
      result.current.selectNextItem(1);
    });

    expect(result.current.currentPromptItem.question_id).toBe(1);
  });

  it("type_prompt answers and passes advance from the current image position", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_PROMPT
      })
    );

    act(() => {
      result.current.selectItem(3);
    });
    act(() => {
      result.current.setInput("Spain");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.foundQuestionIds).toEqual([3]);
    expect(result.current.resolvedQuestionIds).toEqual([3]);
    expect(result.current.resolvedQuestionIdsRecentFirst).toEqual([3]);
    expect(result.current.currentPromptItem.question_id).toBe(4);

    act(() => {
      result.current.skipCurrentPrompt();
    });

    expect(result.current.foundQuestionIds).toEqual([3]);
    expect(result.current.resolvedQuestionIds).toEqual([3]);
    expect(result.current.resolvedQuestionIdsRecentFirst).toEqual([3]);
    expect(result.current.currentPromptItem.question_id).toBe(1);
  });

  it("type_prompt pass selects the next image without revealing or grading", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_PROMPT })
    );
    const skipped = result.current.currentPromptItem;

    act(() => {
      result.current.skipCurrentPrompt();
    });

    expect(result.current.resolvedQuestionIds).not.toContain(skipped.question_id);
    expect(result.current.foundQuestionIds).not.toContain(skipped.question_id);
    expect(result.current.revealedQuestionIds).not.toContain(skipped.question_id);
    expect(result.current.gridItems.find(row =>
      row.item.question_id === skipped.question_id
    )).toMatchObject({
      isMissed: false,
      isRevealed: false
    });
    expect(result.current.currentPromptItem.question_id).not.toBe(
      skipped.question_id
    );
  });

  it("multiple_choice_label chooses from labels for the target image", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        contextItems: items
      })
    );
    const prompt = result.current.currentPromptItem;

    expect(result.current.choiceOptions).toHaveLength(4);
    expect(result.current.choiceOptions.map(item => item.question_id)).toContain(
      prompt.question_id
    );

    act(() => {
      result.current.handleChoiceSelect(prompt.question_id);
    });

    expect(result.current.foundQuestionIds).toContain(prompt.question_id);
  });

  it("multiple_choice_label uses borrowed context and submits only active items", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [
      imageItem(1, "France", [], 1)
    ];
    const contextItems = [
      ...items,
      imageItem(2, "Germany", [], 10),
      imageItem(3, "Spain", [], 4),
      imageItem(4, "Italy", [], 8),
      imageItem(5, "Portugal", [], 9)
    ];
    try {
      const { result } = renderHook(() =>
        useMediaReview(items, onComplete, submitAnswer, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
          contextItems
        })
      );
      const prompt = result.current.currentPromptItem;

      expect(result.current.choiceOptions).toHaveLength(4);
      expect(
        result.current.choiceOptions
          .map(item => item.question_id)
          .sort((a, b) => a - b)
      ).toEqual([1, 2, 4, 5]);

      act(() => {
        result.current.handleChoiceSelect(prompt.question_id);
      });
      act(() => {
        result.current.finishReview();
      });

      await act(async () => {
        await result.current.sendResult();
      });

      expect(submitAnswer).toHaveBeenCalledWith(
        {
          [prompt.question_id]: 2
        },
        IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        5,
        { [prompt.question_id]: prompt.question_id },
        expect.any(Object)
      );
      expect(onComplete).toHaveBeenCalledWith([]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("inline rating keeps the reveal sticky and carries the grade into the recap", async () => {
    vi.useFakeTimers();
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [imageItem(1, "France", [], 1)];
    const contextItems = [
      ...items,
      imageItem(2, "Germany", [], 10),
      imageItem(3, "Spain", [], 4),
      imageItem(4, "Italy", [], 8)
    ];

    try {
      const { result } = renderHook(() =>
        useMediaReview(items, onComplete, submitAnswer, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
          contextItems,
          inlineChoiceRating: true
        })
      );
      const prompt = result.current.currentPromptItem;

      act(() => {
        result.current.handleChoiceSelect(prompt.question_id);
      });

      // Reveal stays put (no 1300ms auto-clear) until the pick is graded.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.interactionFeedback).toBeTruthy();
      expect(result.current.resultMode).toBe(false);

      act(() => {
        result.current.rateChoice(3);
      });
      act(() => {
        vi.advanceTimersByTime(420);
      });

      // The group ends on the recap, pre-filled with the inline grade, and
      // nothing is submitted until the recap is validated.
      expect(result.current.resultMode).toBe(true);
      expect(result.current.qualityByQuestionId[prompt.question_id]).toBe(3);
      expect(submitAnswer).not.toHaveBeenCalled();

      // The grade can still be corrected on the recap before submitting.
      act(() => {
        result.current.setQuality(prompt.question_id, 1);
      });

      await act(async () => {
        await result.current.sendResult();
      });

      expect(submitAnswer).toHaveBeenCalledWith(
        { [prompt.question_id]: 1 },
        IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        contextItems.length,
        { [prompt.question_id]: prompt.question_id },
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
    const items = [imageItem(1, "France", [], 1)];
    const contextItems = [
      ...items,
      imageItem(2, "Germany", [], 10),
      imageItem(3, "Spain", [], 4),
      imageItem(4, "Italy", [], 8)
    ];

    const { result } = renderHook(() =>
      useMediaReview(items, onComplete, submitAnswer, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        contextItems,
        inlineChoiceRating: true
      })
    );
    const prompt = result.current.currentPromptItem;
    const wrong = result.current.choiceOptions.find(
      option => option.question_id !== prompt.question_id
    );

    act(() => {
      result.current.handleChoiceSelect(wrong.question_id);
    });
    expect(result.current.interactionFeedback?.isCorrect).toBe(false);

    vi.useFakeTimers();
    act(() => {
      result.current.rateChoice();
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    vi.useRealTimers();

    expect(result.current.resultMode).toBe(true);
    expect(result.current.qualityByQuestionId[prompt.question_id]).toBe(0);

    await act(async () => {
      await result.current.sendResult();
    });

    // The wrong pick is the confusion signal worth recording, so the selected
    // item id is sent rather than the correct one.
    expect(submitAnswer).toHaveBeenCalledWith(
      { [prompt.question_id]: 0 },
      IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      contextItems.length,
      { [prompt.question_id]: wrong.question_id },
      expect.any(Object)
    );
    expect(onComplete).toHaveBeenCalledWith([prompt.question_id]);
  });

  it("multiple_choice_label can sample easier distractors from a larger pool", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const items = [
      imageItem(1, "France", [], 1)
    ];
    const contextItems = [
      ...items,
      imageItem(2, "Germany", [], 10),
      imageItem(3, "Spain", [], 4),
      imageItem(4, "Italy", [], 8),
      imageItem(5, "Portugal", [], 9)
    ];

    try {
      const { result } = renderHook(() =>
        useMediaReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
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

  it("multiple_choice_image cools used distractors and excludes answered targets", () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const items = [
      imageItem(1, "France", [], 1),
      imageItem(6, "Canada", [], 10)
    ];
    const contextItems = [
      ...items,
      imageItem(2, "Germany", [], 10),
      imageItem(3, "Spain", [], 9.5),
      imageItem(4, "Italy", [], 9),
      imageItem(5, "Portugal", [], 9.9),
      imageItem(7, "Belgium", [], 9.8),
      imageItem(8, "Ireland", [], 9.7)
    ];

    try {
      const { result } = renderHook(() =>
        useMediaReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
          contextItems
        })
      );
      const firstPrompt = result.current.currentPromptItem;

      expect(firstPrompt.question_id).toBe(6);
      expect(optionIds(result.current.gridItems.map(row => row.item))).toEqual([
        2,
        5,
        6,
        7
      ]);

      act(() => {
        result.current.handleImageSelect(firstPrompt.question_id);
      });
      act(() => {
        vi.advanceTimersByTime(1300);
      });

      const nextIds = optionIds(result.current.gridItems.map(row => row.item));

      expect(result.current.currentPromptItem.question_id).toBe(1);
      expect(nextIds).toEqual([1, 3, 4, 8]);
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

  it("multiple_choice_image excludes a missed target from later distractors", () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const items = [
      imageItem(1, "France", [], 1),
      imageItem(6, "Canada", [], 10)
    ];
    const contextItems = [
      ...items,
      imageItem(2, "Germany", [], 10),
      imageItem(3, "Spain", [], 9.5),
      imageItem(4, "Italy", [], 9),
      imageItem(5, "Portugal", [], 9.9),
      imageItem(7, "Belgium", [], 9.8),
      imageItem(8, "Ireland", [], 9.7)
    ];

    try {
      const { result } = renderHook(() =>
        useMediaReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
          contextItems
        })
      );
      const firstPrompt = result.current.currentPromptItem;

      expect(firstPrompt.question_id).toBe(6);

      // Answer incorrectly so the target is resolved as missed, not found.
      const wrong = result.current.gridItems
        .map(row => row.item)
        .find(item => item.question_id !== firstPrompt.question_id);

      act(() => {
        result.current.handleImageSelect(wrong.question_id);
      });
      act(() => {
        vi.advanceTimersByTime(1300);
      });

      const nextIds = optionIds(result.current.gridItems.map(row => row.item));

      expect(result.current.currentPromptItem.question_id).toBe(1);
      expect(new Set(nextIds).size).toBe(nextIds.length);
      // A missed answer counts as answered and is excluded from distractors.
      expect(nextIds).not.toContain(firstPrompt.question_id);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("multiple_choice_label wrong answers reveal the target during feedback", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        contextItems: items
      })
    );
    const prompt = result.current.currentPromptItem;
    const wrong = result.current.choiceOptions.find(option =>
      option.question_id !== prompt.question_id
    );

    act(() => {
      result.current.handleChoiceSelect(wrong.question_id);
    });

    expect(result.current.interactionFeedback).toMatchObject({
      correctQuestionId: prompt.question_id,
      isCorrect: false,
      selectedQuestionId: wrong.question_id
    });
    expect(result.current.activeQuestionId).toBe(prompt.question_id);
    expect(result.current.gridItems).toHaveLength(1);
    expect(result.current.gridItems.find(row =>
      row.item.question_id === prompt.question_id
    )).toMatchObject({
      feedbackState: "missed",
      isMissed: true,
      isRevealed: true
    });
  });

  it("multiple_choice_label shows one prompt image at a time", () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random");

    randomSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(0.99);

    try {
      const items = [
        imageItem(1, "France"),
        imageItem(2, "Germany"),
        imageItem(3, "Spain"),
        imageItem(4, "Italy")
      ];
      const { result } = renderHook(() =>
        useMediaReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
          contextItems: items
        })
      );
      const firstPromptId = result.current.currentPromptItem.question_id;

      expect(result.current.gridItems.map(row => row.item.question_id))
        .toEqual([firstPromptId]);

      act(() => {
        result.current.handleChoiceSelect(firstPromptId);
      });

      expect(result.current.gridItems.map(row => row.item.question_id))
        .toEqual([firstPromptId]);

      act(() => {
        vi.advanceTimersByTime(1300);
      });

      expect(result.current.currentPromptItem.question_id).not.toBe(firstPromptId);
      expect(result.current.gridItems.map(row => row.item.question_id))
        .toEqual([result.current.currentPromptItem.question_id]);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("multiple_choice_image shows image choices and resolves by clicked image", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
        contextItems: items
      })
    );
    const prompt = result.current.currentPromptItem;

    expect(result.current.gridItems).toHaveLength(4);
    expect(result.current.gridItems.map(row => row.item.question_id)).toContain(
      prompt.question_id
    );

    act(() => {
      result.current.handleImageSelect(prompt.question_id);
    });

    expect(result.current.foundQuestionIds).toContain(prompt.question_id);
  });

  it("multiple_choice_image wrong answers reveal the target and clicked image during feedback", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
        contextItems: items
      })
    );
    const prompt = result.current.currentPromptItem;
    const wrong = result.current.gridItems.find(row =>
      row.item.question_id !== prompt.question_id
    ).item;

    act(() => {
      result.current.handleImageSelect(wrong.question_id);
    });

    expect(result.current.interactionFeedback).toMatchObject({
      correctQuestionId: prompt.question_id,
      isCorrect: false,
      selectedQuestionId: wrong.question_id
    });
    expect(result.current.gridItems.find(row =>
      row.item.question_id === prompt.question_id
    )).toMatchObject({
      feedbackState: "missed",
      isMissed: true,
      isRevealed: true
    });
    expect(result.current.gridItems.find(row =>
      row.item.question_id === wrong.question_id
    )).toMatchObject({
      feedbackState: "wrong",
      isMissed: false,
      isRevealed: true
    });
  });

  it("multiple_choice_image keeps previously answered distractors visually neutral", () => {
    vi.useFakeTimers();

    try {
      const items = [
        imageItem(1, "France"),
        imageItem(2, "Germany"),
        imageItem(3, "Spain"),
        imageItem(4, "Italy")
      ];
      const { result } = renderHook(() =>
        useMediaReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
          contextItems: items
        })
      );
      const firstPrompt = result.current.currentPromptItem;

      act(() => {
        result.current.handleImageSelect(firstPrompt.question_id);
      });
      act(() => {
        vi.advanceTimersByTime(1300);
      });

      const previousAnswerAsDistractor = result.current.gridItems.find(row =>
        row.item.question_id === firstPrompt.question_id
      );

      expect(previousAnswerAsDistractor).toMatchObject({
        feedbackState: "",
        isFound: false,
        isMissed: false,
        isRevealed: false
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bulk-updates found image qualities while missed images stay locked at zero", () => {
    const items = [
      {
        ...imageItem(1, "France"),
        projected_intervals: { 1: 4, 2: 12, 3: 30 }
      },
      {
        ...imageItem(2, "Germany"),
        projected_intervals: { 1: 6, 2: 18, 3: 45 }
      },
      {
        ...imageItem(3, "Spain"),
        projected_intervals: { 0: 0, 1: 3, 2: 9, 3: 24 }
      }
    ];
    const { result } = renderHook(() => useMediaReview(items, vi.fn()));
    const found = answerActive(result);

    act(() => {
      result.current.finishReview();
    });
    act(() => {
      result.current.setFoundImageQualities(3);
    });

    expect(result.current.qualityByQuestionId[found.question_id]).toBe(3);
    items
      .filter(item => item.question_id !== found.question_id)
      .forEach(item => {
        expect(result.current.qualityByQuestionId[item.question_id]).toBe(0);
      });
    expect(result.current.foundBulkQuality).toBe(3);
    expect(result.current.recapRows.find(row =>
      row.item.question_id === found.question_id
    ).projectedInterval).toBe(found.projected_intervals[3]);
  });

  it("sorts image recap rows by the interval for the currently selected quality", () => {
    const items = [
      {
        ...imageItem(1, "Alpha"),
        progress: { difficulty: 8, interval: 20 },
        projected_intervals: { 1: 5, 2: 20, 3: 80 }
      },
      {
        ...imageItem(2, "Beta"),
        progress: { difficulty: 6, interval: 40 },
        projected_intervals: { 1: 10, 2: 40, 3: 60 }
      },
      {
        ...imageItem(3, "Gamma"),
        progress: { difficulty: 4, interval: 0 },
        projected_intervals: { 0: 0, 1: 2, 2: 8, 3: 16 }
      }
    ];
    const { result } = renderHook(() =>
      useMediaReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );

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
      result.current.finishReview();
    });
    act(() => {
      result.current.toggleRecapSort("interval");
    });

    expect(result.current.recapRows.map(row => row.item.answer)).toEqual([
      "Alpha",
      "Beta",
      "Gamma"
    ]);

    act(() => {
      result.current.setQuality(1, 3);
    });

    expect(result.current.recapRows.map(row => row.item.answer)).toEqual([
      "Beta",
      "Alpha",
      "Gamma"
    ]);
  });
});

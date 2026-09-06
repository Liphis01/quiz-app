import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TextGroupReview from "./TextGroupReview";

describe("TextGroupReview self-graded type_all", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const textItems = [
    {
      question_id: 1,
      question: "chat",
      answer: "cat",
      answer_policy: { preset: "relaxed" },
      progress: {}
    },
    {
      question_id: 2,
      question: "chien",
      answer: "dog",
      answer_policy: { preset: "relaxed" },
      progress: {}
    }
  ];

  function renderSelfGradedGroup({
    graduateAnswer = vi.fn().mockResolvedValue(undefined),
    onAnsweringComplete = vi.fn(),
    onComplete = vi.fn(),
    reviewItems = textItems,
    submitAnswer = vi.fn().mockResolvedValue(undefined)
  } = {}) {
    const view = render(
      <TextGroupReview
        group={{ type_group: "text", items: reviewItems }}
        reviewItems={reviewItems}
        mode="type_all"
        graduateAnswer={graduateAnswer}
        onAnsweringComplete={onAnsweringComplete}
        onComplete={onComplete}
        submitAnswer={submitAnswer}
      />
    );

    return {
      ...view,
      graduateAnswer,
      onAnsweringComplete,
      onComplete,
      submitAnswer
    };
  }

  it("shows one pair at a time and submits only the chosen qualities", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    const onAnsweringComplete = vi.fn();
    const onComplete = vi.fn();
    const { container } = renderSelfGradedGroup({
      onAnsweringComplete,
      onComplete,
      submitAnswer
    });

    expect(screen.getByText("chat")).toBeInTheDocument();
    expect(screen.queryByText("chien")).not.toBeInTheDocument();

    const input = screen.getByLabelText("Réponse facultative");
    fireEvent.change(input, { target: { value: "wrong scratch" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("cat")).toBeInTheDocument();
    expect(screen.queryByText("Déjà répondu.")).not.toBeInTheDocument();
    expect(submitAnswer).not.toHaveBeenCalled();

    vi.useFakeTimers();
    fireEvent.click(container.querySelector("[data-text-self-grade-quality='3']"));

    act(() => {
      vi.advanceTimersByTime(420);
    });
    vi.useRealTimers();

    expect(screen.getByText("chien")).toBeInTheDocument();
    expect(screen.queryByText("chat")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Voir la réponse" }));
    fireEvent.click(container.querySelector("[data-text-self-grade-quality='0']"));

    expect(await screen.findByRole("button", { name: "Valider" }))
      .toBeInTheDocument();
    expect(onAnsweringComplete).toHaveBeenCalledWith([2]);

    const firstRecapRow = container.querySelectorAll("[data-text-recap-row]")[0];
    fireEvent.click(firstRecapRow.querySelector("[data-text-recap-quality='1']"));
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith(
        { 1: 1, 2: 0 },
        "type_all",
        2,
        undefined,
        undefined
      );
    });
    expect(onComplete).toHaveBeenCalledWith([2]);
  });

  it("uses Enter to reveal, then Enter again as the Bon default", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderSelfGradedGroup({
      reviewItems: [textItems[0]],
      submitAnswer
    });

    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("cat")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "Valider" }));

    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith(
        { 1: 2 },
        "type_all",
        1,
        undefined,
        undefined
      );
    });
  });

  it("uses Encore and Acquis for relearning self-graded items", async () => {
    const graduateAnswer = vi.fn().mockResolvedValue(undefined);
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderSelfGradedGroup({
      graduateAnswer,
      reviewItems: [{
        ...textItems[0],
        progress: { relearning: true }
      }],
      submitAnswer
    });

    fireEvent.click(screen.getByRole("button", { name: "Voir la réponse" }));

    expect(screen.getByText("Encore")).toBeInTheDocument();
    expect(screen.getByText("Acquis")).toBeInTheDocument();
    expect(screen.queryByText("Bon")).not.toBeInTheDocument();
    expect(screen.queryByText("Facile")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Acquis"));
    fireEvent.click(await screen.findByRole("button", { name: "Valider" }));

    await waitFor(() => {
      expect(graduateAnswer).toHaveBeenCalledWith([1]);
    });
    expect(submitAnswer).not.toHaveBeenCalled();
  });
});


describe("TextGroupReview completion guard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderGroup(submitAnswer) {
    return render(
      <TextGroupReview
        group={{ type_group: "text" }}
        reviewItems={[
          {
            question_id: 1,
            question: "chat",
            answer: "cat",
            answer_policy: { preset: "relaxed" },
            progress: {}
          },
          {
            question_id: 2,
            question: "chien",
            answer: "dog",
            answer_policy: { preset: "relaxed" },
            progress: {}
          }
        ]}
        mode="type_all"
        showQualityControls={false}
        submitAnswer={submitAnswer}
        onComplete={vi.fn()}
      />
    );
  }

  // M0 trust breaker: pressing a generic completion button before touching
  // anything used to grade every item in the group as a failure at once.
  it("blocks Abandonner until the learner has attempted something", () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderGroup(submitAnswer);

    const finish = screen.getByRole("button", { name: "Abandonner le groupe" });

    expect(finish).toBeDisabled();

    fireEvent.click(finish);

    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("enables Abandonner after a wrong attempt, not only a correct one", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderGroup(submitAnswer);

    const input = screen.getAllByPlaceholderText("Réponse…")[0];
    fireEvent.change(input, { target: { value: "totalement faux" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const finish = screen.getByRole("button", { name: "Abandonner le groupe" });

    await waitFor(() => expect(finish).toBeEnabled());

    fireEvent.click(finish);

    // The wrong attempt is still graded 0 -- the guard only stops an
    // interaction-free submit, it never rescues a real miss.
    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith(
        { 1: 0, 2: 0 },
        "type_all",
        expect.anything(),
        { 1: "totalement faux" },
        expect.anything()
      );
    });
  });

  it("selects a wrong typed answer after Enter so it can be edited", () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderGroup(submitAnswer);

    const inputs = screen.getAllByPlaceholderText("Réponse…");
    const wrongInput = inputs[0];

    wrongInput.focus();
    fireEvent.change(wrongInput, { target: { value: "totalement faux" } });
    fireEvent.keyDown(wrongInput, { key: "Enter" });

    expect(document.activeElement).toBe(wrongInput);
    expect(wrongInput).toHaveClass("review-input-shake");
    expect(wrongInput.selectionStart).toBe(0);
    expect(wrongInput.selectionEnd).toBe("totalement faux".length);
    expect(document.activeElement).not.toBe(inputs[1]);
  });

  it("labels a repeated typed text answer as already answered", () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderGroup(submitAnswer);

    let inputs = screen.getAllByPlaceholderText("Réponse…");

    fireEvent.change(inputs[0], { target: { value: "cat" } });
    fireEvent.keyDown(inputs[0], { key: "Enter" });

    inputs = screen.getAllByPlaceholderText("Réponse…");
    const duplicateInput = inputs[0];

    fireEvent.change(duplicateInput, { target: { value: "cat" } });
    fireEvent.keyDown(duplicateInput, { key: "Enter" });

    expect(screen.getByText("Déjà répondu.")).toBeInTheDocument();
    expect(document.activeElement).toBe(duplicateInput);
    expect(duplicateInput).not.toHaveClass("review-input-shake");
    expect(duplicateInput.selectionStart).toBe(0);
    expect(duplicateInput.selectionEnd).toBe("cat".length);
  });
});


describe("TextGroupReview session draft", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  const draftItems = [
    {
      question_id: 1,
      question: "chat",
      answer: "cat",
      answer_policy: { preset: "relaxed" },
      progress: {}
    },
    {
      question_id: 2,
      question: "chien",
      answer: "dog",
      answer_policy: { preset: "relaxed" },
      progress: {}
    }
  ];

  function renderDraftGroup(props = {}) {
    return render(
      <TextGroupReview
        group={{ group_id: 42, type_group: "text" }}
        reviewItems={draftItems}
        mode="type_all"
        showQualityControls={false}
        submitAnswer={vi.fn().mockResolvedValue(undefined)}
        onComplete={vi.fn()}
        {...props}
      />
    );
  }

  // The scenario this whole feature exists for: leaving to the menu mid-group
  // (modelled here as an unmount, since that's what actually happens to this
  // component when the review session's parent screen swaps out) must not
  // throw away an answer that was never submitted to the backend.
  it("restores an in-progress answer after leaving and returning to the same group", async () => {
    const { unmount } = renderDraftGroup();

    const input = screen.getAllByPlaceholderText("Réponse…")[0];
    fireEvent.change(input, { target: { value: "cat" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Abandonner le groupe" })).toBeEnabled();
    });

    unmount();
    renderDraftGroup();

    expect(screen.getByText("cat")).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("Réponse…")).toHaveLength(1);
  });

  it("keeps the mode the draft was started in, even if a fresh mode is requested on return", async () => {
    const { unmount } = renderDraftGroup({ mode: "type_all" });

    const input = screen.getAllByPlaceholderText("Réponse…")[0];
    fireEvent.change(input, { target: { value: "cat" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Abandonner le groupe" })).toBeEnabled();
    });

    unmount();
    // The backend would otherwise roll a fresh mode on every re-fetch; a
    // resumed draft must not switch the UI out from under its saved answers.
    renderDraftGroup({ mode: "match" });

    expect(screen.getByText("TEXTE · Tout taper")).toBeInTheDocument();
    expect(screen.queryByText("TEXTE · Associer")).not.toBeInTheDocument();
  });

  it("does not restore anything once the group has been submitted", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderDraftGroup({ submitAnswer });

    const inputs = screen.getAllByPlaceholderText("Réponse…");
    fireEvent.change(inputs[0], { target: { value: "cat" } });
    fireEvent.keyDown(inputs[0], { key: "Enter" });
    fireEvent.change(inputs[1], { target: { value: "dog" } });
    fireEvent.keyDown(inputs[1], { key: "Enter" });

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());

    unmount();
    renderDraftGroup();

    expect(screen.getAllByPlaceholderText("Réponse…")).toHaveLength(2);
  });

  it("leaves an untouched group free to come back in a different mode", () => {
    const { unmount } = renderDraftGroup({ mode: "type_all" });

    unmount();
    renderDraftGroup({ mode: "match" });

    expect(screen.getByText("TEXTE · Associer")).toBeInTheDocument();
  });
});

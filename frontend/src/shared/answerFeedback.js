// Shared visual language for a quality grade: same keyframes as the
// multiple-choice reveal tile (index.css) — a success pops, a fail shakes.
export const ANSWER_POP_MS = 420;
export const ANSWER_SHAKE_MS = 400;

export function qualityPickAnimation(quality) {
  return Number(quality) > 0
    ? `answer-pop ${ANSWER_POP_MS}ms ease`
    : `answer-shake ${ANSWER_SHAKE_MS}ms ease`;
}

// How long a quality button's pick animation needs to hold the current UI on
// screen (buttons visible, nothing advanced) before it's safe to grade and
// move on — matches the animation's own duration so it always finishes.
export function qualityPickHoldMs(quality) {
  return Number(quality) > 0 ? ANSWER_POP_MS : ANSWER_SHAKE_MS;
}

import { useEffect, useRef, useState } from "react";
import { qualityPickHoldMs } from "./answerFeedback";

// Holds a quality-button pick on screen for its animation's duration before
// actually committing it, so grading a card advances the review only once
// the pop/shake has had time to finish instead of cutting it off.
export function useQualityPickHold() {
  const [pendingQuality, setPendingQuality] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  function hold(quality, commit) {
    if (pendingQuality !== null) return;

    setPendingQuality(quality);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setPendingQuality(null);
      commit(quality);
    }, qualityPickHoldMs(quality));
  }

  return { pendingQuality, hold };
}

// For a quality picker that's a persistent toggle rather than a one-shot
// commit (the user can freely change their answer before a separate submit
// button applies it) — plays the pick animation once per click without
// gating anything. `key` disambiguates which row/item was just picked when a
// component renders more than one of these pickers at a time.
export function useQualityPickFlash() {
  const [flash, setFlash] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  function flashQuality(key, quality) {
    window.clearTimeout(timeoutRef.current);
    setFlash({ key, quality });
    timeoutRef.current = window.setTimeout(() => setFlash(null), qualityPickHoldMs(quality));
  }

  function isFlashing(key, quality) {
    return flash?.key === key && flash.quality === quality;
  }

  return { flashQuality, isFlashing };
}

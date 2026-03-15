"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Animates a number from 0 (or previous value) to the target value.
 * Skips animation if prefers-reduced-motion is set.
 */
export function useCountUp(
  value: number,
  duration = 400,
  enabled = true,
): number {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setDisplay(value);
      return;
    }

    // Check prefers-reduced-motion
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      prevValue.current = value;
      return;
    }

    const from = prevValue.current;
    const to = value;
    if (from === to) return;

    const start = performance.now();

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // cubic-bezier(0.16, 1, 0.3, 1) approximation — ease-out expo
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      setDisplay(current);

      if (progress < 1) {
        rafId.current = requestAnimationFrame(animate);
      } else {
        setDisplay(to);
        prevValue.current = to;
      }
    };

    rafId.current = requestAnimationFrame(animate);

    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [value, duration, enabled]);

  return display;
}

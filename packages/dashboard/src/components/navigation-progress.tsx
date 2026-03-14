"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin progress bar (like GitHub/YouTube) that animates on route change.
 * Detects route start via click on internal links, ends on pathname change.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPathRef = useRef(pathname);

  // Listen for clicks on internal links to start the progress bar
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
      // Don't trigger for same-page links
      if (href === prevPathRef.current) return;
      // Start progress
      startProgress();
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  // When pathname changes, complete the bar
  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      prevPathRef.current = pathname;
      completeProgress();
    }
  }, [pathname]);

  const startProgress = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(0);
    setVisible(true);

    let current = 0;
    timerRef.current = setInterval(() => {
      // Slow down as we approach 90%
      current += (90 - current) * 0.08;
      if (current >= 89) {
        if (timerRef.current) clearInterval(timerRef.current);
      }
      setProgress(current);
    }, 50);
  };

  const completeProgress = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(100);
    setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 200);
  };

  if (!visible && progress === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: progress + "%",
          backgroundColor: "#0066FF",
          transition: progress === 100 ? "width 150ms ease, opacity 150ms ease 100ms" : "width 200ms ease",
          opacity: progress === 100 ? 0 : 1,
          boxShadow: "0 0 8px rgba(0, 102, 255, 0.4)",
        }}
      />
    </div>
  );
}

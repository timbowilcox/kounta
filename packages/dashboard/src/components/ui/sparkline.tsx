"use client";

import { useRef, useEffect, useState } from "react";

interface SparklineProps {
  data: Array<{ date: string; value: number }>;
  state: "empty" | "partial" | "full";
  color?: string;
  height?: number;
}

/**
 * Minimal sparkline chart — 30-day rolling window.
 *
 * States:
 * - empty: flat dashed line at midpoint
 * - partial: left-padded flat + real data, gradient fill, animate in
 * - full: all data, gradient fill, animate in
 */
export function Sparkline({ data, state, color = "var(--accent)", height = 40 }: SparklineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (state !== "empty") {
      // Trigger clip-path reveal after mount
      const id = requestAnimationFrame(() => setRevealed(true));
      return () => cancelAnimationFrame(id);
    }
  }, [state]);

  if (state === "empty") {
    return (
      <svg width="100%" height={height} viewBox={`0 0 200 ${height}`} preserveAspectRatio="none">
        <line
          x1="0"
          y1={height / 2}
          x2="200"
          y2={height / 2}
          stroke="var(--border-strong)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>
    );
  }

  // Build path from data
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 4; // vertical padding

  const width = 200;
  const chartHeight = height - padding * 2;

  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width;
    const y = padding + chartHeight - ((v - min) / range) * chartHeight;
    return { x, y };
  });

  // Build smooth path using monotone interpolation
  const linePath = points.reduce((acc, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1];
    const cpx = (prev.x + point.x) / 2;
    return `${acc} C ${cpx} ${prev.y}, ${cpx} ${point.y}, ${point.x} ${point.y}`;
  }, "");

  // Area path for gradient fill
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  const gradientId = `sparkGrad-${Math.random().toString(36).slice(2, 8)}`;
  const clipId = `sparkClip-${Math.random().toString(36).slice(2, 8)}`;

  // Check reduced motion
  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const shouldAnimate = !prefersReducedMotion;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        {shouldAnimate && (
          <clipPath id={clipId}>
            <rect
              x="0"
              y="0"
              width={revealed ? width : 0}
              height={height}
              style={{
                transition: "width 600ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            />
          </clipPath>
        )}
      </defs>
      <g clipPath={shouldAnimate ? `url(#${clipId})` : undefined}>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
      </g>
    </svg>
  );
}

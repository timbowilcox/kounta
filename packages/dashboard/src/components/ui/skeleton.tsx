"use client";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Reusable skeleton loading placeholder.
 * Uses the .skeleton class from globals.css for shimmer animation.
 */
export function Skeleton({
  width,
  height = 16,
  borderRadius,
  className = "",
  style,
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius: borderRadius ?? "var(--radius-md)",
        ...style,
      }}
    />
  );
}

/**
 * Skeleton for a metric card — matches MetricCard dimensions.
 */
export function MetricCardSkeleton() {
  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "20px 24px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <Skeleton width={80} height={12} />
        <Skeleton width={40} height={12} />
      </div>
      <Skeleton width={120} height={24} style={{ marginBottom: 12 }} />
      <Skeleton width="100%" height={40} borderRadius={4} />
    </div>
  );
}

/**
 * Skeleton for a transaction row — matches table row dimensions.
 */
export function TransactionRowSkeleton() {
  return (
    <tr>
      <td style={{ padding: "12px 20px" }}>
        <Skeleton width={60} height={13} />
      </td>
      <td style={{ padding: "12px 20px" }}>
        <Skeleton width="60%" height={13} />
      </td>
      <td style={{ padding: "12px 20px", textAlign: "right" }}>
        <Skeleton width={80} height={13} style={{ marginLeft: "auto" }} />
      </td>
      <td style={{ padding: "12px 20px", textAlign: "right" }}>
        <Skeleton width={50} height={13} style={{ marginLeft: "auto" }} />
      </td>
    </tr>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { fetchCurrentTier } from "@/lib/actions";

const mainNavItems = [
  { href: "/", label: "Overview", icon: OverviewIcon },
  { href: "/transactions", label: "Transactions", icon: TransactionsIcon },
  { href: "/invoices", label: "Invoices", icon: InvoicesIcon },
  { href: "/bank-feeds", label: "Bank Feeds", icon: BankFeedsIcon },
  { href: "/revenue", label: "Revenue", icon: RevenueIcon },
  { href: "/fixed-assets", label: "Fixed Assets", icon: FixedAssetsIcon },
  { href: "/statements", label: "Statements", icon: StatementsIcon },
  { href: "/notifications", label: "Insights", icon: InsightsIcon },
];

const bottomNavItems = [
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

const TIER_BADGE_STYLES: Record<string, { color: string; bg: string }> = {
  free: { color: "var(--text-tertiary)", bg: "transparent" },
  builder: { color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
  pro: { color: "#a855f7", bg: "rgba(168,85,247,0.1)" },
  platform: { color: "#d97706", bg: "rgba(217,119,6,0.1)" },
};

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [tier, setTier] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentTier().then(setTier).catch(() => {});
  }, []);
  const renderNavItem = ({ href, label, icon: Icon }: typeof mainNavItems[number]) => {
    const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <li key={href} style={{ listStyle: "none" }}>
        <Link
          href={href}
          className={`flex items-center gap-3 relative sidebar-nav-link${isActive ? " sidebar-nav-link--active" : ""}`}
          style={{
            padding: "0 0.75rem",
            height: "2.25rem",
            borderRadius: "var(--radius-md)",
            fontSize: "0.8125rem",
            fontWeight: isActive ? 500 : 400,
            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            backgroundColor: isActive ? "var(--surface-1)" : "transparent",
            borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
          }}
        >
          <Icon active={isActive} />
          {label}
        </Link>
      </li>
    );
  };

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col"
      style={{
        width: "var(--sidebar-width)",
        backgroundColor: "var(--background)",
        borderRight: "1px solid var(--border)",
        paddingTop: "1.5rem",
        paddingBottom: "1rem",
        zIndex: 10,
      }}
    >
      {/* Logo */}
      <div style={{ paddingLeft: "1.25rem", paddingRight: "1.25rem", marginBottom: "2rem" }}>
        <Link href="/" className="flex items-center">
          <img src="/logo.svg" alt="Kounta" style={{ height: "1.32rem" }} />
        </Link>
      </div>

      {/* Main navigation */}
      <nav className="flex-1" style={{ paddingLeft: "0.75rem", paddingRight: "0.75rem" }}>
        <ul style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
          {mainNavItems.map(renderNavItem)}
        </ul>

        {/* Separator */}
        <div style={{ margin: "0.75rem 0.75rem", borderTop: "1px solid var(--border)" }} />

        {/* Settings */}
        <ul style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
          {bottomNavItems.map(renderNavItem)}
        </ul>
      </nav>

      {/* Tier badge */}
      {tier && (
        <div style={{ paddingLeft: "0.75rem", paddingRight: "0.75rem", marginBottom: "0.5rem" }}>
          {tier === "free" ? (
            <Link
              href="/settings?tab=billing"
              className="flex items-center justify-between"
              style={{
                padding: "0.375rem 0.75rem",
                borderRadius: "var(--radius-md)",
                fontSize: "0.75rem",
                color: "var(--text-tertiary)",
                textDecoration: "none",
              }}
            >
              <span>Free plan</span>
              <span style={{ color: "var(--accent)", fontWeight: 500 }}>Upgrade &rarr;</span>
            </Link>
          ) : (
            <div
              className="flex items-center gap-2"
              style={{
                padding: "0.375rem 0.75rem",
                borderRadius: "var(--radius-md)",
                fontSize: "0.75rem",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "1px 8px",
                  borderRadius: 9999,
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  color: TIER_BADGE_STYLES[tier]?.color ?? "var(--text-secondary)",
                  backgroundColor: TIER_BADGE_STYLES[tier]?.bg ?? "var(--surface-1)",
                  textTransform: "capitalize",
                }}
              >
                {tier}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Assistant link */}
      <div style={{ paddingLeft: "0.75rem", paddingRight: "0.75rem", marginBottom: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
        <Link
          href="/assistant"
          className="flex items-center w-full sidebar-cmd-bar"
          style={{
            padding: "0 0.75rem",
            height: "2.25rem",
            borderRadius: "var(--radius-md)",
            fontSize: "0.8125rem",
            fontWeight: 400,
            color: "var(--text-tertiary)",
            backgroundColor: "var(--surface-1)",
            border: "1px solid var(--border)",
            cursor: "pointer",
            gap: "0.5rem",
            transition: "all 150ms ease",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--border-strong)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <span className="sidebar-cmd-star" style={{ transition: "color 150ms ease" }}>✦</span>
          <span style={{ flex: 1, textAlign: "left" }}>Ask Kounta...</span>
          <kbd className="font-mono" style={{ fontSize: "0.6875rem", color: "var(--text-disabled)", opacity: 0.8 }}>⌘K</kbd>
        </Link>
      </div>

      {/* Footer */}
      <div
        style={{
          paddingLeft: "0.75rem",
          paddingRight: "0.75rem",
          paddingTop: "0.5rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        {session?.user && <UserProfileMenu session={session} />}
      </div>
    </aside>
  );
}

function UserProfileMenu({ session }: { session: NonNullable<ReturnType<typeof useSession>["data"]> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Popover */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 0.5rem)",
            left: 0,
            right: 0,
            backgroundColor: "var(--surface-2)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-dropdown)",
            border: "1px solid var(--border-strong)",
            padding: "0.75rem",
            zIndex: 50,
          }}
        >
          <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-primary)", marginBottom: "0.125rem" }}>
            {session.user?.name ?? "Kounta User"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.75rem" }}>
            {session.user?.email}
          </div>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
            <button
              onClick={() => signOut({ callbackUrl: "/signin" })}
              className="flex items-center gap-2 w-full text-left"
              style={{
                padding: "0.375rem 0.5rem",
                borderRadius: "var(--radius-md)",
                color: "var(--text-secondary)",
                fontSize: "0.8125rem",
                fontWeight: 500,
                border: "none",
                backgroundColor: "transparent",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
                e.currentTarget.style.color = "#ef4444";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 14H3.33a1.33 1.33 0 0 1-1.33-1.33V3.33A1.33 1.33 0 0 1 3.33 2H6" />
                <path d="M10.67 11.33L14 8l-3.33-3.33" />
                <path d="M14 8H6" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Profile button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full text-left"
        style={{
          padding: "0.5rem 0.75rem",
          height: "2.75rem",
          borderRadius: "var(--radius-md)",
          border: "none",
          backgroundColor: open ? "var(--surface-1)" : "transparent",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-1)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        {session.user?.image && (
          <img
            src={session.user.image}
            alt=""
            style={{ width: "1.75rem", height: "1.75rem", borderRadius: "50%", border: "1px solid var(--border)", flexShrink: 0 }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="truncate" style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)" }}>
            {session.user?.name ?? "Kounta User"}
          </div>
        </div>
      </button>
    </div>
  );
}

// ── Icons (16px, clean strokes) ──────────────────────────────────

function OverviewIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="6" height="6" rx="1.5" />
      <rect x="12" y="2" width="6" height="6" rx="1.5" />
      <rect x="2" y="12" width="6" height="6" rx="1.5" />
      <rect x="12" y="12" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function TransactionsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5.5h14" />
      <path d="M3 10h14" />
      <path d="M3 14.5h9" />
    </svg>
  );
}

function StatementsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17V6" />
      <path d="M7.5 17V9" />
      <path d="M12 17V3" />
      <path d="M16.5 17V11" />
    </svg>
  );
}

function InvoicesIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6z" />
      <path d="M13 2v4h4" />
      <path d="M7 10h6" />
      <path d="M7 13h4" />
    </svg>
  );
}

function BankFeedsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h14" />
      <path d="M4 4v12" />
      <path d="M16 4v12" />
      <path d="M3 16h14" />
      <path d="M3 8h14" />
      <path d="M7 8v8" />
      <path d="M13 8v8" />
    </svg>
  );
}

function RevenueIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 16l4-5 4 3 4-6 4 3" />
      <path d="M18 16H2V4" />
    </svg>
  );
}

function FixedAssetsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17h14" />
      <path d="M4 17V7l6-4 6 4v10" />
      <path d="M8 17v-5h4v5" />
      <path d="M7 9.5h1.5" />
      <path d="M11.5 9.5H13" />
    </svg>
  );
}

function InsightsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={active ? "var(--text-primary)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M16.5 12.5a1.5 1.5 0 0 0 .3 1.65l.05.06a1.82 1.82 0 0 1-1.29 3.1 1.82 1.82 0 0 1-1.29-.53l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.91 1.37V18a1.82 1.82 0 0 1-3.64 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06A1.82 1.82 0 1 1 2.65 14.3l.06-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.91H1.5a1.82 1.82 0 0 1 0-3.64h.1A1.5 1.5 0 0 0 3 7.07a1.5 1.5 0 0 0-.3-1.65l-.06-.05A1.82 1.82 0 1 1 5.22 2.8l.05.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .91-1.37V1.5a1.82 1.82 0 0 1 3.64 0v.1a1.5 1.5 0 0 0 .91 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.82 1.82 0 0 1 2.58 2.58l-.06.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.91h.14a1.82 1.82 0 0 1 0 3.64h-.1a1.5 1.5 0 0 0-1.37.91z" transform="scale(0.85) translate(1.8 1.8)" />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const mainNavItems = [
  { href: "/", label: "Overview", icon: OverviewIcon },
  { href: "/accounts", label: "Accounts", icon: AccountsIcon },
  { href: "/transactions", label: "Transactions", icon: TransactionsIcon },
  { href: "/statements", label: "Statements", icon: StatementsIcon },
  { href: "/assistant", label: "Assistant", icon: AssistantIcon },
  { href: "/bank-feeds", label: "Bank Feeds", icon: BankFeedsIcon },
  { href: "/notifications", label: "Insights", icon: InsightsIcon },
];

const bottomNavItems = [
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const renderNavItem = ({ href, label, icon: Icon }: typeof mainNavItems[number]) => {
    const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <li key={href} style={{ listStyle: "none" }}>
        <Link
          href={href}
          className="flex items-center gap-3 relative"
          style={{
            padding: "11px 14px",
            borderRadius: 12,
            fontSize: 14,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? "#3B82F6" : "rgba(0,0,0,0.55)",
            backgroundColor: isActive ? "rgba(59,130,246,0.08)" : "transparent",
            transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          onMouseEnter={(e) => {
            if (!isActive) {
              e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)";
              e.currentTarget.style.color = "#0A0A0A";
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive) {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "rgba(0,0,0,0.55)";
            }
          }}
        >
          {isActive && (
            <span
              className="absolute left-0 top-1/2 -translate-y-1/2"
              style={{
                width: 3,
                height: 20,
                borderRadius: "0 3px 3px 0",
                backgroundColor: "#3B82F6",
              }}
            />
          )}
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
        width: 260,
        backgroundColor: "#F7F7F6",
        borderRight: "1px solid rgba(0,0,0,0.10)",
        paddingTop: 32,
        paddingBottom: 24,
      }}
    >
      {/* Logo */}
      <div style={{ paddingLeft: 28, paddingRight: 28, marginBottom: 40 }}>
        <Link href="/" className="flex items-center gap-3">
          <img src="/logo-icon.svg" alt="Ledge" width={28} height={28} />
          <span
            className="text-lg font-bold tracking-tight"
            style={{ color: "#0A0A0A", fontFamily: "var(--font-family-display)" }}
          >
            Ledge
          </span>
        </Link>
      </div>

      {/* Main navigation */}
      <nav className="flex-1" style={{ paddingLeft: 16, paddingRight: 16 }}>
        <div className="section-label" style={{ paddingLeft: 12, marginBottom: 12 }}>
          Navigation
        </div>
        <ul style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {mainNavItems.map(renderNavItem)}
        </ul>

        {/* Separator */}
        <div style={{ margin: "16px 12px", borderTop: "1px solid rgba(0,0,0,0.08)" }} />

        {/* Settings */}
        <ul style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {bottomNavItems.map(renderNavItem)}
        </ul>
      </nav>

      {/* Footer */}
      <div
        style={{
          paddingLeft: 28,
          paddingRight: 28,
          paddingTop: 20,
          borderTop: "1px solid rgba(0,0,0,0.10)",
        }}
      >
        {session?.user && (
          <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
            {session.user.image && (
              <img
                src={session.user.image}
                alt=""
                style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid rgba(0,0,0,0.10)", flexShrink: 0 }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <div className="text-sm font-medium truncate" style={{ color: "#0A0A0A" }}>
                {session.user.name}
              </div>
              <div className="text-xs truncate" style={{ color: "rgba(0,0,0,0.36)" }}>
                {session.user.email}
              </div>
            </div>
          </div>
        )}
        <div className="text-xs" style={{ color: "rgba(0,0,0,0.28)" }}>
          Ledge v0.1.0
        </div>
      </div>
    </aside>
  );
}

// ── Icons (20px, refined strokes) ────────────────────────────────────

function OverviewIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="6" height="6" rx="1.5" />
      <rect x="12" y="2" width="6" height="6" rx="1.5" />
      <rect x="2" y="12" width="6" height="6" rx="1.5" />
      <rect x="12" y="12" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function AccountsIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3v14" />
      <path d="M7 3h6a3.5 3.5 0 0 1 0 7H7" />
      <path d="M7 10h7a3.5 3.5 0 0 1 0 7H7" />
    </svg>
  );
}

function TransactionsIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5.5h14" />
      <path d="M3 10h14" />
      <path d="M3 14.5h9" />
    </svg>
  );
}

function StatementsIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17V6" />
      <path d="M7.5 17V9" />
      <path d="M12 17V3" />
      <path d="M16.5 17V11" />
    </svg>
  );
}

function BankFeedsIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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

function AssistantIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2l1.5 3.5L15 7l-3.5 1.5L10 12l-1.5-3.5L5 7l3.5-1.5L10 2z" />
      <path d="M15 12l.75 1.75L17.5 14.5l-1.75.75L15 17l-.75-1.75L12.5 14.5l1.75-.75L15 12z" />
    </svg>
  );
}

function InsightsIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M16.5 12.5a1.5 1.5 0 0 0 .3 1.65l.05.06a1.82 1.82 0 0 1-1.29 3.1 1.82 1.82 0 0 1-1.29-.53l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.91 1.37V18a1.82 1.82 0 0 1-3.64 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06A1.82 1.82 0 1 1 2.65 14.3l.06-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.91H1.5a1.82 1.82 0 0 1 0-3.64h.1A1.5 1.5 0 0 0 3 7.07a1.5 1.5 0 0 0-.3-1.65l-.06-.05A1.82 1.82 0 1 1 5.22 2.8l.05.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .91-1.37V1.5a1.82 1.82 0 0 1 3.64 0v.1a1.5 1.5 0 0 0 .91 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.82 1.82 0 0 1 2.58 2.58l-.06.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.91h.14a1.82 1.82 0 0 1 0 3.64h-.1a1.5 1.5 0 0 0-1.37.91z" transform="scale(0.85) translate(1.8 1.8)" />
    </svg>
  );
}

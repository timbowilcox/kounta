"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

const mainNavItems = [
  { href: "/", label: "Overview", icon: OverviewIcon },
  { href: "/transactions", label: "Transactions", icon: TransactionsIcon },
  { href: "/bank-feeds", label: "Bank Feeds", icon: BankFeedsIcon },
  { href: "/revenue", label: "Revenue", icon: RevenueIcon },
  { href: "/statements", label: "Statements", icon: StatementsIcon },
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
          className={`flex items-center gap-3 relative sidebar-nav-link${isActive ? " sidebar-nav-link--active" : ""}`}
          style={{
            padding: "0 12px",
            height: 36,
            borderRadius: 6,
            fontSize: 13,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? "#0a0a0a" : "#5c564e",
            backgroundColor: isActive ? "#d4ccc4" : "transparent",
          }}
        >
          {isActive && (
            <span
              className="absolute left-0 top-1/2 -translate-y-1/2"
              style={{
                width: 2,
                height: 16,
                borderRadius: 1,
                backgroundColor: "#2d2a26",
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
        width: 240,
        backgroundColor: "#ebe4dc",
        borderRight: "1px solid #d4ccc4",
        paddingTop: 24,
        paddingBottom: 20,
      }}
    >
      {/* Logo */}
      <div style={{ paddingLeft: 20, paddingRight: 20, marginBottom: 32 }}>
        <Link href="/" className="flex items-center gap-3">
          <img src="/logo-icon.svg" alt="Kounta" style={{ width: 28, height: 28 }} />
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#0A0A0A",
              letterSpacing: "-0.01em",
            }}
          >
            Kounta
          </span>
        </Link>
      </div>

      {/* Main navigation */}
      <nav className="flex-1" style={{ paddingLeft: 12, paddingRight: 12 }}>
        <div className="section-label" style={{ paddingLeft: 12, marginBottom: 8 }}>
          Navigation
        </div>
        <ul style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {mainNavItems.map(renderNavItem)}
        </ul>

        {/* Separator */}
        <div style={{ margin: "12px 12px", borderTop: "1px solid #d4ccc4" }} />

        {/* Settings */}
        <ul style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {bottomNavItems.map(renderNavItem)}
        </ul>
      </nav>

      {/* Assistant — pinned above footer */}
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 4 }}>
        <div style={{ borderTop: "1px solid #d4ccc4", paddingTop: 8 }}>
          {(() => {
            const isAssistantActive = pathname.startsWith("/assistant");
            return (
              <Link
                href="/assistant"
                className="flex items-center gap-3 relative"
                style={{
                  padding: "0 12px",
                  height: 36,
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: isAssistantActive ? 600 : 500,
                  color: isAssistantActive ? "#0a0a0a" : "#5c564e",
                  background: isAssistantActive
                    ? "#d4ccc4"
                    : "transparent",
                  transition: "all 150ms ease",
                }}
              >
                {isAssistantActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2"
                    style={{ width: 2, height: 16, borderRadius: 1, backgroundColor: "#2d2a26" }}
                  />
                )}
                <AssistantIcon active={isAssistantActive} />
                Assistant
              </Link>
            );
          })()}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 12,
          borderTop: "1px solid #d4ccc4",
        }}
      >
        {session?.user && <UserProfileMenu session={session} />}
        <div style={{ fontSize: 11, color: "#999999", paddingLeft: 12 }}>
          Kounta v0.1.0
        </div>
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
    <div ref={ref} style={{ position: "relative", marginBottom: 8 }}>
      {/* Popover */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            right: 0,
            backgroundColor: "#FFFFFF",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            border: "1px solid #E5E5E5",
            padding: 12,
            zIndex: 50,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A", marginBottom: 2 }}>
            {session.user?.name ?? "Kounta User"}
          </div>
          <div style={{ fontSize: 12, color: "#999999", marginBottom: 12 }}>
            {session.user?.email}
          </div>
          <div style={{ borderTop: "1px solid #d4ccc4", paddingTop: 8 }}>
            <button
              onClick={() => signOut({ callbackUrl: "/signin" })}
              className="flex items-center gap-2 w-full text-left"
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                color: "#666666",
                fontSize: 13,
                fontWeight: 500,
                border: "none",
                backgroundColor: "transparent",
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#FEF2F2";
                e.currentTarget.style.color = "#DC2626";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#666666";
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
          padding: "8px 12px",
          height: 56,
          borderRadius: 8,
          border: "none",
          backgroundColor: open ? "#F5F5F5" : "transparent",
          cursor: "pointer",
          transition: "background-color 150ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#F5F5F5"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        {session.user?.image && (
          <img
            src={session.user.image}
            alt=""
            style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #E5E5E5", flexShrink: 0 }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="truncate" style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A" }}>
            {session.user?.name ?? "Kounta User"}
          </div>
          <div className="truncate" style={{ fontSize: 12, color: "#999999" }}>
            {session.user?.email}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#999999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}>
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>
    </div>
  );
}

// ── Icons (18px, clean strokes) ──────────────────────────────────

function OverviewIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="6" height="6" rx="1.5" />
      <rect x="12" y="2" width="6" height="6" rx="1.5" />
      <rect x="2" y="12" width="6" height="6" rx="1.5" />
      <rect x="12" y="12" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function AccountsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3v14" />
      <path d="M7 3h6a3.5 3.5 0 0 1 0 7H7" />
      <path d="M7 10h7a3.5 3.5 0 0 1 0 7H7" />
    </svg>
  );
}

function TransactionsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5.5h14" />
      <path d="M3 10h14" />
      <path d="M3 14.5h9" />
    </svg>
  );
}

function StatementsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17V6" />
      <path d="M7.5 17V9" />
      <path d="M12 17V3" />
      <path d="M16.5 17V11" />
    </svg>
  );
}

function BankFeedsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2l1.5 3.5L15 7l-3.5 1.5L10 12l-1.5-3.5L5 7l3.5-1.5L10 2z" />
      <path d="M15 12l.75 1.75L17.5 14.5l-1.75.75L15 17l-.75-1.75L12.5 14.5l1.75-.75L15 12z" />
    </svg>
  );
}

function RevenueIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 16l4-5 4 3 4-6 4 3" />
      <path d="M18 16H2V4" />
    </svg>
  );
}

function InsightsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={active ? "#2d2a26" : "#8a837a"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M16.5 12.5a1.5 1.5 0 0 0 .3 1.65l.05.06a1.82 1.82 0 0 1-1.29 3.1 1.82 1.82 0 0 1-1.29-.53l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.91 1.37V18a1.82 1.82 0 0 1-3.64 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06A1.82 1.82 0 1 1 2.65 14.3l.06-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.91H1.5a1.82 1.82 0 0 1 0-3.64h.1A1.5 1.5 0 0 0 3 7.07a1.5 1.5 0 0 0-.3-1.65l-.06-.05A1.82 1.82 0 1 1 5.22 2.8l.05.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .91-1.37V1.5a1.82 1.82 0 0 1 3.64 0v.1a1.5 1.5 0 0 0 .91 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.82 1.82 0 0 1 2.58 2.58l-.06.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.91h.14a1.82 1.82 0 0 1 0 3.64h-.1a1.5 1.5 0 0 0-1.37.91z" transform="scale(0.85) translate(1.8 1.8)" />
    </svg>
  );
}

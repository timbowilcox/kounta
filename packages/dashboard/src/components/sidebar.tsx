"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

const navItems = [
  { href: "/", label: "Overview", icon: OverviewIcon },
  { href: "/accounts", label: "Accounts", icon: AccountsIcon },
  { href: "/transactions", label: "Transactions", icon: TransactionsIcon },
  { href: "/statements", label: "Statements", icon: StatementsIcon },
  { href: "/api-keys", label: "API Keys", icon: KeysIcon },
  { href: "/mcp", label: "MCP Guide", icon: McpIcon },
  { href: "/billing", label: "Billing", icon: BillingIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

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

      {/* Navigation */}
      <nav className="flex-1" style={{ paddingLeft: 16, paddingRight: 16 }}>
        <div className="section-label" style={{ paddingLeft: 12, marginBottom: 12 }}>
          Navigation
        </div>
        <ul style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {navItems.map(({ href, label, icon: Icon }) => {
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
                    backgroundColor: isActive ? "rgba(59,130,246,0.1)" : "transparent",
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
          })}
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
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="text-sm font-medium truncate" style={{ color: "#0A0A0A" }}>
                {session.user.name}
              </div>
              <div className="text-xs truncate" style={{ color: "rgba(0,0,0,0.36)" }}>
                {session.user.email}
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/signin" })}
              className="text-xs"
              style={{
                color: "rgba(0,0,0,0.36)",
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid rgba(0,0,0,0.10)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Sign out
            </button>
          </div>
        )}
        <div className="text-xs" style={{ color: "rgba(0,0,0,0.28)" }}>
          Ledge v0.1.0
        </div>
      </div>
    </aside>
  );
}

// ── Icons (20px, refined strokes) ────────────────────────────────

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

function KeysIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="12.5" r="3.5" />
      <path d="M10.5 9.5L15.5 4.5" />
      <path d="M13.5 4.5h2v2" />
    </svg>
  );
}

function McpIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 5.5l-3.5 4.5 3.5 4.5" />
      <path d="M14.5 5.5l3.5 4.5-3.5 4.5" />
      <path d="M11 3l-2 14" />
    </svg>
  );
}

function BillingIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? "#3B82F6" : "rgba(0,0,0,0.36)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <path d="M2 8h16" />
      <path d="M6 12h3" />
    </svg>
  );
}

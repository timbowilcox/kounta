"use client";

import { useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { updateUserNameAction } from "@/lib/actions";

/**
 * Modal shown after sign-in when the user's name is missing or is a fallback.
 * Captures first name and last name, saves to the users table.
 */
export function NameCaptureModal() {
  const { data: session, update } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  // Don't show if we already have a real name, or if dismissed
  if (dismissed) return null;
  if (!session?.user) return null;

  const currentName = session.user.name ?? "";
  const isFallbackName =
    !currentName ||
    currentName === "Kounta User" ||
    currentName === session.user.email?.split("@")[0];

  if (!isFallbackName) return null;

  // Check localStorage to not re-show after dismiss
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("kounta_name_captured");
    if (stored) return null;
  }

  const handleSubmit = () => {
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    if (!fullName) return;

    startTransition(async () => {
      const ok = await updateUserNameAction(fullName);
      if (ok) {
        // Update the client session with the new name
        await update({ name: fullName });
        if (typeof window !== "undefined") {
          localStorage.setItem("kounta_name_captured", "true");
        }
        setDismissed(true);
        // Reload to refresh server components with the new name
        window.location.reload();
      }
    });
  };

  const handleSkip = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("kounta_name_captured", "true");
    }
    setDismissed(true);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        animation: "modal-fade-in 200ms ease",
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 12,
          padding: 32,
          width: 400,
          maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
          animation: "modal-slide-up 200ms ease",
        }}
      >
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "#0A0A0A",
            marginBottom: 4,
          }}
        >
          Welcome to Kounta!
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "#999999",
            marginBottom: 24,
          }}
        >
          What should we call you?
        </p>

        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: 12,
                color: "#999999",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontWeight: 500,
              }}
            >
              First name
            </label>
            <input
              className="input"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Tim"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && firstName.trim()) handleSubmit();
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: 12,
                color: "#999999",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontWeight: 500,
              }}
            >
              Last name
            </label>
            <input
              className="input"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Wilcox"
              onKeyDown={(e) => {
                if (e.key === "Enter" && firstName.trim()) handleSubmit();
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={handleSkip}
            className="btn-ghost"
            style={{
              border: "none",
              cursor: "pointer",
            }}
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            className="btn-primary"
            disabled={!firstName.trim() || isPending}
            style={{
              opacity: !firstName.trim() || isPending ? 0.5 : 1,
              cursor: !firstName.trim() || isPending ? "not-allowed" : "pointer",
            }}
          >
            {isPending ? "Saving..." : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

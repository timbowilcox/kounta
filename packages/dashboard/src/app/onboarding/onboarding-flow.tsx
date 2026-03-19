"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  createOnboardingState,
  updateOnboardingStateAction,
  executeOnboardingSetup,
  updateUserNameAction,
  updateLedgerAction,
} from "@/lib/actions";
import type { SetupResult } from "@/lib/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "about_you" | "business_type" | "business_details" | "setup" | "connect";

interface OnboardingData {
  firstName: string;
  lastName: string;
  companyName: string;
  businessType: string;
  currency: string;
  businessAge: string;
  paymentProcessor: string;
  bankSituation: string;
  businessStructure: string;
  country: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUSINESS_TYPES = [
  { value: "saas", label: "SaaS product", desc: "Subscription software, API, or platform" },
  { value: "freelance", label: "Freelance / consulting", desc: "Client work, services, or contracting" },
  { value: "ecommerce", label: "Ecommerce", desc: "Physical or digital product sales" },
  { value: "other", label: "Something else", desc: "Agency, marketplace, or other business" },
];

const BUSINESS_AGES = [
  { value: "just_started", label: "Just started" },
  { value: "under_year", label: "< 1 year" },
  { value: "one_to_three", label: "1-3 years" },
  { value: "three_plus", label: "3+ years" },
];

const PROCESSORS = [
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
  { value: "other", label: "Other" },
  { value: "none", label: "None yet" },
];

const BANK_SITUATIONS = [
  { value: "separate", label: "Separate business account" },
  { value: "mixed", label: "Mixed personal & business" },
  { value: "not_sure", label: "Not sure" },
];

const STRUCTURES = [
  { value: "sole_proprietor", label: "Sole proprietor" },
  { value: "llc", label: "LLC" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "not_incorporated", label: "Not incorporated" },
  { value: "au_pty_ltd", label: "Australian Pty Ltd" },
  { value: "au_sole_trader", label: "Australian Sole Trader" },
];

const CURRENCIES = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "NZD", label: "NZD — New Zealand Dollar" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
  { value: "JPY", label: "JPY — Japanese Yen" },
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "BRL", label: "BRL — Brazilian Real" },
];

const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Australia",
  "New Zealand", "Germany", "France", "Netherlands", "Singapore",
  "India", "Brazil", "Japan", "Ireland", "Sweden", "Other",
];

function detectCurrency(): string {
  if (typeof navigator === "undefined") return "USD";
  const lang = navigator.language || "en-US";
  const region = lang.split("-")[1]?.toUpperCase() ?? "";
  const map: Record<string, string> = {
    US: "USD", GB: "GBP", AU: "AUD", CA: "CAD", NZ: "NZD",
    SG: "SGD", JP: "JPY", IN: "INR", BR: "BRL", DE: "EUR",
    FR: "EUR", NL: "EUR", IE: "EUR", SE: "EUR",
  };
  return map[region] ?? "USD";
}

function detectCountry(): string {
  if (typeof navigator === "undefined") return "United States";
  const lang = navigator.language || "en-US";
  const region = lang.split("-")[1]?.toUpperCase() ?? "";
  const map: Record<string, string> = {
    US: "United States", GB: "United Kingdom", AU: "Australia",
    CA: "Canada", NZ: "New Zealand", SG: "Singapore", JP: "Japan",
    IN: "India", BR: "Brazil", DE: "Germany", FR: "France",
    NL: "Netherlands", IE: "Ireland", SE: "Sweden",
  };
  return map[region] ?? "United States";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OnboardingFlow() {
  const { data: session, update: updateSession } = useSession();
  const [step, setStep] = useState<Step>("about_you");
  const [data, setData] = useState<OnboardingData>({
    firstName: "",
    lastName: "",
    companyName: "",
    businessType: "",
    currency: "",
    businessAge: "",
    paymentProcessor: "",
    bankSituation: "",
    businessStructure: "",
    country: "",
  });
  const [setupSteps, setSetupSteps] = useState<string[]>([]);
  const [isSettingUp, setIsSettingUp] = useState(false);

  // Auto-detect locale and pre-fill name from OAuth profile
  useEffect(() => {
    const oauthName = session?.user?.name ?? "";
    const parts = oauthName.trim().split(/\s+/);
    const detectedFirst = parts[0] ?? "";
    const detectedLast = parts.slice(1).join(" ");

    setData((d) => ({
      ...d,
      firstName: d.firstName || detectedFirst,
      lastName: d.lastName || detectedLast,
      currency: d.currency || detectCurrency(),
      country: d.country || detectCountry(),
    }));
    createOnboardingState().catch(() => {});
  }, [session?.user?.name]);

  const stepIndex = ["about_you", "business_type", "business_details", "setup", "connect"].indexOf(step);

  // ----- Step 1: About You -----
  const handleAboutYouComplete = useCallback(() => {
    setStep("business_type");
  }, []);

  // ----- Step 2: Business Type -----
  const handleBusinessType = useCallback(async (type: string) => {
    setData((d) => ({ ...d, businessType: type }));
    await updateOnboardingStateAction({ businessType: type, completedSteps: ["about_you", "business_type"] as unknown as string[] }).catch(() => {});
    setStep("business_details");
  }, []);

  // ----- Step 3: Continue to setup -----
  const handleDetailsComplete = useCallback(async () => {
    await updateOnboardingStateAction({
      ...data,
      completedSteps: ["about_you", "business_type", "business_details"] as unknown as string[],
    }).catch(() => {});
    setStep("setup");
    setIsSettingUp(true);

    try {
      const result = await executeOnboardingSetup();
      if (result) {
        for (let i = 0; i < result.steps.length; i++) {
          await new Promise((r) => setTimeout(r, 400));
          setSetupSteps((prev) => [...prev, result.steps[i]]);
        }
      }

      // Save user display name and ledger (company) name
      const fullName = [data.firstName.trim(), data.lastName.trim()].filter(Boolean).join(" ");
      if (fullName) {
        await updateUserNameAction(fullName).catch(() => {});
      }
      if (data.companyName.trim()) {
        await updateLedgerAction({ name: data.companyName.trim() }).catch(() => {});
      }

      await updateSession({
        needsOnboarding: false,
        needsTemplate: false,
        ...(fullName ? { name: fullName } : {}),
      });
    } catch (e) {
      console.error("Setup failed:", e);
    }

    setIsSettingUp(false);
    setTimeout(() => setStep("connect"), 1200);
  }, [data, updateSession]);

  // ----- Step 4: Done -----
  const handleFinish = useCallback(() => {
    window.location.href = "/";
  }, []);

  return (
    <div className="onboarding-shell">
      {/* Header */}
      <header className="onboarding-header">
        <div className="onboarding-logo">
          <img src="/logo.svg" alt="Kounta" style={{ height: "1.32rem" }} />
        </div>
        <div className="onboarding-progress">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`onboarding-progress-dot ${i <= stepIndex ? "active" : ""}`}
              style={{ width: i <= stepIndex ? 20 : 6 }}
            />
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="onboarding-content page-content">
        {step === "about_you" && (
          <AboutYouStep
            data={data}
            onChange={(updates) => setData((d) => ({ ...d, ...updates }))}
            onContinue={handleAboutYouComplete}
          />
        )}
        {step === "business_type" && (
          <BusinessTypeStep onSelect={handleBusinessType} onBack={() => setStep("about_you")} />
        )}
        {step === "business_details" && (
          <BusinessDetailsStep
            data={data}
            onChange={(updates) => setData((d) => ({ ...d, ...updates }))}
            onBack={() => setStep("business_type")}
            onContinue={handleDetailsComplete}
          />
        )}
        {step === "setup" && (
          <SetupStep steps={setupSteps} isSettingUp={isSettingUp} />
        )}
        {step === "connect" && (
          <ConnectStep onSkip={handleFinish} />
        )}
      </div>

      <style>{`
        .onboarding-shell {
          min-height: 100vh;
          background: var(--background);
        }
        .onboarding-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem 2rem;
          border-bottom: 1px solid var(--border);
        }
        .onboarding-logo {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .onboarding-progress {
          display: flex;
          gap: 0.375rem;
          align-items: center;
        }
        .onboarding-progress-dot {
          height: 6px;
          border-radius: 3px;
          background: var(--border);
          transition: all 300ms var(--ease-out);
        }
        .onboarding-progress-dot.active {
          background: var(--accent);
        }
        .onboarding-content {
          max-width: 32rem;
          margin: 0 auto;
          padding: 3rem 1.5rem;
        }

        /* Business type cards */
        .ob-type-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.25rem;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border);
          background: var(--surface-1);
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 150ms ease;
        }
        .ob-type-card:hover {
          border-color: var(--accent);
          background: var(--surface-2);
        }
        .ob-type-card-label {
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--text-primary);
        }
        .ob-type-card-desc {
          font-size: 0.75rem;
          color: var(--text-tertiary);
          margin-top: 0.125rem;
        }

        /* Segmented buttons */
        .ob-seg-group {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .ob-seg-btn {
          padding: 0.375rem 0.75rem;
          border-radius: var(--radius-md);
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text-secondary);
          font-size: 0.75rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 150ms ease;
          white-space: nowrap;
          font-family: var(--font-sans);
        }
        .ob-seg-btn:hover {
          border-color: var(--border-strong);
          color: var(--text-primary);
        }
        .ob-seg-btn.selected {
          border-color: var(--accent);
          background: rgba(235, 228, 220, 0.08);
          color: var(--accent);
        }

        /* Text input */
        .ob-input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: var(--radius-md);
          border: 1px solid var(--border);
          background: var(--surface-1);
          color: var(--text-primary);
          font-size: 0.8125rem;
          font-family: var(--font-sans);
          outline: none;
          height: 2.25rem;
          transition: border-color 150ms ease;
        }
        .ob-input::placeholder {
          color: var(--text-disabled);
        }
        .ob-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(235, 228, 220, 0.1);
        }

        /* Select */
        .ob-select {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: var(--radius-md);
          border: 1px solid var(--border);
          background: var(--surface-1);
          color: var(--text-primary);
          font-size: 0.8125rem;
          font-family: var(--font-sans);
          outline: none;
          cursor: pointer;
          height: 2.25rem;
          transition: border-color 150ms ease;
          appearance: auto;
        }
        .ob-select option {
          background: var(--surface-2);
          color: var(--text-primary);
        }
        .ob-select:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(235, 228, 220, 0.1);
        }

        /* Field label */
        .ob-label {
          font-size: 0.6875rem;
          font-weight: 500;
          color: var(--text-tertiary);
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        /* Setup checklist */
        .ob-check-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.8125rem;
          color: var(--text-primary);
          animation: fadeIn 200ms var(--ease-out);
        }
        .ob-check-icon {
          color: var(--positive);
          font-size: 0.875rem;
          font-weight: 700;
          width: 1.25rem;
          text-align: center;
          flex-shrink: 0;
        }
        .ob-spinner {
          width: 0.875rem;
          height: 0.875rem;
          border-radius: 50%;
          border: 2px solid var(--border);
          border-top-color: var(--accent);
          animation: ob-spin 600ms linear infinite;
          flex-shrink: 0;
          margin-left: 0.1875rem;
        }

        @keyframes ob-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: About You
// ---------------------------------------------------------------------------

function AboutYouStep({
  data,
  onChange,
  onContinue,
}: {
  data: OnboardingData;
  onChange: (updates: Partial<OnboardingData>) => void;
  onContinue: () => void;
}) {
  const isValid = data.firstName.trim().length > 0 && data.companyName.trim().length > 0;

  return (
    <div>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.375rem" }}>
        Welcome to Kounta
      </h1>
      <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
        Let&apos;s set up your books in about 3 minutes.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <div style={{ flex: 1 }}>
            <Field label="First name">
              <input
                type="text"
                value={data.firstName}
                onChange={(e) => onChange({ firstName: e.target.value })}
                placeholder="Jane"
                className="ob-input"
                autoFocus
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Last name">
              <input
                type="text"
                value={data.lastName}
                onChange={(e) => onChange({ lastName: e.target.value })}
                placeholder="Smith"
                className="ob-input"
              />
            </Field>
          </div>
        </div>

        <Field label="Company name">
          <input
            type="text"
            value={data.companyName}
            onChange={(e) => onChange({ companyName: e.target.value })}
            placeholder="Acme Inc."
            className="ob-input"
          />
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "2rem" }}>
        <button
          onClick={onContinue}
          disabled={!isValid}
          className="btn-primary"
          style={{
            opacity: isValid ? 1 : 0.4,
            cursor: isValid ? "pointer" : "not-allowed",
          }}
        >
          Continue &rarr;
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Business Type
// ---------------------------------------------------------------------------

function BusinessTypeStep({ onSelect, onBack }: { onSelect: (type: string) => void; onBack: () => void }) {
  return (
    <div>
      <h1 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.375rem" }}>
        What kind of business?
      </h1>
      <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)", marginBottom: "1.5rem" }}>
        We&apos;ll set up your chart of accounts and categories to match.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {BUSINESS_TYPES.map((bt) => (
          <button
            key={bt.value}
            onClick={() => onSelect(bt.value)}
            className="ob-type-card"
          >
            <div>
              <div className="ob-type-card-label">{bt.label}</div>
              <div className="ob-type-card-desc">{bt.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <button onClick={onBack} className="btn-ghost">
          &larr; Back
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Business Details
// ---------------------------------------------------------------------------

function BusinessDetailsStep({
  data,
  onChange,
  onBack,
  onContinue,
}: {
  data: OnboardingData;
  onChange: (updates: Partial<OnboardingData>) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const isValid =
    data.currency &&
    data.businessAge &&
    data.paymentProcessor &&
    data.bankSituation &&
    data.businessStructure &&
    data.country;

  return (
    <div>
      <h1 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.375rem" }}>
        A few quick details
      </h1>
      <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "1.5rem" }}>
        All fields required to configure your books correctly.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <Field label="Currency">
          <select
            value={data.currency}
            onChange={(e) => onChange({ currency: e.target.value })}
            className="ob-select"
          >
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>

        <Field label="How long running?">
          <SegmentedButtons
            options={BUSINESS_AGES}
            value={data.businessAge}
            onChange={(v) => onChange({ businessAge: v })}
          />
        </Field>

        <Field label="Payment processor">
          <SegmentedButtons
            options={PROCESSORS}
            value={data.paymentProcessor}
            onChange={(v) => onChange({ paymentProcessor: v })}
          />
        </Field>

        <Field label="Bank situation">
          <SegmentedButtons
            options={BANK_SITUATIONS}
            value={data.bankSituation}
            onChange={(v) => onChange({ bankSituation: v })}
          />
        </Field>

        <Field label="Business structure">
          <SegmentedButtons
            options={STRUCTURES}
            value={data.businessStructure}
            onChange={(v) => onChange({ businessStructure: v })}
            wrap
          />
        </Field>

        <Field label="Country">
          <select
            value={data.country}
            onChange={(e) => onChange({ country: e.target.value })}
            className="ob-select"
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2rem" }}>
        <button onClick={onBack} className="btn-ghost">
          &larr; Back
        </button>
        <button
          onClick={onContinue}
          disabled={!isValid}
          className="btn-primary"
          style={{
            opacity: isValid ? 1 : 0.4,
            cursor: isValid ? "pointer" : "not-allowed",
          }}
        >
          Continue &rarr;
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Setting Up (automated)
// ---------------------------------------------------------------------------

function SetupStep({
  steps,
  isSettingUp,
}: {
  steps: string[];
  isSettingUp: boolean;
}) {
  return (
    <div style={{ paddingTop: "2rem" }}>
      <h1 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.375rem" }}>
        Setting up your books
      </h1>
      <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)", marginBottom: "2rem" }}>
        This only takes a moment...
      </p>

      <div
        className="card"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.875rem",
          padding: "1.25rem 1.5rem",
        }}
      >
        {steps.map((s, i) => (
          <div key={i} className="ob-check-item">
            <span className="ob-check-icon">&#10003;</span>
            {s}
          </div>
        ))}
        {isSettingUp && (
          <div className="ob-check-item" style={{ color: "var(--text-tertiary)" }}>
            <span className="ob-spinner" />
            Processing...
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Connect Money
// ---------------------------------------------------------------------------

function ConnectStep({ onSkip }: { onSkip: () => void }) {
  return (
    <div style={{ paddingTop: "2rem" }}>
      <h1 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.375rem" }}>
        Connect your money
      </h1>
      <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)", marginBottom: "1.5rem" }}>
        Connect your bank account to automatically import and classify transactions.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "22rem" }}>
        <button
          onClick={() => (window.location.href = "/bank-feeds")}
          className="btn-primary"
          style={{ height: "2.5rem", justifyContent: "center" }}
        >
          Connect bank account &rarr;
        </button>

        <button
          onClick={() => (window.location.href = "/settings?tab=connections")}
          className="btn-secondary"
          style={{ height: "2.5rem", justifyContent: "center" }}
        >
          Connect Stripe &rarr;
        </button>

        <button
          onClick={onSkip}
          className="btn-ghost"
          style={{ marginTop: "0.25rem", justifyContent: "center" }}
        >
          Skip for now &rarr;
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="ob-label">{label}</div>
      {children}
    </div>
  );
}

function SegmentedButtons({
  options,
  value,
  onChange,
  wrap,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  wrap?: boolean;
}) {
  return (
    <div className="ob-seg-group" style={wrap ? undefined : { flexWrap: "nowrap" }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`ob-seg-btn ${value === opt.value ? "selected" : ""}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

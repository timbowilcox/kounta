"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createOnboardingState,
  updateOnboardingStateAction,
  executeOnboardingSetup,
} from "@/lib/actions";
import type { SetupResult } from "@/lib/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "business_type" | "business_details" | "setup" | "connect";

interface OnboardingData {
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
  { value: "saas", label: "I'm building a SaaS product", icon: "💻" },
  { value: "freelance", label: "I freelance or consult", icon: "🎯" },
  { value: "ecommerce", label: "I run an ecommerce store", icon: "🛍️" },
  { value: "other", label: "Something else", icon: "✨" },
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
  const [step, setStep] = useState<Step>("business_type");
  const [data, setData] = useState<OnboardingData>({
    businessType: "",
    currency: "",
    businessAge: "",
    paymentProcessor: "",
    bankSituation: "",
    businessStructure: "",
    country: "",
  });
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
  const [setupSteps, setSetupSteps] = useState<string[]>([]);
  const [isSettingUp, setIsSettingUp] = useState(false);

  // Auto-detect locale on mount
  useEffect(() => {
    setData((d) => ({
      ...d,
      currency: d.currency || detectCurrency(),
      country: d.country || detectCountry(),
    }));
    // Initialize onboarding state on the server
    createOnboardingState().catch(() => {});
  }, []);

  const stepIndex = ["business_type", "business_details", "setup", "connect"].indexOf(step);

  // ----- Step 1: Business Type -----
  const handleBusinessType = useCallback(async (type: string) => {
    setData((d) => ({ ...d, businessType: type }));
    await updateOnboardingStateAction({ businessType: type, completedSteps: ["business_type"] as unknown as string[] }).catch(() => {});
    setStep("business_details");
  }, []);

  // ----- Step 2: Continue to setup -----
  const handleDetailsComplete = useCallback(async () => {
    await updateOnboardingStateAction({
      ...data,
      completedSteps: ["business_type", "business_details"] as unknown as string[],
    }).catch(() => {});
    setStep("setup");
    setIsSettingUp(true);

    // Execute the setup
    try {
      const result = await executeOnboardingSetup();
      if (result) {
        setSetupResult(result);
        // Animate steps appearing
        for (let i = 0; i < result.steps.length; i++) {
          await new Promise((r) => setTimeout(r, 400));
          setSetupSteps((prev) => [...prev, result.steps[i]]);
        }
      }
    } catch (e) {
      console.error("Setup failed:", e);
    }

    setIsSettingUp(false);
    // Auto-advance after a brief pause
    setTimeout(() => setStep("connect"), 1200);
  }, [data]);

  // ----- Step 4: Done -----
  const handleFinish = useCallback(() => {
    window.location.href = "/";
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#FAFAFA",
        fontFamily: "var(--font-family-body, 'Geist', system-ui, sans-serif)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "24px 32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#0066FF" />
            <path d="M7 8h10M7 12h7M7 16h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#0A0A0A" }}>Kounta</span>
        </div>
        {/* Progress indicator */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                width: i <= stepIndex ? 24 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i <= stepIndex ? "#0066FF" : "#E5E5E5",
                transition: "all 300ms ease",
              }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "40px 24px",
        }}
      >
        {step === "business_type" && (
          <BusinessTypeStep onSelect={handleBusinessType} />
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
          <SetupStep steps={setupSteps} isSettingUp={isSettingUp} businessType={data.businessType} />
        )}
        {step === "connect" && (
          <ConnectStep onSkip={handleFinish} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Business Type
// ---------------------------------------------------------------------------

function BusinessTypeStep({ onSelect }: { onSelect: (type: string) => void }) {
  return (
    <div>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#0A0A0A",
          marginBottom: 8,
          lineHeight: 1.3,
        }}
      >
        Welcome to Kounta.
      </h1>
      <p style={{ fontSize: 16, color: "#666666", marginBottom: 8 }}>
        Let&apos;s set up your books in about 3 minutes.
      </p>
      <p style={{ fontSize: 15, color: "#999999", marginBottom: 36 }}>
        What kind of business are you running?
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {BUSINESS_TYPES.map((bt) => (
          <button
            key={bt.value}
            onClick={() => onSelect(bt.value)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "20px 24px",
              borderRadius: 12,
              border: "1px solid #E5E5E5",
              backgroundColor: "#FFFFFF",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 15,
              fontWeight: 500,
              color: "#0A0A0A",
              transition: "all 200ms ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = "#0066FF";
              e.currentTarget.style.backgroundColor = "#F0F6FF";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = "#E5E5E5";
              e.currentTarget.style.backgroundColor = "#FFFFFF";
            }}
          >
            <span style={{ fontSize: 24, width: 40, textAlign: "center" }}>{bt.icon}</span>
            {bt.label}
          </button>
        ))}
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
      <h1
        style={{ fontSize: 24, fontWeight: 700, color: "#0A0A0A", marginBottom: 8 }}
      >
        A few quick details:
      </h1>
      <p style={{ fontSize: 14, color: "#999999", marginBottom: 32 }}>
        All fields are required to configure your books correctly.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {/* Currency */}
        <Field label="Currency">
          <select
            value={data.currency}
            onChange={(e) => onChange({ currency: e.target.value })}
            style={selectStyle}
          >
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>

        {/* Business age */}
        <Field label="How long running?">
          <SegmentedButtons
            options={BUSINESS_AGES}
            value={data.businessAge}
            onChange={(v) => onChange({ businessAge: v })}
          />
        </Field>

        {/* Payment processor */}
        <Field label="Payment processor">
          <SegmentedButtons
            options={PROCESSORS}
            value={data.paymentProcessor}
            onChange={(v) => onChange({ paymentProcessor: v })}
          />
        </Field>

        {/* Bank situation */}
        <Field label="Bank situation">
          <SegmentedButtons
            options={BANK_SITUATIONS}
            value={data.bankSituation}
            onChange={(v) => onChange({ bankSituation: v })}
          />
        </Field>

        {/* Business structure */}
        <Field label="Business structure">
          <SegmentedButtons
            options={STRUCTURES}
            value={data.businessStructure}
            onChange={(v) => onChange({ businessStructure: v })}
            wrap
          />
        </Field>

        {/* Country */}
        <Field label="Country">
          <select
            value={data.country}
            onChange={(e) => onChange({ country: e.target.value })}
            style={selectStyle}
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
        <button onClick={onBack} style={ghostButtonStyle}>
          &larr; Back
        </button>
        <button
          onClick={onContinue}
          disabled={!isValid}
          style={{
            ...primaryButtonStyle,
            opacity: isValid ? 1 : 0.5,
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
  businessType,
}: {
  steps: string[];
  isSettingUp: boolean;
  businessType: string;
}) {
  return (
    <div style={{ textAlign: "center", paddingTop: 40 }}>
      <h1
        style={{ fontSize: 24, fontWeight: 700, color: "#0A0A0A", marginBottom: 8 }}
      >
        Setting up your books
      </h1>
      <p style={{ fontSize: 14, color: "#999999", marginBottom: 40 }}>
        This only takes a moment...
      </p>

      <div
        style={{
          maxWidth: 440,
          margin: "0 auto",
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {steps.map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 14,
              color: "#0A0A0A",
              animation: "fadeSlideIn 300ms ease forwards",
            }}
          >
            <span style={{ color: "#22C55E", fontSize: 18, fontWeight: 700 }}>✓</span>
            {s}
          </div>
        ))}
        {isSettingUp && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 14,
              color: "#999999",
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: "2px solid #E5E5E5",
                borderTopColor: "#0066FF",
                animation: "spin 600ms linear infinite",
                display: "inline-block",
              }}
            />
            Processing...
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Connect Money
// ---------------------------------------------------------------------------

function ConnectStep({ onSkip }: { onSkip: () => void }) {
  return (
    <div style={{ textAlign: "center", paddingTop: 40 }}>
      <h1
        style={{ fontSize: 24, fontWeight: 700, color: "#0A0A0A", marginBottom: 8 }}
      >
        Now let&apos;s connect your money.
      </h1>
      <p style={{ fontSize: 14, color: "#999999", marginBottom: 40 }}>
        Connect your bank account to automatically import and classify transactions.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360, margin: "0 auto" }}>
        <button
          onClick={() => (window.location.href = "/bank-feeds")}
          style={primaryButtonStyle}
        >
          Connect bank account &rarr;
        </button>

        <button
          onClick={() => (window.location.href = "/settings?tab=connections")}
          style={secondaryButtonStyle}
        >
          Connect Stripe &rarr;
        </button>

        <button
          onClick={onSkip}
          style={{
            ...ghostButtonStyle,
            marginTop: 8,
          }}
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
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "#666666",
          marginBottom: 8,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {label}
      </div>
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
    <div
      style={{
        display: "flex",
        flexWrap: wrap ? "wrap" : "nowrap",
        gap: 8,
      }}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: `1px solid ${selected ? "#0066FF" : "#E5E5E5"}`,
              backgroundColor: selected ? "#F0F6FF" : "#FFFFFF",
              color: selected ? "#0066FF" : "#0A0A0A",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 150ms ease",
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const primaryButtonStyle: React.CSSProperties = {
  padding: "12px 24px",
  borderRadius: 10,
  border: "none",
  backgroundColor: "#0066FF",
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 200ms ease",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "12px 24px",
  borderRadius: 10,
  border: "1px solid #E5E5E5",
  backgroundColor: "#FFFFFF",
  color: "#0A0A0A",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  transition: "all 200ms ease",
  position: "relative",
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  backgroundColor: "transparent",
  color: "#999999",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #E5E5E5",
  backgroundColor: "#FFFFFF",
  color: "#0A0A0A",
  fontSize: 14,
  outline: "none",
  cursor: "pointer",
  appearance: "auto",
};

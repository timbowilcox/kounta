"use client";

import { useRouter } from "next/navigation";
import type { Template } from "@kounta/sdk";
import { applyTemplateAction } from "@/lib/actions";

export function TemplatesGrid({ templates }: { templates: Template[] }) {
  const router = useRouter();

  const handleSelect = async (slug: string) => {
    try {
      await applyTemplateAction(slug);
    } catch (err) {
      console.error("Failed to apply template:", err);
    }
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen flex flex-col items-center" style={{ padding: "64px 24px" }}>
      <div className="w-full" style={{ maxWidth: 720 }}>
        <h1
          className="font-bold"
          style={{
            fontSize: 28,
            color: "#0A0A0A",
            marginBottom: 8,
            fontFamily: "var(--font-family-display)",
          }}
        >
          Choose a starting point
        </h1>
        <p className="text-sm" style={{ color: "rgba(0,0,0,0.55)", marginBottom: 40 }}>
          Pick the template closest to your business. You can customise everything later.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16 }}>
          {templates.map((t) => (
            <button
              key={t.slug}
              onClick={() => handleSelect(t.slug)}
              className="card text-left cursor-pointer"
              style={{
                transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <h2
                className="font-bold"
                style={{ fontSize: 18, marginBottom: 8, fontFamily: "var(--font-family-display)" }}
              >
                {t.name}
              </h2>
              <p className="text-sm" style={{ color: "rgba(0,0,0,0.55)", marginBottom: 16, lineHeight: 1.6 }}>
                {t.description}
              </p>
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                <span
                  className="text-xs"
                  style={{
                    padding: "3px 10px",
                    borderRadius: 9999,
                    backgroundColor: "rgba(59,130,246,0.1)",
                    color: "#3B82F6",
                    border: "1px solid rgba(59,130,246,0.3)",
                  }}
                >
                  {t.businessType}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="text-center" style={{ marginTop: 36 }}>
          <button
            onClick={() => router.push("/")}
            className="btn-ghost text-sm"
          >
            Skip \u2014 I&apos;ll configure manually
          </button>
        </div>
      </div>
    </div>
  );
}

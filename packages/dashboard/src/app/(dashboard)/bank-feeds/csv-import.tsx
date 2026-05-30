"use client";

// ---------------------------------------------------------------------------
// Manual CSV import UI. Renders the column-mapping form and a preview, then
// commits via the API. NO parsing/normalisation happens here — the file text
// and the mapping are sent to the API; core does all the work and returns the
// parsed/deduped preview.
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { CsvMapping, CsvImportPreview, CsvImportResult, MappingProfile } from "@kounta/sdk";
import {
  previewCsvImport,
  commitCsvImport,
  fetchMappingProfiles,
  saveMappingProfile,
} from "@/lib/actions";

interface LedgerAccountOption {
  id: string;
  name: string;
  code: string;
}

// Dependency-injection seam: defaults to the real server actions, but lets a
// demo/test render the component with stubbed data (no session required).
export interface CsvImportApi {
  preview: (ledgerAccountId: string, fileContent: string, mapping: CsvMapping) => Promise<CsvImportPreview>;
  commit: (ledgerAccountId: string, fileContent: string, mapping: CsvMapping, filename?: string, decisions?: Record<string, "import" | "skip">) => Promise<CsvImportResult>;
  listProfiles: () => Promise<MappingProfile[]>;
  saveProfile: (name: string, mapping: CsvMapping) => Promise<MappingProfile>;
}

const defaultApi: CsvImportApi = {
  preview: previewCsvImport,
  commit: commitCsvImport,
  listProfiles: fetchMappingProfiles,
  saveProfile: saveMappingProfile,
};

interface CsvImportProps {
  accounts: LedgerAccountOption[];
  api?: CsvImportApi;
}

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY"] as const;

// Default, schema-valid mapping so the first preview returns headers even
// before the user has chosen columns.
const defaultMapping = (): CsvMapping =>
  ({
    hasHeader: true,
    dateColumn: 0,
    dateFormat: "DD/MM/YYYY",
    descriptionColumn: 1,
    amountMode: "signed",
    amountColumn: 2,
    signConvention: "negative_is_outflow",
  }) as CsvMapping;

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 4,
  display: "block",
};

const controlStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "0 16px",
  height: 34,
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  background: disabled ? "var(--surface-3)" : "var(--accent)",
  color: disabled ? "var(--text-tertiary)" : "var(--accent-contrast, #fff)",
  border: "none",
  cursor: disabled ? "not-allowed" : "pointer",
});

function formatCents(amount: number, type: string): string {
  const dollars = (amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${type === "debit" ? "−" : "+"}${dollars}`;
}

export function CsvImport({ accounts, api = defaultApi }: CsvImportProps) {
  const [open, setOpen] = useState(false);
  const [ledgerAccountId, setLedgerAccountId] = useState(accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>(defaultMapping());
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);

  const [profiles, setProfiles] = useState<MappingProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  // Per-row decisions for possible_duplicate rows (dedupKey -> import).
  const [importAnyway, setImportAnyway] = useState<Record<string, boolean>>({});

  const headers = preview?.headers ?? [];
  const chosenCount = preview ? preview.rows.filter((r) => r.dedupStatus === "possible_duplicate" && importAnyway[r.dedupKey]).length : 0;
  const importableCount = (preview?.newCount ?? 0) + chosenCount;

  const setMap = (patch: Partial<CsvMapping>) =>
    setMapping((m) => ({ ...m, ...patch }) as CsvMapping);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setFileContent(text);
    setResult(null);
    setError(null);
    await runPreview(text, mapping);
    if (profiles.length === 0) {
      try {
        setProfiles(await api.listProfiles());
      } catch {
        /* profiles are optional */
      }
    }
  }

  async function runPreview(content: string | null, m: CsvMapping) {
    if (!content || !ledgerAccountId) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.preview(ledgerAccountId, content, m));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!fileContent || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const decisions: Record<string, "import" | "skip"> = {};
      for (const [key, on] of Object.entries(importAnyway)) {
        if (on) decisions[key] = "import";
      }
      const res = await api.commit(ledgerAccountId, fileContent, mapping, fileName ?? undefined, decisions);
      setResult(res);
      setPreview(null);
      setFileContent(null);
      setFileName(null);
      setImportAnyway({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveProfile() {
    if (!profileName.trim()) return;
    setBusy(true);
    try {
      const saved = await api.saveProfile(profileName.trim(), mapping);
      setProfiles((p) => [...p.filter((x) => x.id !== saved.id), saved]);
      setProfileName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  function onLoadProfile(id: string) {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setMapping(profile.mapping);
    void runPreview(fileContent, profile.mapping);
  }

  const HeaderSelect = ({
    value,
    onChange,
    allowNone,
  }: {
    value: number | null | undefined;
    onChange: (v: number | null) => void;
    allowNone?: boolean;
  }) => (
    <select
      style={controlStyle}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      {allowNone && <option value="">— none —</option>}
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {h || `Column ${i + 1}`}
        </option>
      ))}
    </select>
  );

  if (!open) {
    return (
      <div style={{ marginTop: 32 }}>
        <button onClick={() => setOpen(true)} style={primaryBtn(false)}>
          Import CSV
        </button>
        {result && (
          <span className="text-sm" style={{ marginLeft: 12, color: "var(--text-secondary)" }}>
            Imported {result.imported} · {result.duplicates} duplicates skipped · {result.errors.length} errors
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 32, padding: 20 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div className="section-label">Import CSV</div>
        <button
          onClick={() => setOpen(false)}
          style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 13 }}
        >
          Close
        </button>
      </div>

      {/* Step 1 — account + file */}
      <div className="flex" style={{ gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 220 }}>
          <label style={labelStyle}>Ledger account</label>
          <select
            style={controlStyle}
            value={ledgerAccountId}
            onChange={(e) => {
              setLedgerAccountId(e.target.value);
              void runPreview(fileContent, mapping);
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label style={labelStyle}>CSV file</label>
          <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ ...controlStyle, paddingTop: 5 }} />
        </div>
      </div>

      {error && (
        <div
          className="text-sm"
          style={{ color: "var(--danger, #c0392b)", background: "var(--surface-2)", padding: 10, borderRadius: 6, marginBottom: 16 }}
        >
          {error}
        </div>
      )}

      {/* Step 2 — mapping controls */}
      {headers.length > 0 && (
        <>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}
          >
            <div>
              <label style={labelStyle}>Date column</label>
              <HeaderSelect value={mapping.dateColumn} onChange={(v) => setMap({ dateColumn: v ?? 0 })} />
            </div>
            <div>
              <label style={labelStyle}>Date format</label>
              <select style={controlStyle} value={mapping.dateFormat} onChange={(e) => setMap({ dateFormat: e.target.value as CsvMapping["dateFormat"] })}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Description column</label>
              <HeaderSelect value={mapping.descriptionColumn} onChange={(v) => setMap({ descriptionColumn: v ?? 0 })} />
            </div>
            <div>
              <label style={labelStyle}>Amount mode</label>
              <select
                style={controlStyle}
                value={mapping.amountMode}
                onChange={(e) => setMap({ amountMode: e.target.value as CsvMapping["amountMode"] })}
              >
                <option value="signed">Single signed column</option>
                <option value="debit_credit">Separate debit / credit</option>
              </select>
            </div>

            {mapping.amountMode === "signed" ? (
              <>
                <div>
                  <label style={labelStyle}>Amount column</label>
                  <HeaderSelect value={mapping.amountColumn} onChange={(v) => setMap({ amountColumn: v ?? 0 })} />
                </div>
                <div>
                  <label style={labelStyle}>Money out is…</label>
                  <select
                    style={controlStyle}
                    value={mapping.signConvention}
                    onChange={(e) => setMap({ signConvention: e.target.value as CsvMapping["signConvention"] })}
                  >
                    <option value="negative_is_outflow">Negative amounts</option>
                    <option value="positive_is_outflow">Positive amounts</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label style={labelStyle}>Debit (money out) column</label>
                  <HeaderSelect value={mapping.debitColumn} onChange={(v) => setMap({ debitColumn: v ?? undefined })} allowNone />
                </div>
                <div>
                  <label style={labelStyle}>Credit (money in) column</label>
                  <HeaderSelect value={mapping.creditColumn} onChange={(v) => setMap({ creditColumn: v ?? undefined })} allowNone />
                </div>
              </>
            )}

            <div>
              <label style={labelStyle}>Reference column (opt.)</label>
              <HeaderSelect value={mapping.referenceColumn} onChange={(v) => setMap({ referenceColumn: v })} allowNone />
            </div>
            <div>
              <label style={labelStyle}>Balance column (opt.)</label>
              <HeaderSelect value={mapping.balanceColumn} onChange={(v) => setMap({ balanceColumn: v })} allowNone />
            </div>
            <div>
              <label style={labelStyle}>Currency (fallback)</label>
              <input
                style={controlStyle}
                value={mapping.currency ?? ""}
                maxLength={3}
                placeholder="AUD"
                onChange={(e) => setMap({ currency: e.target.value.toUpperCase() || undefined })}
              />
            </div>
          </div>

          <div className="flex items-center" style={{ gap: 8, marginBottom: 20 }}>
            <button onClick={() => runPreview(fileContent, mapping)} style={primaryBtn(busy)} disabled={busy}>
              {busy ? "Working…" : "Preview"}
            </button>
            {/* Mapping profiles */}
            {profiles.length > 0 && (
              <select style={{ ...controlStyle, width: 200 }} defaultValue="" onChange={(e) => e.target.value && onLoadProfile(e.target.value)}>
                <option value="">Load saved mapping…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <input
              style={{ ...controlStyle, width: 160 }}
              placeholder="Save mapping as…"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
            <button onClick={onSaveProfile} disabled={busy || !profileName.trim()} style={{ ...controlStyle, width: "auto", padding: "0 12px", cursor: "pointer" }}>
              Save
            </button>
          </div>
        </>
      )}

      {/* Step 3 — preview */}
      {preview && (
        <>
          <div className="flex" style={{ gap: 16, marginBottom: 12 }}>
            <Stat label="New rows" value={preview.newCount} tone="ok" />
            <Stat label="Possible duplicates" value={preview.possibleDuplicateCount} tone={preview.possibleDuplicateCount > 0 ? "warn" : "muted"} />
            <Stat label="Duplicates" value={preview.duplicateCount} tone="muted" />
            <Stat label="Errors" value={preview.errorCount} tone={preview.errorCount > 0 ? "danger" : "muted"} />
          </div>

          {preview.possibleDuplicateCount > 0 && (
            <div className="text-xs" style={{ color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
              Rows marked <strong>Possible duplicate</strong> share a date and amount with an existing bank-feed
              transaction but have a different description. They are <strong>held</strong> by default to avoid
              double-counting — tick “Import anyway” for any that are genuinely separate.
            </div>
          )}

          <div className="card" style={{ padding: 0, marginBottom: 16, maxHeight: 320, overflow: "auto" }}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header" style={{ width: 110 }}>Date</th>
                  <th className="table-header">Description</th>
                  <th className="table-header text-right" style={{ width: 130 }}>Amount</th>
                  <th className="table-header text-right" style={{ width: 200 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => {
                  const isPossible = r.dedupStatus === "possible_duplicate";
                  const isDup = r.dedupStatus === "duplicate";
                  const chosen = !!importAnyway[r.dedupKey];
                  const dimmed = isDup || (isPossible && !chosen);
                  return (
                    <tr key={i} className="table-row" style={{ opacity: dimmed ? 0.5 : 1 }} title={r.dedupReason}>
                      <td className="table-cell font-mono" style={{ fontSize: 13, color: "var(--text-secondary)" }}>{r.date}</td>
                      <td className="table-cell" style={{ fontSize: 13, color: "var(--text-primary)" }}>{r.description}</td>
                      <td className="table-cell text-right font-mono" style={{ fontSize: 13, color: r.type === "debit" ? "var(--text-primary)" : "var(--success, #1a7f4b)" }}>
                        {formatCents(r.amount, r.type)}
                      </td>
                      <td className="table-cell text-right">
                        {isPossible ? (
                          <label className="text-xs" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                            <span className="badge-amber">Possible duplicate</span>
                            <input
                              type="checkbox"
                              checked={chosen}
                              onChange={(e) => setImportAnyway((m) => ({ ...m, [r.dedupKey]: e.target.checked }))}
                            />
                            <span style={{ color: "var(--text-tertiary)" }}>import anyway</span>
                          </label>
                        ) : (
                          <span className={isDup ? "badge-amber" : "badge-green"}>{isDup ? "Duplicate" : "New"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.errors.length > 0 && (
            <div className="card" style={{ padding: 12, marginBottom: 16, background: "var(--surface-2)" }}>
              <div className="section-label" style={{ marginBottom: 8 }}>
                {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} could not be parsed (not imported)
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {preview.errors.slice(0, 10).map((er, i) => (
                  <li key={i} className="text-xs font-mono" style={{ color: "var(--text-tertiary)", marginBottom: 2 }}>
                    row {er.rowIndex + 1}: {er.reason} — [{er.raw.join(", ").slice(0, 80)}]
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={onCommit} disabled={busy || importableCount === 0} style={primaryBtn(busy || importableCount === 0)}>
            {busy ? "Importing…" : `Import ${importableCount} row${importableCount === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      {result && (
        <div className="text-sm" style={{ marginTop: 12, color: "var(--text-secondary)" }}>
          Imported {result.imported} · {result.duplicates} duplicates skipped
          {result.possibleDuplicates > 0 ? ` · ${result.possibleDuplicates} possible duplicates held` : ""} · {result.errors.length} errors.
          They are now in the pending bank-transaction queue.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "muted" | "danger" | "warn" }) {
  const color =
    tone === "ok" ? "var(--success, #1a7f4b)" :
    tone === "danger" ? "var(--danger, #c0392b)" :
    tone === "warn" ? "var(--warning, #b7791f)" :
    "var(--text-tertiary)";
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "var(--font-family-display)" }}>{value}</div>
      <div style={labelStyle}>{label}</div>
    </div>
  );
}

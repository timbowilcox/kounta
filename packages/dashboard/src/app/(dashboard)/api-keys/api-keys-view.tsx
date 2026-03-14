"use client";

import { useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import { createApiKey, revokeApiKey, fetchApiKeys } from "@/lib/actions";
import { CopyButton } from "@/components/copy-button";
import type { ApiKeySafe } from "@kounta/sdk";

export function ApiKeysView({ initialKeys }: { initialKeys: ApiKeySafe[] }) {
  const [keys, setKeys] = useState<ApiKeySafe[]>(initialKeys);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    startTransition(async () => {
      const result = await createApiKey(newKeyName.trim());
      setCreatedKey(result.rawKey);
      setNewKeyName("");
      // Refresh the list
      const updated = await fetchApiKeys();
      setKeys(updated);
    });
  };

  const handleRevoke = (keyId: string) => {
    startTransition(async () => {
      await revokeApiKey(keyId);
      const updated = await fetchApiKeys();
      setKeys(updated);
      setConfirmRevoke(null);
    });
  };

  const envSnippet = createdKey
    ? "KOUNTA_API_KEY=" + createdKey + "\nKOUNTA_API_URL=" + (process.env.NEXT_PUBLIC_KOUNTA_API_URL ?? "http://localhost:3100")
    : "";

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 28 }}>
        <h1
          className="font-bold"
          style={{ fontSize: 24, color: "#0A0A0A", fontFamily: "var(--font-family-display)" }}
        >
          API Keys
        </h1>
        <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
          Create new key
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Name</th>
              <th className="table-header">Key</th>
              <th className="table-header">Created</th>
              <th className="table-header">Last Used</th>
              <th className="table-header text-right">Status</th>
              <th className="table-header text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="table-row">
                <td className="table-cell text-sm font-medium">{key.name}</td>
                <td className="table-cell font-mono text-xs" style={{ color: "#3B82F6" }}>{key.prefix}...</td>
                <td className="table-cell text-sm">{formatDate(key.createdAt)}</td>
                <td className="table-cell text-sm">{key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}</td>
                <td className="table-cell text-right">
                  <span className={"badge " + (key.status === "active" ? "badge-green" : "badge-red")}>{key.status}</span>
                </td>
                <td className="table-cell text-right">
                  {key.status === "active" && (
                    <>
                      {confirmRevoke === key.id ? (
                        <span className="flex items-center justify-end gap-2">
                          <span className="text-xs" style={{ color: "#DC2626" }}>Confirm?</span>
                          <button className="text-xs font-medium" style={{ color: "#DC2626", background: "none", border: "none", cursor: "pointer" }} onClick={() => handleRevoke(key.id)}>Yes</button>
                          <button className="btn-ghost text-xs" onClick={() => setConfirmRevoke(null)}>No</button>
                        </span>
                      ) : (
                        <button className="btn-ghost text-xs" onClick={() => setConfirmRevoke(key.id)}>Revoke</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="table-cell text-center text-sm" style={{ color: "rgba(0,0,0,0.36)", padding: 48 }}>
                  No API keys yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!createdKey) setShowCreateModal(false); }}
        >
          <div
            className="card"
            style={{ width: 500, padding: 36, transform: "translateY(-20px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {!createdKey ? (
              <>
                <h2
                  className="font-bold"
                  style={{ fontSize: 20, marginBottom: 20, fontFamily: "var(--font-family-display)" }}
                >
                  Create API Key
                </h2>
                <input
                  type="text"
                  className="input"
                  style={{ marginBottom: 20 }}
                  placeholder="Key name (e.g. Production)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
                <div className="flex justify-end" style={{ gap: 12 }}>
                  <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                  <button className="btn-primary" onClick={handleCreate} disabled={isPending}>
                    {isPending ? "Creating..." : "Create"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2
                  className="font-bold"
                  style={{ fontSize: 20, marginBottom: 8, fontFamily: "var(--font-family-display)" }}
                >
                  Key Created
                </h2>
                <p className="text-sm" style={{ color: "#D97706", marginBottom: 20 }}>
                  Copy this key now. You won&apos;t be able to see it again.
                </p>

                <div
                  className="flex items-center justify-between"
                  style={{
                    borderRadius: 14,
                    padding: 16,
                    marginBottom: 20,
                    gap: 12,
                    backgroundColor: "#F7F7F6",
                    border: "1px solid rgba(0,0,0,0.10)",
                  }}
                >
                  <code className="text-sm font-mono" style={{ color: "#3B82F6", wordBreak: "break-all" }}>{createdKey}</code>
                  <CopyButton text={createdKey} />
                </div>

                <div className="flex justify-end">
                  <button className="btn-primary" onClick={() => { setCreatedKey(null); setShowCreateModal(false); }}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

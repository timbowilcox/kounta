"use client";

import { useState } from "react";
import { CopyButton } from "@/components/copy-button";

type Tool = "claude-code" | "cursor";

const configs: Record<Tool, { label: string; file: string; config: string; steps: string[] }> = {
  "claude-code": {
    label: "Claude Code",
    file: ".claude/settings.json",
    config: `{
  "mcpServers": {
    "ledge": {
      "command": "npx",
      "args": ["@ledge/mcp@latest"],
      "env": {
        "LEDGE_API_KEY": "YOUR_API_KEY_HERE",
        "LEDGE_API_URL": "http://localhost:3100"
      }
    }
  }
}`,
    steps: [
      "Open your project in Claude Code",
      "Create or edit .claude/settings.json in your project root",
      "Paste the configuration below",
      "Replace YOUR_API_KEY_HERE with your actual API key from the API Keys page",
      "Restart Claude Code to load the MCP server",
    ],
  },
  cursor: {
    label: "Cursor",
    file: ".cursor/mcp.json",
    config: `{
  "mcpServers": {
    "ledge": {
      "command": "npx",
      "args": ["@ledge/mcp@latest"],
      "env": {
        "LEDGE_API_KEY": "YOUR_API_KEY_HERE",
        "LEDGE_API_URL": "http://localhost:3100"
      }
    }
  }
}`,
    steps: [
      "Open your project in Cursor",
      "Create or edit .cursor/mcp.json in your project root",
      "Paste the configuration below",
      "Replace YOUR_API_KEY_HERE with your actual API key from the API Keys page",
      "Cursor will detect the MCP server automatically",
    ],
  },
};

export default function McpPage() {
  const [activeTool, setActiveTool] = useState<Tool>("claude-code");
  const config = configs[activeTool];

  return (
    <div>
      <h1
        className="font-bold"
        style={{ fontSize: 24, color: "#0A0A0A", marginBottom: 8, fontFamily: "var(--font-family-display)" }}
      >
        MCP Connection Guide
      </h1>
      <p className="text-sm" style={{ color: "rgba(0,0,0,0.55)", marginBottom: 32, lineHeight: 1.6 }}>
        Connect Ledge to your AI coding assistant. Your agent can then post
        transactions, query balances, and generate financial statements
        conversationally.
      </p>

      {/* Tool selector */}
      <div className="flex items-center" style={{ gap: 6, marginBottom: 32 }}>
        {(Object.entries(configs) as [Tool, typeof config][]).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setActiveTool(key)}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              backgroundColor: activeTool === key ? "rgba(59,130,246,0.1)" : "transparent",
              color: activeTool === key ? "#3B82F6" : "rgba(0,0,0,0.36)",
              border: activeTool === key ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent",
              cursor: "pointer",
              transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Steps */}
      <div style={{ marginBottom: 32 }}>
        <div className="section-label" style={{ marginBottom: 16 }}>Setup Steps</div>
        <ol style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {config.steps.map((step, i) => (
            <li key={i} className="flex text-sm" style={{ color: "rgba(0,0,0,0.55)", gap: 14 }}>
              <span
                className="flex-shrink-0 flex items-center justify-center text-xs font-bold"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  backgroundColor: "rgba(59,130,246,0.1)",
                  color: "#3B82F6",
                }}
              >
                {i + 1}
              </span>
              <span style={{ paddingTop: 4, lineHeight: 1.5 }}>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Config block */}
      <div style={{ marginBottom: 32 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <div className="section-label">
            Configuration \u2014 <code className="font-mono text-xs" style={{ color: "#3B82F6" }}>{config.file}</code>
          </div>
          <CopyButton text={config.config} label="Copy config" />
        </div>
        <div
          style={{
            borderRadius: 18,
            padding: 24,
            backgroundColor: "#F3F3F1",
            border: "1px solid rgba(0,0,0,0.10)",
          }}
        >
          <pre className="font-mono text-sm overflow-x-auto" style={{ color: "rgba(0,0,0,0.55)", lineHeight: 1.7 }}>
            {config.config.split("\n").map((line, i) => {
              if (line.includes("YOUR_API_KEY_HERE")) {
                const parts = line.split("YOUR_API_KEY_HERE");
                return (
                  <div key={i}>
                    <span>{parts[0]}</span>
                    <span style={{ color: "#D97706", fontWeight: 500 }}>YOUR_API_KEY_HERE</span>
                    <span>{parts[1]}</span>
                  </div>
                );
              }
              if (line.includes('"ledge"') || line.includes('"mcpServers"')) {
                return <div key={i} style={{ color: "#3B82F6" }}>{line}</div>;
              }
              return <div key={i}>{line}</div>;
            })}
          </pre>
        </div>
      </div>

      {/* Available tools */}
      <div>
        <div className="section-label" style={{ marginBottom: 16 }}>Available MCP Tools</div>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 12 }}>
          {mcpTools.map((tool) => (
            <div key={tool.name} className="card" style={{ padding: 18 }}>
              <code className="font-mono text-xs font-medium" style={{ color: "#3B82F6" }}>
                {tool.name}
              </code>
              <p className="text-xs" style={{ color: "rgba(0,0,0,0.36)", marginTop: 6, lineHeight: 1.5 }}>
                {tool.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const mcpTools = [
  { name: "setup_ledger", description: "Initialize a new ledger from a business description" },
  { name: "complete_setup", description: "Finalize ledger setup with a chosen template" },
  { name: "post_transaction", description: "Record a double-entry transaction" },
  { name: "reverse_transaction", description: "Reverse a posted transaction" },
  { name: "search_transactions", description: "Search and paginate through transactions" },
  { name: "list_accounts", description: "List all accounts with balances" },
  { name: "create_account", description: "Add a new account to the chart" },
  { name: "get_statement", description: "Generate P&L, balance sheet, or cash flow" },
  { name: "import_file", description: "Import CSV or OFX bank data" },
  { name: "confirm_matches", description: "Confirm or reject import match suggestions" },
  { name: "get_usage", description: "Check account, transaction, and line item counts" },
];

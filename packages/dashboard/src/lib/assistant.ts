// ---------------------------------------------------------------------------
// AI Financial Assistant — server-side Anthropic integration.
//
// Connects to the Anthropic API with tool_use to call Kounta SDK methods.
// Model is tiered by plan: Free → Haiku, Builder+ → Sonnet.
// Write operations (post/reverse) return confirmation_required instead of
// executing immediately.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { Kounta } from "@kounta/sdk";
import type { ConversationMessage, ToolCallRecord } from "@kounta/core";

// ---------------------------------------------------------------------------
// Anthropic client (singleton)
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

/** Check if the Anthropic API key is configured. */
export function isAssistantAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Select model based on user plan. Free → Haiku, Builder+ → Sonnet. */
export function selectModel(plan: string): string {
  if (plan === "free") return "claude-haiku-4-5-20251001";
  return "claude-sonnet-4-6";
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const BASE_SYSTEM_PROMPT = `You are Kounta's financial assistant. You help users understand their accounting data, generate reports, and manage transactions through natural conversation.

You have access to a double-entry accounting ledger via tools. All monetary amounts are integers in the smallest currency unit (e.g., cents). When displaying amounts to the user, divide by 100 and format with the appropriate currency symbol.

Guidelines:
- Be concise and direct. Lead with the answer, then provide context.
- When showing financial data, use clear formatting with aligned numbers.
- For reports (P&L, balance sheet, cash flow), summarise the key insights first, then offer to show the full breakdown.
- When the user asks to post a transaction or reverse one, describe what will happen and wait for their confirmation. Never execute write operations without explicit user approval.
- If a question is ambiguous, ask a clarifying question rather than guessing.
- Use accounting terminology correctly but explain it simply when the user seems unfamiliar.`;

// ---------------------------------------------------------------------------
// Jurisdiction context for system prompt
// ---------------------------------------------------------------------------

export interface JurisdictionContext {
  code: string;
  name: string;
  taxAuthority: string;
  vatName: string;
  vatRate: number;
  taxBasis: string;
  financialYearLabel: string;
  defaultDepreciationMethod: string;
  capitalisationThreshold: number;
}

/** Build system prompt with dynamic context (date, time, ledger info). */
function buildSystemPrompt(ledgerContext?: {
  currency?: string;
  name?: string;
  jurisdiction?: JurisdictionContext;
}): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-AU", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Australia/Brisbane",
  });
  const timeStr = now.toLocaleTimeString("en-AU", {
    timeZone: "Australia/Brisbane",
    hour: "2-digit",
    minute: "2-digit",
  });

  let contextBlock = `\n\nToday's date is ${dateStr}.\nThe current time is ${timeStr} AEST.`;

  if (ledgerContext?.name) {
    contextBlock += `\nThe user's ledger is "${ledgerContext.name}".`;
  }
  if (ledgerContext?.currency) {
    contextBlock += `\nThe ledger currency is ${ledgerContext.currency}.`;
  }

  if (ledgerContext?.jurisdiction) {
    const j = ledgerContext.jurisdiction;
    contextBlock += `\n\nJurisdiction context:`;
    contextBlock += `\n- Jurisdiction: ${j.name} (${j.code})`;
    contextBlock += `\n- Tax authority: ${j.taxAuthority}`;
    contextBlock += `\n- Current financial year: ${j.financialYearLabel}`;
    contextBlock += `\n- Tax basis: ${j.taxBasis}`;
    contextBlock += `\n- ${j.vatName} rate: ${j.vatRate}%`;
    contextBlock += `\n- Default depreciation method: ${j.defaultDepreciationMethod.replace(/_/g, " ")}`;
    if (j.capitalisationThreshold > 0) {
      contextBlock += `\n- Capitalisation threshold: $${(j.capitalisationThreshold / 100).toLocaleString()}`;
    }
    if (j.code === "AU") {
      contextBlock += `\n- Instant asset write-off: Available for small businesses (turnover < $10M) for assets under $20,000 (current threshold — use check_capitalisation for exact rules).`;
    }
    contextBlock += `\n\nWhen advising on asset purchases, always use check_capitalisation first. When asked about depreciation rates or tax rules, use the available tools rather than relying on training data which may be outdated.`;
  }

  return BASE_SYSTEM_PROMPT + contextBlock;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const WRITE_TOOLS = new Set(["post_transaction", "reverse_transaction", "create_recurring_entry", "run_depreciation"]);

const tools: Anthropic.Tool[] = [
  {
    name: "get_account_balances",
    description: "List all accounts in the ledger with their current balances. Returns account code, name, type, and balance.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_income_statement",
    description: "Generate a Profit & Loss (income statement) for a date range. Shows revenue, expenses, and net income.",
    input_schema: {
      type: "object" as const,
      properties: {
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format" },
        endDate: { type: "string", description: "End date in YYYY-MM-DD format" },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "get_balance_sheet",
    description: "Generate a balance sheet as of a specific date. Shows assets, liabilities, and equity.",
    input_schema: {
      type: "object" as const,
      properties: {
        asOfDate: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["asOfDate"],
    },
  },
  {
    name: "get_cash_flow",
    description: "Generate a cash flow statement for a date range. Shows operating, investing, and financing activities.",
    input_schema: {
      type: "object" as const,
      properties: {
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format" },
        endDate: { type: "string", description: "End date in YYYY-MM-DD format" },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "search_transactions",
    description: "List transactions in the ledger. Returns transactions with their line items. Supports pagination.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Max results to return (default 20, max 200)" },
        cursor: { type: "string", description: "Pagination cursor from a previous response" },
      },
      required: [],
    },
  },
  {
    name: "get_transaction",
    description: "Get a specific transaction by ID with all its line items.",
    input_schema: {
      type: "object" as const,
      properties: {
        transactionId: { type: "string", description: "The transaction UUID" },
      },
      required: ["transactionId"],
    },
  },
  {
    name: "post_transaction",
    description: "Post a new balanced journal entry. Debits must equal credits. Amount is in smallest currency unit (cents). This is a write operation that requires user confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "Transaction date in YYYY-MM-DD format" },
        memo: { type: "string", description: "Description of the transaction" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              accountCode: { type: "string", description: "Account code (e.g., '1000')" },
              amount: { type: "number", description: "Amount in smallest currency unit (cents)" },
              direction: { type: "string", enum: ["debit", "credit"] },
              memo: { type: "string", description: "Optional line memo" },
            },
            required: ["accountCode", "amount", "direction"],
          },
          description: "Array of line items. Sum of debits must equal sum of credits.",
        },
        idempotencyKey: { type: "string", description: "Optional unique key to prevent duplicates" },
      },
      required: ["date", "memo", "lines"],
    },
  },
  {
    name: "reverse_transaction",
    description: "Reverse a posted transaction by creating an offsetting entry. This is a write operation that requires user confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {
        transactionId: { type: "string", description: "The transaction UUID to reverse" },
        reason: { type: "string", description: "Reason for the reversal" },
      },
      required: ["transactionId", "reason"],
    },
  },
  {
    name: "list_templates",
    description: "List all available chart-of-accounts templates (e.g., SaaS, e-commerce, agency).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_usage",
    description: "Get the ledger's current usage stats: transaction count, plan limit, and billing period.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_recurring_entries",
    description: "List all recurring journal entries for the ledger. Shows active and paused entries with their schedule and next run date.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "create_recurring_entry",
    description: "Create a new recurring journal entry for automated periodic postings (depreciation, accruals, etc.). Line items must balance (debits = credits). Uses account IDs, not codes. This is a write operation that requires user confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "Description of the recurring entry (e.g. 'Monthly depreciation')" },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account ID (UUID)" },
              amount: { type: "number", description: "Amount in smallest currency unit (cents)" },
              direction: { type: "string", enum: ["debit", "credit"] },
            },
            required: ["accountId", "amount", "direction"],
          },
          description: "Balanced line items (debits must equal credits)",
        },
        frequency: { type: "string", enum: ["weekly", "monthly", "quarterly", "annually"], description: "How often to post" },
        dayOfMonth: { type: "number", description: "Day of month for monthly/quarterly/annually (1-28)" },
        nextRunDate: { type: "string", description: "First run date (YYYY-MM-DD)" },
        autoReverse: { type: "boolean", description: "Auto-reverse on 1st of next period (for accruals)" },
      },
      required: ["description", "lineItems", "frequency", "nextRunDate"],
    },
  },
  {
    name: "get_revenue_metrics",
    description: "Get revenue recognition metrics: MRR, ARR, deferred revenue balance, recognised this month, and active schedule count.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_revenue_schedules",
    description: "List revenue recognition schedules. Optionally filter by status (active, completed, cancelled, paused).",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["active", "completed", "cancelled", "paused"], description: "Filter by schedule status" },
      },
      required: [],
    },
  },
  // --- Fixed Assets ---
  {
    name: "list_fixed_assets",
    description: "List all fixed assets in the ledger with current net book value and depreciation status.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["active", "disposed", "fully_depreciated", "all"], description: "Filter by asset status (default: active)" },
      },
      required: [],
    },
  },
  {
    name: "get_asset_summary",
    description: "Get a summary of the fixed asset register: total cost, net book value, accumulated depreciation, pending entries, and depreciation this financial year.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_pending_depreciation",
    description: "Get all depreciation entries that are due but not yet posted. Use this at month-end to see what needs to be posted.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "check_capitalisation",
    description: "Check whether a purchase should be capitalised as a fixed asset or expensed immediately. Takes into account jurisdiction rules (AU instant write-off, US Section 179, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Purchase amount in cents" },
        assetType: { type: "string", description: "Type of asset (e.g. laptop, motor_vehicle_car, office_furniture)" },
        purchaseDate: { type: "string", description: "Purchase date (YYYY-MM-DD)" },
        annualTurnover: { type: "number", description: "Business annual turnover in cents (for AU instant write-off eligibility)" },
      },
      required: ["amount", "assetType", "purchaseDate"],
    },
  },
  {
    name: "run_depreciation",
    description: "Post all pending depreciation journal entries. Each entry debits Depreciation Expense and credits Accumulated Depreciation. Safe to run multiple times. This is a write operation that requires user confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

interface ToolExecResult {
  output: unknown;
  isWriteConfirmation?: boolean;
}

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  client: Kounta,
  ledgerId: string,
): Promise<ToolExecResult> {
  switch (toolName) {
    case "get_account_balances":
      return { output: await client.accounts.list(ledgerId) };

    case "get_income_statement":
      return {
        output: await client.reports.incomeStatement(
          ledgerId,
          input.startDate as string,
          input.endDate as string,
        ),
      };

    case "get_balance_sheet":
      return {
        output: await client.reports.balanceSheet(ledgerId, input.asOfDate as string),
      };

    case "get_cash_flow":
      return {
        output: await client.reports.cashFlow(
          ledgerId,
          input.startDate as string,
          input.endDate as string,
        ),
      };

    case "search_transactions":
      return {
        output: await client.transactions.list(ledgerId, {
          limit: (input.limit as number) ?? 20,
          cursor: input.cursor as string | undefined,
        }),
      };

    case "get_transaction":
      return {
        output: await client.transactions.get(ledgerId, input.transactionId as string),
      };

    case "post_transaction":
      // Write tool — return confirmation instead of executing
      return {
        output: {
          confirmation_required: true,
          action: "post_transaction",
          description: `Post transaction: ${input.memo}`,
          details: input,
        },
        isWriteConfirmation: true,
      };

    case "reverse_transaction":
      // Write tool — return confirmation instead of executing
      return {
        output: {
          confirmation_required: true,
          action: "reverse_transaction",
          description: `Reverse transaction ${input.transactionId}: ${input.reason}`,
          details: input,
        },
        isWriteConfirmation: true,
      };

    case "list_templates":
      return { output: await client.templates.list() };

    case "get_usage": {
      // Use the billing status endpoint via the SDK's underlying client
      const accounts = await client.accounts.list(ledgerId);
      return {
        output: {
          accountCount: Array.isArray(accounts) ? accounts.length : 0,
          note: "Use the billing page for detailed usage stats",
        },
      };
    }

    case "list_recurring_entries":
      return { output: await client.recurring.list(ledgerId) };

    case "create_recurring_entry":
      // Write tool — return confirmation instead of executing
      return {
        output: {
          confirmation_required: true,
          action: "create_recurring_entry",
          description: `Create recurring entry: ${input.description} (${input.frequency})`,
          details: input,
        },
        isWriteConfirmation: true,
      };

    case "get_revenue_metrics":
      return { output: await client.revenue.getMetrics() };

    case "list_revenue_schedules":
      return {
        output: await client.revenue.listSchedules({
          status: input.status as string | undefined,
        }),
      };

    case "list_fixed_assets":
      return {
        output: await client.fixedAssets.list({
          status: (input.status as string) ?? "active",
        }),
      };

    case "get_asset_summary":
      return { output: await client.fixedAssets.getSummary() };

    case "get_pending_depreciation":
      return { output: await client.fixedAssets.getPending() };

    case "check_capitalisation":
      return {
        output: await client.fixedAssets.checkCapitalisation({
          amount: input.amount as number,
          asset_type: input.assetType as string,
          purchase_date: input.purchaseDate as string,
          annual_turnover: input.annualTurnover as number | undefined,
        }),
      };

    case "run_depreciation":
      // Write tool — return confirmation instead of executing
      return {
        output: {
          confirmation_required: true,
          action: "run_depreciation",
          description: "Post all pending depreciation journal entries",
          details: {},
        },
        isWriteConfirmation: true,
      };

    default:
      return { output: { error: `Unknown tool: ${toolName}` } };
  }
}

/** Execute a confirmed write operation. */
export async function executeConfirmedWrite(
  toolName: string,
  input: Record<string, unknown>,
  client: Kounta,
  ledgerId: string,
): Promise<unknown> {
  switch (toolName) {
    case "post_transaction":
      return client.transactions.post(ledgerId, {
        date: input.date as string,
        memo: input.memo as string,
        lines: input.lines as Array<{
          accountCode: string;
          amount: number;
          direction: "debit" | "credit";
          memo?: string;
        }>,
        idempotencyKey: input.idempotencyKey as string | undefined,
      });

    case "reverse_transaction":
      return client.transactions.reverse(
        ledgerId,
        input.transactionId as string,
        input.reason as string,
      );

    case "create_recurring_entry":
      return client.recurring.create(ledgerId, {
        description: input.description as string,
        lineItems: input.lineItems as Array<{
          accountId: string;
          amount: number;
          direction: "debit" | "credit";
        }>,
        frequency: input.frequency as "weekly" | "monthly" | "quarterly" | "annually",
        dayOfMonth: (input.dayOfMonth as number) ?? undefined,
        nextRunDate: input.nextRunDate as string,
        autoReverse: (input.autoReverse as boolean) ?? false,
      });

    case "run_depreciation":
      return client.fixedAssets.runDepreciation();

    default:
      throw new Error(`Not a write tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

export interface SSETextEvent {
  type: "text";
  text: string;
}

export interface SSEToolCallEvent {
  type: "tool_call";
  toolName: string;
  input: unknown;
}

export interface SSEToolResultEvent {
  type: "tool_result";
  toolName: string;
  output: unknown;
}

export interface SSEConfirmationEvent {
  type: "confirmation_required";
  toolName: string;
  input: unknown;
  confirmationId: string;
}

export interface SSEDoneEvent {
  type: "done";
  conversationId: string;
  messages: ConversationMessage[];
}

export interface SSEErrorEvent {
  type: "error";
  message: string;
}

export type SSEEvent =
  | SSETextEvent
  | SSEToolCallEvent
  | SSEToolResultEvent
  | SSEConfirmationEvent
  | SSEDoneEvent
  | SSEErrorEvent;

// ---------------------------------------------------------------------------
// Main chat function
// ---------------------------------------------------------------------------

export async function chatWithAssistant(opts: {
  messages: ConversationMessage[];
  apiKey: string;
  ledgerId: string;
  conversationId: string;
  plan: string;
  ledgerContext?: { currency?: string; name?: string; jurisdiction?: JurisdictionContext };
  onEvent: (event: SSEEvent) => void;
}): Promise<ConversationMessage[]> {
  const { messages, apiKey, ledgerId, conversationId, plan, ledgerContext, onEvent } = opts;

  const anthropic = getAnthropicClient();
  const model = selectModel(plan);
  const systemPrompt = buildSystemPrompt(ledgerContext);

  const client = new Kounta({
    baseUrl: process.env.KOUNTA_API_URL ?? "https://api.kounta.ai",
    apiKey,
  });

  // Build Anthropic message array from conversation history
  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolCalls: ToolCallRecord[] = [];
  let assistantText = "";
  let pendingConfirmation: { toolName: string; input: Record<string, unknown> } | null = null;

  // Tool-use loop: keep calling until no more tool_use blocks
  let continueLoop = true;
  while (continueLoop) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages: anthropicMessages,
    });

    // Process content blocks
    let hasToolUse = false;
    const toolResults: Anthropic.MessageParam[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        assistantText += block.text;
        onEvent({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        hasToolUse = true;
        const toolInput = block.input as Record<string, unknown>;
        onEvent({ type: "tool_call", toolName: block.name, input: toolInput });

        // Check if this is a write tool
        if (WRITE_TOOLS.has(block.name)) {
          const confirmationId = `${conversationId}:${block.id}`;
          pendingConfirmation = { toolName: block.name, input: toolInput };

          onEvent({
            type: "confirmation_required",
            toolName: block.name,
            input: toolInput,
            confirmationId,
          });

          // Return a tool result telling Claude to wait for confirmation
          toolCalls.push({ toolName: block.name, input: toolInput, output: { confirmation_required: true } });

          toolResults.push({
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify({
                confirmation_required: true,
                message: "This write operation requires user confirmation. The user has been presented with a confirmation dialog. Please let them know what you're about to do and that they need to confirm.",
              }),
            }],
          });
        } else {
          // Execute read tool
          try {
            const result = await executeTool(block.name, toolInput, client, ledgerId);
            onEvent({ type: "tool_result", toolName: block.name, output: result.output });
            toolCalls.push({ toolName: block.name, input: toolInput, output: result.output });

            toolResults.push({
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result.output),
              }],
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Tool execution failed";
            toolResults.push({
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({ error: errorMsg }),
                is_error: true,
              }],
            });
            toolCalls.push({ toolName: block.name, input: toolInput, output: { error: errorMsg } });
          }
        }
      }
    }

    // Add assistant response to messages
    anthropicMessages.push({ role: "assistant", content: response.content });

    // Add tool results if any
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        anthropicMessages.push(tr);
      }
    }

    // Continue loop only if there were tool uses and stop_reason is tool_use
    // (and no pending write confirmation)
    continueLoop = hasToolUse && response.stop_reason === "tool_use" && !pendingConfirmation;
  }

  // Build updated messages array
  const updatedMessages: ConversationMessage[] = [
    ...messages,
    {
      role: "assistant",
      content: assistantText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      timestamp: new Date().toISOString(),
    },
  ];

  onEvent({
    type: "done",
    conversationId,
    messages: updatedMessages,
  });

  return updatedMessages;
}

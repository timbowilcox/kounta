// ---------------------------------------------------------------------------
// MCP response helpers — convert engine Result<T> into MCP tool/resource shapes.
// ---------------------------------------------------------------------------

import type { Result, KountaError } from "@kounta/core";

/** Successful tool response. */
export function toolOk(data: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Error tool response. */
export function toolErr(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(error) }],
    isError: true,
  };
}

/** Convert an engine Result<T> to an MCP tool response. */
export function handleResult(result: Result<unknown, KountaError>): {
  content: { type: "text"; text: string }[];
  isError?: true;
} {
  if (result.ok) {
    return toolOk(result.value);
  }
  return toolErr(result.error);
}

/** Build an MCP resource response with JSON content. */
export function resourceJson(
  uri: string,
  data: unknown,
): {
  contents: { uri: string; text: string; mimeType: string }[];
} {
  return {
    contents: [
      {
        uri,
        text: JSON.stringify(data, null, 2),
        mimeType: "application/json",
      },
    ],
  };
}

import type { OpenCodePart, ToolPart } from "../../../lib/opencode";
import {
  extractWebSearchSites,
  getToolLabel,
  getWebSearchQuery,
  isWebSearchTool,
  type WebSearchSite,
} from "./ToolCallCard";

/** The assistant/tool pair currently shown in the Activity drawer. */
export interface ActivitySelection {
  messageId: string;
  partId: string;
}

export interface ActivityMessage {
  role: string;
  parts?: OpenCodePart[];
}

export interface ActivityTime {
  start?: number;
  end?: number;
}

export interface ReasoningActivityEvent {
  id: string;
  kind: "reasoning";
  text: string;
  time?: ActivityTime;
}

export interface TextActivityEvent {
  id: string;
  kind: "text";
  text: string;
  time?: ActivityTime;
}

export interface ToolActivityEvent {
  id: string;
  kind: "tool";
  toolName?: string;
  state?: { status: NonNullable<ToolPart["state"]>["status"] };
  query?: string;
  sites: WebSearchSite[];
  time?: ActivityTime;
}

export type ActivityEvent =
  | ReasoningActivityEvent
  | TextActivityEvent
  | ToolActivityEvent;

function partTime(part: OpenCodePart): ActivityTime | undefined {
  const time = (part as OpenCodePart & { time?: ActivityTime }).time;
  if (!time || (typeof time.start !== "number" && typeof time.end !== "number")) {
    return undefined;
  }
  return {
    ...(typeof time.start === "number" ? { start: time.start } : {}),
    ...(typeof time.end === "number" ? { end: time.end } : {}),
  };
}

function asToolPart(part: OpenCodePart): ToolPart {
  return part as ToolPart;
}

/**
 * Build the drawer timeline from the provider's ordered message parts.
 *
 * This intentionally does not add lifecycle phases, timestamps, titles, or
 * site names. A part only becomes visible when its provider payload contains
 * something the drawer can show without guessing.
 */
export function buildActivityTimeline(
  message: ActivityMessage | undefined,
): ActivityEvent[] {
  if (!message || message.role !== "assistant") return [];

  const events: ActivityEvent[] = [];
  for (const part of message.parts ?? []) {
    if (part.type === "reasoning" && typeof part.text === "string" && part.text) {
      const time = partTime(part);
      events.push({
        id: part.id,
        kind: "reasoning",
        text: part.text,
        ...(time ? { time } : {}),
      });
      continue;
    }

    if (part.type === "text" && typeof part.text === "string" && part.text) {
      const time = partTime(part);
      events.push({
        id: part.id,
        kind: "text",
        text: part.text,
        ...(time ? { time } : {}),
      });
      continue;
    }

    if (part.type !== "tool") continue;

    const tool = asToolPart(part);
    const time = partTime(part);
    const toolName = tool.tool;
    const webSearch = isWebSearchTool(toolName ?? "");
    const input = tool.state?.input;
    const query = webSearch && input && typeof input === "object"
      ? getWebSearchQuery(input as Record<string, unknown>)
      : "";
    const sites = webSearch ? extractWebSearchSites(tool.state?.output, query) : [];

    events.push({
      id: part.id,
      kind: "tool",
      toolName: toolName ? getToolLabel(toolName) : undefined,
      ...(tool.state?.status ? { state: { status: tool.state.status } } : {}),
      ...(query ? { query } : {}),
      sites,
      ...(time ? { time } : {}),
    });
  }

  return events;
}

type OpenCodePart = {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  tool?: unknown;
  callID?: unknown;
  state?: { status?: unknown };
};

type OpenCodeMessage = {
  info?: {
    id?: unknown;
    role?: unknown;
    finish?: unknown;
    time?: unknown;
  };
  parts?: unknown;
};

export type ProjectedToolPart = {
  partId: string;
  callId: string | null;
  tool: string;
  status: string | null;
};

export function projectOpenCodeTurn(messages: readonly OpenCodeMessage[]) {
  const tools = new Map<string, ProjectedToolPart>();
  let finalAssistant: OpenCodeMessage | undefined;

  for (const message of messages) {
    if (message.info?.role !== "assistant" || !Array.isArray(message.parts)) continue;
    finalAssistant = message;
    for (const part of message.parts as OpenCodePart[]) {
      if (part.type !== "tool" || typeof part.tool !== "string") continue;
      const callId = typeof part.callID === "string" ? part.callID : null;
      const partId = typeof part.id === "string" ? part.id : callId;
      if (!partId) continue;
      tools.set(callId ?? partId, {
        partId,
        callId,
        tool: part.tool,
        status: typeof part.state?.status === "string" ? part.state.status : null,
      });
    }
  }

  const publicParts = Array.isArray(finalAssistant?.parts)
    ? (finalAssistant.parts as OpenCodePart[]).flatMap((part) =>
        part.type === "text" && typeof part.text === "string" ? [{ type: "text" as const, text: part.text }] : [])
    : [];

  return {
    info: finalAssistant?.info && typeof finalAssistant.info.id === "string"
      ? {
          id: finalAssistant.info.id,
          role: "assistant" as const,
          ...(typeof finalAssistant.info.finish === "string" ? { finish: finalAssistant.info.finish } : {}),
          ...(finalAssistant.info.time && typeof finalAssistant.info.time === "object" ? { time: finalAssistant.info.time } : {}),
        }
      : null,
    parts: publicParts,
    text: publicParts.map((part) => part.text).join(""),
    tools: [...tools.values()],
  };
}

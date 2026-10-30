import type { RequestExecutionFacts } from "./request-execution-owner.mjs";
export function findRequestChatSourceIds(
  readRows: (sql: string, parameters: string[]) => { id: string }[],
  execution: RequestExecutionFacts & { projectId: string },
  engineSessionId: string,
): { id: string }[];

export function isRequestChatConversationActive(
  readRow: (sql: string, parameters: string[]) => { event_type: string }|undefined,
  projectId: string, contextConversationId: string,
): boolean;

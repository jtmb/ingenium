export function redactContextText(text: string): string;
export function completedAssistant(info: Record<string, any>): boolean;
export function visibleContextExport(value: unknown, session: string, worktree: string): {
  info: { id: string; directory: string; contextUploadAutomatic?: boolean };
  messages: Array<{ info: { id: string; sessionID: string; role: string; time?: { completed: number } }; parts: Array<{ type: string; text: string }> }>;
};
